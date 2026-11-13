import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Workspace, fail } from "./workspace.mjs";
import { Connections } from "./connections.mjs";
import { handleMcp } from "./mcp.mjs";
import { workspaceIdentity } from "./workspace-identity.mjs";
import { LocalOAuth } from "./oauth.mjs";
import { LocalSessions, REMEMBERED_SESSION_SECONDS } from "./sessions.mjs";
import { CodexRuns } from "./codex-runs.mjs";

async function body(request, limit = 256000) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    fail(415, "JSON is required.");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) fail(413, "Request is too large.");
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
  browserOrigin = process.env.DEVPILOT_BROWSER_ORIGIN || "",
  codexCommand,
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
  const sessions = new LocalSessions(db);
  const workspace = new Workspace(db);
  const codex = new CodexRuns(db, workspace, codexCommand);
  const streams = new Set();
  const revisionQuery = db.prepare("select project_id,user_id,revision from card_revisions");
  const revisions = new Map(revisionQuery.all().map(row => [row.project_id, row.revision]));
  const noteEventQuery = db.prepare("select * from note_events where sequence>? order by sequence");
  let noteCursor = db.prepare("select coalesce(max(sequence),0) as sequence from note_events").get().sequence;
  const connections = new Connections(
    db,
    workspace,
    () => `http://127.0.0.1:${server.address().port}/mcp`,
  );
  const oauth = new LocalOAuth(db, workspace, connections, () => `http://127.0.0.1:${server.address().port}`);
  let oauthRouter;
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
      const path = new URL(request.url, "http://localhost").pathname;
      if (
        !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
          request.headers.host ?? "",
        )
      )
        fail(403, "Local requests only.");
      if (request.headers.origin) {
        let origin;
        try {
          origin = new URL(request.headers.origin);
        } catch {
          fail(403, "Local requests only.");
        }
        const phoneRequest = browserOrigin && request.headers.origin === browserOrigin && path.startsWith("/api/");
        if (!phoneRequest && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
          fail(403, "Local requests only.");
      }
      const method = request.method;
      if (path.startsWith("/.well-known/") || ["/authorize", "/token", "/register", "/revoke", "/oauth/consent"].includes(path)) {
        oauthRouter ??= oauth.router();
        oauthRouter(request, response);
        return;
      }
      if (path === "/mcp") {
        const authorize = () =>
          request.headers.authorization?.startsWith("Bearer dpo_")
            ? oauth.authorizeAccess(request.headers.authorization)
            : connections.authorize(request.headers.authorization);
        authorize();
        if (method !== "POST") {
          response.setHeader("Allow", "POST");
          fail(405, "Use MCP Streamable HTTP POST requests.");
        }
        const parsedBody = await body(request, 22000000);
        await handleMcp(
          request,
          response,
          parsedBody,
          workspace,
          authorize(),
          authorize,
        );
        return;
      }
      const eventProject = method === "GET" && (path === "/api/events" ? [path, null] : path.match(/^\/api\/projects\/([^/]+)\/events$/));
      const imageRequest = method === 'GET' && path.match(/^\/api\/note-images\/([a-f0-9-]{36})$/);
      if (request.headers["x-devpilot-local"] !== "1" && !eventProject && !imageRequest)
        fail(403, "Local request header is required.");
      const token = request.headers.cookie
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("devpilot_local="))
        ?.slice("devpilot_local=".length);
      const session = token ? sessions.get(token) : null;
      const userId = session?.userId ?? null;
      if (imageRequest) {
        if (!userId) fail(401, 'Sign in to use the local workspace.');
        const image = workspace.noteImage(userId, imageRequest[1]);
        response.setHeader('Content-Type', image.mime_type);
        response.setHeader('Content-Length', image.data.length);
        response.end(image.data);
        return;
      }
      if (eventProject) {
        if (!userId) fail(401, "Sign in to use the local workspace.");
        const projectId = eventProject[1];
        if (projectId) workspace.project(projectId, userId);
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("X-Accel-Buffering", "no");
        response.write("event: ready\ndata: {}\n\n");
        streams.add(response);
        const changed = (change) => {
          if (!sessions.get(token)) { response.end(); return; }
          if (change.userId === userId && (!projectId || change.projectId === projectId))
            response.write("event: change\ndata: {}\n\n");
        };
        workspace.changes.on("items", changed);
        const noteChanged = (change) => {
          if (!sessions.get(token)) { response.end(); return; }
          if (change.userId !== userId || (projectId && change.projectId !== projectId)) return;
          // Recheck access before sending note text stored by an earlier write.
          try { workspace.project(change.projectId, userId); } catch { return; }
          response.write(`event: note\ndata: ${JSON.stringify(change.event)}\n\n`);
        };
        const resync = () => {
          if (!sessions.get(token)) { response.end(); return; }
          response.write("event: resync\ndata: {}\n\n");
        };
        workspace.changes.on("notes", noteChanged);
        workspace.changes.on("resync", resync);
        const heartbeat = setInterval(() => {
          if (!sessions.get(token)) response.end();
          else response.write(": heartbeat\n\n");
        }, 25000);
        response.on("close", () => {
          clearInterval(heartbeat);
          workspace.changes.off("items", changed);
          workspace.changes.off("notes", noteChanged);
          workspace.changes.off("resync", resync);
          streams.delete(response);
        });
        return;
      }
      let result;
      let match;
      if (path === "/api/health" && method === "GET")
        result = {
          name: "DevPilot local API",
          workspace_id: workspaceIdentity(databasePath),
          capabilities: ["sqlite", "connections", "mcp"],
        };
      else if (path === "/api/auth/session" && method === "GET")
        result = userId ? account(userId) : null;
      else if (path === "/api/auth/login" && method === "POST") {
        const value = await body(request);
        const user = db
          .prepare("select * from users where username=?")
          .get(typeof value.username === "string" ? value.username.trim() : "");
        const password =
          typeof value.password === "string" ? value.password : "";
        if (password.length > 2000) fail(400, "Password is too long.");
        const supplied = scryptSync(password, user?.salt ?? "invalid-user", 64);
        const expected = user
          ? Buffer.from(user.password_hash, "hex")
          : Buffer.alloc(64);
        if (!user || !timingSafeEqual(supplied, expected))
          fail(401, "Incorrect username or password.");
        const remember = value.remember === true;
        const next = sessions.create(user.id, token, remember);
        response.setHeader(
          "Set-Cookie",
          `devpilot_local=${next}; HttpOnly; SameSite=Strict; Path=/api${remember ? `; Max-Age=${REMEMBERED_SESSION_SECONDS}` : ""}`,
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
        if (path === "/api/connections/server" && method === "GET")
          result = { url: `http://127.0.0.1:${server.address().port}/mcp` };
        else if (path === '/api/codex/runs' && method === 'GET') result = codex.overview(userId);
        else if ((match = path.match(/^\/api\/projects\/([^/]+)\/codex$/))) {
          if (method === 'GET') result = codex.config(userId, match[1]);
          else if (method === 'PUT') result = await codex.configure(userId, match[1], await body(request));
          else fail(404, 'Route not found.');
        }
        else if ((match = path.match(/^\/api\/items\/([^/]+)\/codex(?:\/(reply|stop))?$/))) {
          if (method === 'GET' && !match[2]) result = codex.state(userId, match[1]);
          else if (method === 'POST' && !match[2]) result = await codex.start(userId, match[1], await body(request));
          else if (method === 'POST' && match[2] === 'reply') result = codex.reply(userId, match[1], await body(request));
          else if (method === 'POST' && match[2] === 'stop') result = await codex.stop(userId, match[1]);
          else fail(404, 'Route not found.');
        }
        else if (path === "/api/projects" && method === "GET")
          result = workspace.projects(userId);
        else if (path === "/api/projects" && method === "POST")
          result = workspace.createProject(userId, (await body(request)).name);
        else if (
          (match = path.match(
            /^\/api\/projects\/([^/]+)\/connections(?:\/([^/]+))?$/,
          ))
        ) {
          const projectId = match[1];
          const id = match[2];
          if (method === "GET" && !id)
            result = connections.list(userId, projectId);
          else if (method === "POST" && !id)
            result = connections.create(userId, projectId, await body(request));
          else if (method === "DELETE" && id)
            result = connections.revoke(userId, projectId, id);
          else fail(404, "Route not found.");
        } else if ((match = path.match(/^\/api\/projects\/([^/]+)$/))) {
          if (method === "PATCH")
            result = workspace.renameProject(
              userId,
              match[1],
              (await body(request)).name,
            );
          else if (method === "DELETE")
            result = workspace.deleteProject(userId, match[1]);
          else fail(404, "Route not found.");
        } else if (
          (match = path.match(
            /^\/api\/projects\/([^/]+)\/items(?:\/([^/]+))?$/,
          ))
        ) {
          const projectId = match[1];
          const id = match[2];
          if (method === "GET" && !id)
            result = workspace.items(userId, projectId);
          else if ((method === "POST" && !id) || (method === "PATCH" && id))
            result = workspace.saveItem(
              userId,
              projectId,
              await body(request),
              id,
            );
          else fail(404, "Route not found.");
        } else if (
          (match = path.match(/^\/api\/items\/([^/]+)\/archive$/)) &&
          method === "PATCH"
        )
          result = workspace.archiveItem(
            userId,
            match[1],
            (await body(request)).archived,
          );
        else if ((match = path.match(/^\/api\/items\/([^/]+)\/activity\/([^/]+)$/)) && method === "DELETE") {
          result = workspace.deleteActivity(userId, match[1], match[2]);
        }
        else if ((match = path.match(/^\/api\/items\/([^/]+)\/activity$/)) && method === "GET") {
          result = workspace.activity(userId, match[1]);
        }
        else if ((match = path.match(/^\/api\/notes\/([^/]+)$/))) {
          if (method === "PATCH") result = workspace.editNote(userId, match[1], (await body(request)).body);
          else if (method === "DELETE") result = workspace.deleteNote(userId, match[1]);
          else fail(404, "Route not found.");
        }
        else if ((match = path.match(/^\/api\/items\/([^/]+)\/notes$/))) {
          if (method === "GET") result = workspace.notes(userId, match[1]);
          else if (method === "POST") {
            const value = await body(request, 22000000);
            result = workspace.addNote(
              userId,
              match[1],
              value.body,
              'user',
              value.images,
            );
          }
          else fail(404, "Route not found.");
        } else fail(404, "Route not found.");
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.statusCode =
        error.status ??
        (error.code?.startsWith("ERR_SQLITE_CONSTRAINT") ? 400 : 500);
      if (response.statusCode === 401)
        response.setHeader("WWW-Authenticate", `Bearer resource_metadata="http://127.0.0.1:${server.address().port}/.well-known/oauth-protected-resource/mcp"`);
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
  // One small shared server-side query, regardless of how many clients connect.
  // SQL triggers make notifications include committed out-of-process writes too.
  const changeTimer = setInterval(() => {
    if (!streams.size) return;
    const noteEvents = noteEventQuery.all(noteCursor);
    if (noteEvents.length && noteEvents[0].sequence > noteCursor + 1) workspace.changes.emit("resync");
    for (const row of noteEvents) {
      noteCursor = row.sequence;
      workspace.changes.emit("notes", {
        userId: row.user_id, projectId: row.project_id,
        event: { id: `local:${row.sequence}`, operation: row.operation, note_id: row.note_id,
          item_id: row.item_id, ...(row.note_json ? { note: JSON.parse(row.note_json) } : {}) },
      });
    }
    for (const row of revisionQuery.all()) {
      if (revisions.get(row.project_id) === row.revision) continue;
      revisions.set(row.project_id, row.revision);
      workspace.changes.emit("items", { userId: row.user_id, projectId: row.project_id });
    }
  }, 500);
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(changeTimer);
      await codex.close();
      for (const stream of streams) stream.end();
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
