import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(400, `Text is required and must be ${max} characters or fewer.`);
  return value.trim();
}
function draft(value) {
  const title = text(value.title, 200);
  if (typeof value.description !== "string" || value.description.length > 20000)
    fail(400, "Description must be 20,000 characters or fewer.");
  if (
    !["idea", "feature", "bug", "task"].includes(value.type) ||
    !["low", "medium", "high", "urgent"].includes(value.priority) ||
    !["ideas", "todo", "in_progress", "testing", "done"].includes(value.status)
  )
    fail(400, "Choose a valid type, priority and status.");
  return {
    title,
    description: value.description,
    type: value.type,
    priority: value.priority,
    status: value.status,
  };
}
async function body(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    fail(415, "JSON is required.");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256000) fail(413, "Request is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Expected a JSON object.");
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, "Invalid JSON.");
  }
}

export async function startLocalServer({
  databasePath = resolve(".local/devpilot.sqlite"),
  port = 4202,
} = {}) {
  if (databasePath !== ":memory:")
    await mkdir(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; create table if not exists schema_migrations(name text primary key);",
  );
  const migrationDirectory = new URL("./migrations/", import.meta.url);
  for (const name of (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    if (db.prepare("select name from schema_migrations where name=?").get(name))
      continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
      db.prepare("insert into schema_migrations values (?)").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }
  if (!db.prepare("select id from users where username=?").get("dev")) {
    const salt = randomBytes(16).toString("hex");
    db.prepare("insert into users values (?,?,?,?)").run(
      "local-dev",
      "dev",
      salt,
      scryptSync("dev", salt, 64).toString("hex"),
    );
  }
  const sessions = new Map();
  const project = (id, userId) => {
    const value = db
      .prepare("select * from projects where id=? and owner_id=?")
      .get(id, userId);
    if (!value) fail(404, "Project not found.");
    return value;
  };
  const item = (id, userId) => {
    const value = db
      .prepare(
        "select i.* from items i join projects p on p.id=i.project_id where i.id=? and p.owner_id=?",
      )
      .get(id, userId);
    if (!value) fail(404, "Item not found.");
    return value;
  };
  const account = (userId) => {
    const user = db
      .prepare("select id,username from users where id=?")
      .get(userId);
    return user ? { id: user.id, email: user.username } : null;
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (
        !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
          request.headers.host ?? "",
        )
      )
        fail(403, "Local requests only.");
      if (request.headers["x-devpilot-local"] !== "1")
        fail(403, "Local request header is required.");
      if (request.headers.origin) {
        let origin;
        try {
          origin = new URL(request.headers.origin);
        } catch {
          fail(403, "Local requests only.");
        }
        if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
          fail(403, "Local requests only.");
      }
      const path = new URL(request.url, "http://localhost").pathname;
      const method = request.method;
      const token = request.headers.cookie
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("devpilot_local="))
        ?.slice("devpilot_local=".length);
      const session = token ? sessions.get(token) : null;
      if (session && session.expires < Date.now()) {
        sessions.delete(token);
      }
      const userId =
        session && session.expires >= Date.now() ? session.userId : null;
      let result;
      let match;
      if (path === "/api/auth/session" && method === "GET")
        result = userId ? account(userId) : null;
      else if (path === "/api/auth/login" && method === "POST") {
        const value = await body(request);
        const user = db
          .prepare("select * from users where username=?")
          .get(typeof value.username === "string" ? value.username.trim() : "");
        const password =
          typeof value.password === "string" ? value.password : "";
        if (password.length > 2000) fail(400, "Password is too long.");
        const salt = user?.salt ?? "invalid-user";
        const supplied = scryptSync(password, salt, 64);
        const expected = user
          ? Buffer.from(user.password_hash, "hex")
          : Buffer.alloc(64);
        if (!user || !timingSafeEqual(supplied, expected))
          fail(401, "Incorrect username or password.");
        if (token) sessions.delete(token);
        const next = randomBytes(32).toString("hex");
        sessions.set(next, {
          userId: user.id,
          expires: Date.now() + 8 * 60 * 60 * 1000,
        });
        response.setHeader(
          "Set-Cookie",
          `devpilot_local=${next}; HttpOnly; SameSite=Strict; Path=/api`,
        );
        result = account(user.id);
      } else if (path === "/api/auth/logout" && method === "POST") {
        if (token) sessions.delete(token);
        response.setHeader(
          "Set-Cookie",
          "devpilot_local=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0",
        );
        result = null;
      } else {
        if (!userId) fail(401, "Sign in to use the local workspace.");
        if (path === "/api/projects" && method === "GET")
          result = db
            .prepare(
              "select * from projects where owner_id=? order by created_at,rowid",
            )
            .all(userId);
        else if (path === "/api/projects" && method === "POST") {
          const value = await body(request);
          const id = randomUUID();
          db.prepare("insert into projects values (?,?,?,?)").run(
            id,
            userId,
            text(value.name, 80),
            new Date().toISOString(),
          );
          result = project(id, userId);
        } else if ((match = path.match(/^\/api\/projects\/([^/]+)$/))) {
          const id = match[1];
          project(id, userId);
          if (method === "PATCH") {
            const value = await body(request);
            db.prepare("update projects set name=? where id=?").run(
              text(value.name, 80),
              id,
            );
            result = project(id, userId);
          } else if (method === "DELETE") {
            db.prepare("delete from projects where id=?").run(id);
            result = null;
          } else fail(404, "Route not found.");
        } else if (
          (match = path.match(
            /^\/api\/projects\/([^/]+)\/items(?:\/([^/]+))?$/,
          ))
        ) {
          const projectId = match[1];
          const id = match[2];
          project(projectId, userId);
          if (method === "GET" && !id)
            result = db
              .prepare(
                "select * from items where project_id=? order by created_at,rowid",
              )
              .all(projectId);
          else if ((method === "POST" && !id) || (method === "PATCH" && id)) {
            if (id && item(id, userId).project_id !== projectId)
              fail(404, "Item not found in project.");
            const value = draft(await body(request));
            const now = new Date().toISOString();
            const itemId = id ?? randomUUID();
            if (id)
              db.prepare(
                "update items set title=?,description=?,type=?,priority=?,status=?,updated_at=? where id=?",
              ).run(
                value.title,
                value.description,
                value.type,
                value.priority,
                value.status,
                now,
                id,
              );
            else
              db.prepare("insert into items values (?,?,?,?,?,?,?,?,?,?)").run(
                itemId,
                projectId,
                value.title,
                value.description,
                value.type,
                value.priority,
                value.status,
                null,
                now,
                now,
              );
            result = item(itemId, userId);
          } else fail(404, "Route not found.");
        } else if (
          (match = path.match(/^\/api\/items\/([^/]+)\/archive$/)) &&
          method === "PATCH"
        ) {
          const id = match[1];
          item(id, userId);
          const value = await body(request);
          if (typeof value.archived !== "boolean")
            fail(400, "Archive must be true or false.");
          const now = new Date().toISOString();
          db.prepare(
            "update items set archived_at=?,updated_at=? where id=?",
          ).run(value.archived ? now : null, now, id);
          result = item(id, userId);
        } else if ((match = path.match(/^\/api\/items\/([^/]+)\/notes$/))) {
          const itemId = match[1];
          item(itemId, userId);
          if (method === "GET")
            result = db
              .prepare(
                "select * from notes where item_id=? order by created_at,rowid",
              )
              .all(itemId);
          else if (method === "POST") {
            const value = await body(request);
            const id = randomUUID();
            db.prepare("insert into notes values (?,?,?,?)").run(
              id,
              itemId,
              text(value.body, 10000),
              new Date().toISOString(),
            );
            result = db.prepare("select * from notes where id=?").get(id);
          } else fail(404, "Route not found.");
        } else fail(404, "Route not found.");
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode =
        error.status ??
        (error.code?.startsWith("ERR_SQLITE_CONSTRAINT") ? 400 : 500);
      response.end(
        JSON.stringify({
          message:
            response.statusCode === 500
              ? "Local database request failed."
              : error.message,
        }),
      );
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    db.close();
    throw error;
  }
  let closed = false;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      db.close();
    },
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const server = await startLocalServer();
  console.log(`DevPilot local SQLite API: ${server.url}`);
  console.log(`Database: ${resolve(".local/devpilot.sqlite")}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
}
