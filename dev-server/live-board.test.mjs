import { test } from "node:test";
import assert from "node:assert/strict";
import { startLocalServer } from "./server.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function eventFrames(reader) {
  let buffer = "";
  const decoder = new TextDecoder();
  return async () => {
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame.startsWith(":")) continue;
        return frame;
      }
      const chunk = await reader.read();
      assert.equal(chunk.done, false, "Event stream must stay connected");
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
}

test("account stream includes project creation, raw rename, connection changes and deletion", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-project-live-"));
  const databasePath = join(directory, "live.sqlite");
  const server = await startLocalServer({ databasePath, port: 0 });
  const db = new DatabaseSync(databasePath);
  let reader;
  let cookie = "";
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`${server.url}/api${path}`, {
      method, headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    assert.equal((await fetch(`${server.url}/api/events`)).status, 401);
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    const response = await fetch(`${server.url}/api/events`, { headers: { Cookie: cookie } });
    reader = response.body.getReader();
    const next = eventFrames(reader);
    assert.match(await next(), /event: ready/);
    const project = await api("/projects", "POST", { name: "Shared project" });
    assert.match(await next(), /event: change/);
    await api(`/projects/${project.id}`, "PATCH", { name: "Renamed in app" });
    assert.match(await next(), /event: change/);
    db.prepare("update projects set name=? where id=?").run("Renamed through SQL", project.id);
    assert.match(await next(), /event: change/);
    assert.equal((await api("/projects"))[0].name, "Renamed through SQL");
    const connection = await api(`/projects/${project.id}/connections`, "POST", { name: "Shared connection", permission: "edit" });
    assert.match(await next(), /event: change/);
    await api(`/projects/${project.id}/connections/${connection.id}`, "DELETE");
    assert.match(await next(), /event: change/);
    await api(`/projects/${project.id}`, "DELETE");
    assert.match(await next(), /event: change/);
    assert.deepEqual(await api("/projects"), []);
    // Another account's revisions cannot notify this viewer.
    db.prepare("insert into users select ?,?,salt,password_hash from users where id='local-dev'").run("other-user", "other");
    const nextEvent = next();
    db.prepare("insert into projects values (?,?,?,?)").run("private-project", "other-user", "Private", new Date().toISOString());
    const now = new Date().toISOString();
    db.prepare("insert into items(id,project_id,title,type,priority,status,created_at,updated_at) values (?,?,?,?,?,?,?,?)")
      .run("private-card", "private-project", "Private card", "idea", "medium", "ideas", now, now);
    db.prepare("insert into notes(id,item_id,body,created_at,author) values (?,?,?,?,?)")
      .run("private-note", "private-card", "Private note text", now, "codex");
    assert.equal(await Promise.race([nextEvent.then(() => "unexpected event"), new Promise(resolve => setTimeout(() => resolve("quiet"), 1100))]), "quiet");
    // Release the pending read using a legitimate notification for this account.
    await api("/projects", "POST", { name: "Visible project" });
    assert.match(await nextEvent, /event: change/);
  } finally {
    await reader?.cancel();
    db.close();
    await server.close();
    assert.ok(directory.startsWith(join(tmpdir(), "devpilot-project-live-")));
    await rm(directory, { recursive: true, force: true });
  }
});

