import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "./server.mjs";
import { DatabaseSync } from "node:sqlite";

test("persistent local sessions hash tokens, rotate on login and reject expired cookies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-sessions-"));
  const databasePath = join(directory, "sessions.sqlite");
  const server = await startLocalServer({ databasePath, port: 0 });
  let db;
  const login = (cookie = "") => fetch(`${server.url}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: cookie },
    body: JSON.stringify({ username: "dev", password: "dev" }),
  });
  const projects = cookie => fetch(`${server.url}/api/projects`, { headers: { "X-DevPilot-Local": "1", Cookie: cookie } });
  try {
    const first = await login();
    const header = first.headers.get("set-cookie");
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    assert.doesNotMatch(header, /Max-Age|Expires=/i);
    const original = header.split(";")[0];
    const next = (await login(original)).headers.get("set-cookie").split(";")[0];
    assert.notEqual(original, next);
    assert.equal((await projects(original)).status, 401);
    assert.equal((await projects(next)).status, 200);
    db = new DatabaseSync(databasePath);
    const stored = db.prepare("select * from local_sessions").all();
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].token_hash, next.split("=")[1]);
    assert.equal(stored[0].user_id, "local-dev");
    db.prepare("update local_sessions set expires_at=0").run();
    assert.equal((await projects(next)).status, 401);
    assert.equal(db.prepare("select count(*) as total from local_sessions").get().total, 0);
  } finally {
    db?.close();
    await server.close();
    assert.ok(directory.startsWith(join(tmpdir(), "devpilot-sessions-")));
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite dev API persists projects, items and notes and requires a local session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-sqlite-"));
  let server = await startLocalServer({
    databasePath: join(directory, "devpilot.sqlite"),
    port: 0,
  });
  let cookie = "";
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`${server.url}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-DevPilot-Local": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  try {
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.ok(health.body.capabilities.includes("mcp"));
    assert.equal((await request("/projects")).status, 401);
    assert.equal(
      (
        await request("/auth/login", "POST", {
          username: "dev",
          password: "wrong",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/auth/login", "POST", {
          username: "dev",
          password: "dev",
        })
      ).status,
      200,
    );
    const project = (
      await request("/projects", "POST", { name: "SQLite project" })
    ).body;
    assert.equal(
      (await request("/projects", "POST", { name: "  " })).status,
      400,
    );
    const item = (
      await request(`/projects/${project.id}/items`, "POST", {
        title: "First idea",
        description: "",
        type: "idea",
        priority: "medium",
        status: "ideas",
        next_actor: "user",
        next_action: "Test after restart",
        acceptance_criteria: [{ text: "Persisted across restarts", completed: false }],
      })
    ).body;
    assert.equal(
      (
        await request(`/projects/${project.id}/items/${item.id}`, "PATCH", {
          ...item,
          title: "Refined idea",
          status: "testing",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/items/${item.id}/notes`, "POST", {
          body: "Persistent note",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(`/items/${item.id}/archive`, "PATCH", { archived: true }))
        .status,
      200,
    );
    assert.equal(
      (
        await request(`/items/${item.id}/archive`, "PATCH", {
          archived: "false",
        })
      ).status,
      400,
    );
    const second = (
      await request("/projects", "POST", { name: "Second project" })
    ).body;
    assert.equal(
      (
        await request(`/projects/${second.id}/items/${item.id}`, "PATCH", {
          ...item,
          title: "Wrong project",
        })
      ).status,
      404,
    );
    await server.close();
    server = await startLocalServer({
      databasePath: join(directory, "devpilot.sqlite"),
      port: 0,
    });
    assert.equal((await request("/auth/session")).body.id, "local-dev", "Login survives an API restart");
    const persisted = (await request(`/projects/${project.id}/items`)).body[0];
    assert.equal(persisted.title, "Refined idea");
    assert.equal(persisted.status, "testing");
    assert.equal(persisted.next_action, "Test after restart");
    assert.deepEqual(persisted.acceptance_criteria, [{ text: "Persisted across restarts", completed: false }]);
    assert.ok(persisted.archived_at);
    assert.equal(
      (await request(`/items/${item.id}/notes`)).body[0].body,
      "Persistent note",
    );
    await request(`/items/${item.id}/archive`, "PATCH", { archived: false });
    await request(`/projects/${project.id}`, "PATCH", { name: "Renamed" });
    assert.equal((await request("/projects")).body[0].name, "Renamed");
    await request(`/projects/${project.id}`, "DELETE");
    assert.equal((await request(`/items/${item.id}/notes`)).status, 404);
    const signedInCookie = cookie;
    assert.equal((await request("/auth/logout", "POST")).status, 200);
    cookie = signedInCookie;
    assert.equal((await request("/projects")).status, 401);
  } finally {
    await server.close();
    assert.ok(directory.startsWith(join(tmpdir(), "devpilot-sqlite-")));
    await rm(directory, { recursive: true, force: true });
  }
});

test("local API rejects cross-origin changes and missing request guards", async () => {
  const server = await startLocalServer({ databasePath: ":memory:", port: 0 });
  try {
    const body = JSON.stringify({ username: "dev", password: "dev" });
    assert.equal(
      (
        await fetch(`${server.url}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${server.url}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-DevPilot-Local": "1",
            Origin: "https://example.com",
          },
          body,
        })
      ).status,
      403,
    );
  } finally {
    await server.close();
  }
});