test("authenticated project stream reports MCP creates, edits and browser archives", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-live-"));
  const databasePath = join(directory, "live.sqlite");
  const server = await startLocalServer({ databasePath, port: 0 });
  const externalDb = new DatabaseSync(databasePath);
  let cookie = "";
  let reader;
  let client;
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`${server.url}/api${path}`, {
      method, headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const denied = await fetch(`${server.url}/api/projects/missing/events`);
    assert.equal(denied.status, 401);
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    const project = await api("/projects", "POST", { name: "Live board" });
    const missing = await fetch(`${server.url}/api/projects/missing/events`, { headers: { Cookie: cookie } });
    assert.equal(missing.status, 404);
    const stream = await fetch(`${server.url}/api/projects/${project.id}/events`, { headers: { Cookie: cookie } });
    assert.equal(stream.headers.get("content-type"), "text/event-stream");
    reader = stream.body.getReader();
    const next = eventFrames(reader);
    const nextNote = async (operation) => {
      for (;;) {
        const frame = await next();
        if (!frame.startsWith("event: note\n")) continue;
        const event = JSON.parse(frame.split("data: ")[1]);
        assert.equal(event.operation, operation);
        return event;
      }
    };
    assert.match(await next(), /event: ready/);
    const connection = await api(`/projects/${project.id}/connections`, "POST", { name: "Live test", permission: "edit" });
    client = new Client({ name: "live-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }));
    await client.callTool({ name: "create_item", arguments: { title: "Pushed through MCP" } });
    assert.match(await next(), /event: change/);
    const [item] = await api(`/projects/${project.id}/items`);
    await client.callTool({ name: "update_item", arguments: { id: item.id, title: "Edited through MCP", status: "in_progress" } });
    assert.match(await next(), /event: change/);
    assert.equal((await api(`/projects/${project.id}/items`))[0].title, "Edited through MCP");
    await api(`/items/${item.id}/archive`, "PATCH", { archived: true });
    assert.match(await next(), /event: change/);
    await client.callTool({ name: "add_note", arguments: { item_id: item.id, body: "Codex note" } });
    assert.equal((await nextNote("insert")).note.body, "Codex note");
    const note = await api(`/items/${item.id}/notes`, "POST", { body: "User note" });
    assert.equal((await nextNote("insert")).note_id, note.id);
    const beforeRevision = externalDb.prepare("select revision from card_revisions where project_id=?").get(item.project_id).revision;
    await api(`/notes/${note.id}`, "PATCH", { body: "User edit" });
    const editedEvent = await nextNote("update");
    assert.equal(editedEvent.note.body, "User edit");
    assert.ok(editedEvent.note.edited_at, "Live note payload includes its edited label");
    await api(`/notes/${note.id}`, "DELETE");
    const deleted = await nextNote("delete");
    assert.equal(deleted.note_id, note.id);
    assert.equal(deleted.note, undefined, "A deletion event must not retain deleted note text");
    assert.equal(externalDb.prepare("select revision from card_revisions where project_id=?").get(item.project_id).revision, beforeRevision, "Note events must not invalidate the whole board");
    const history = await api(`/items/${item.id}/activity`);
    const removedNoteEvent = history.find(event => event.kind === 'note_deleted');
    assert.ok(removedNoteEvent);
    await api(`/items/${item.id}/activity/${removedNoteEvent.id}`, "DELETE");
    assert.match(await next(), /event: change/, "Dismissing history invalidates other open cards");
    assert.equal((await api(`/items/${item.id}/activity`)).length, history.length - 1);
    // Reproduce the exact administrative workaround: a Codex-authored note
    // deleted directly through a separate connection, without app callbacks.
    const [codexNote] = await api(`/items/${item.id}/notes`);
    assert.equal(codexNote.author, "codex");
    externalDb.prepare("delete from notes where id=? and item_id=?").run(codexNote.id, item.id);
    assert.equal((await nextNote("delete")).note_id, codexNote.id);
    assert.deepEqual(await api(`/items/${item.id}/notes`), []);
    const burst = await api(`/items/${item.id}/notes`, "POST", { body: "First" });
    await nextNote("insert");
    const beforeRollback = externalDb.prepare("select count(*) as count from note_events").get().count;
    externalDb.exec("BEGIN IMMEDIATE");
    externalDb.prepare("update notes set body=? where id=?").run("Must never be published", burst.id);
    externalDb.exec("ROLLBACK");
    assert.equal(externalDb.prepare("select count(*) as count from note_events").get().count, beforeRollback);
    externalDb.exec("BEGIN IMMEDIATE");
    externalDb.prepare("update notes set body=? where id=?").run("Second", burst.id);
    externalDb.prepare("update notes set body=? where id=?").run("Third", burst.id);
    externalDb.prepare("delete from notes where id=?").run(burst.id);
    externalDb.exec("COMMIT");
    assert.equal((await nextNote("update")).note.body, "Second");
    assert.equal((await nextNote("update")).note.body, "Third");
    assert.equal((await nextNote("delete")).note_id, burst.id);
    // Reconnection starts with a ready event and a canonical notes fetch.
    await reader.cancel();
    const reconnected = await fetch(`${server.url}/api/projects/${project.id}/events`, { headers: { Cookie: cookie } });
    reader = reconnected.body.getReader();
    const resumed = eventFrames(reader);
    assert.match(await resumed(), /event: ready/);
    assert.deepEqual(await api(`/items/${item.id}/notes`), []);
    externalDb.prepare("update items set description=?,priority=? where id=?").run("Raw text update", "urgent", item.id);
    assert.match(await resumed(), /event: change/);
    assert.equal((await api(`/projects/${project.id}/items`))[0].description, "Raw text update");
    externalDb.prepare("delete from items where id=?").run(item.id);
    assert.match(await resumed(), /event: change/);
    assert.deepEqual(await api(`/projects/${project.id}/items`), []);
    const retained = await api(`/projects/${project.id}/items`, "POST", { title: "Retention", description: "", type: "idea", priority: "medium", status: "ideas" });
    assert.match(await resumed(), /event: change/);
    externalDb.exec("BEGIN IMMEDIATE");
    const insertNote = externalDb.prepare("insert into notes(id,item_id,body,created_at,author) values (?,?,?,?,?)");
    for (let index = 0; index < 520; index++) insertNote.run(`retained-${index}`, retained.id, "Burst note", new Date().toISOString(), "codex");
    externalDb.exec("COMMIT");
    assert.equal(externalDb.prepare("select count(*) as count from note_events").get().count, 512);
    assert.match(await resumed(), /event: resync/, "A gap in the bounded event log must request a fresh snapshot");
  } finally {
    await reader?.cancel();
    await client?.close();
    externalDb.close();
    await server.close();
    assert.ok(directory.startsWith(join(tmpdir(), "devpilot-live-")));
    await rm(directory, { recursive: true, force: true });
  }
});
