import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startLocalServer } from "./server.mjs";

test("revocation blocks a write whose request body was still arriving", async () => {
  const server = await startLocalServer({ databasePath: ":memory:", port: 0 });
  let cookie = "";
  let pending;
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`${server.url}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-DevPilot-Local": "1",
        Cookie: cookie,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return response.json();
  };
  try {
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    const project = await api("/projects", "POST", { name: "Revocation test" });
    const connection = await api(
      `/projects/${project.id}/connections`,
      "POST",
      { name: "Slow client", permission: "edit" },
    );
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_item",
        arguments: { title: "Must not be written" },
      },
    });
    const completed = new Promise((resolve, reject) => {
      pending = httpRequest(
        `${server.url}/mcp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      pending.on("error", reject);
      pending.write(payload.slice(0, 12));
    });
    let authorized = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await api(`/projects/${project.id}/connections`))[0].last_used_at) {
        authorized = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(
      authorized,
      "The incomplete request must have passed initial authorization.",
    );
    await api(`/projects/${project.id}/connections/${connection.id}`, "DELETE");
    pending.end(payload.slice(12));
    await completed;
    assert.equal((await api(`/projects/${project.id}/items`)).length, 0);
  } finally {
    pending?.destroy();
    await server.close();
  }
});

test("real MCP client discovers scoped tools, persists edits, denies cross-project access and respects revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-mcp-"));
  const databasePath = join(directory, "test.sqlite");
  let server = await startLocalServer({ databasePath, port: 0 });
  let cookie = "";
  const clients = [];
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`${server.url}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-DevPilot-Local": "1",
        Cookie: cookie,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, data: await response.json() };
  };
  const connect = async (token) => {
    const client = new Client({
      name: "DevPilot integration test",
      version: "1.0.0",
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  };
  const result = async (client, name, args = {}) => {
    const value = await client.callTool({ name, arguments: args });
    assert.notEqual(value.isError, true, JSON.stringify(value));
    return JSON.parse(value.content[0].text);
  };
  try {
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    const project = (
      await api("/projects", "POST", { name: "Connected project" })
    ).data;
    const other = (
      await api("/projects", "POST", { name: "Other private project" })
    ).data;
    const otherItem = (
      await api(`/projects/${other.id}/items`, "POST", {
        title: "Private task",
        description: "Do not disclose",
        type: "task",
        priority: "medium",
        status: "todo",
      })
    ).data;
    const created = await api(`/projects/${project.id}/connections`, "POST", {
      name: "Codex",
      permission: "edit",
    });
    assert.equal(created.status, 200);
    assert.match(created.data.token, /^dp_[a-f0-9]{64}$/);
    const token = created.data.token;
    const stored = new DatabaseSync(databasePath, { readOnly: true });
    const row = stored
      .prepare("select token_hash from ai_connections where id=?")
      .get(created.data.id);
    stored.close();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash.length, 64);
    const listed = (await api(`/projects/${project.id}/connections`)).data;
    assert.equal("token" in listed[0], false);
    assert.equal("token_hash" in listed[0], false);
    const client = await connect(token);
    assert.deepEqual(
      (await client.listTools()).tools.map((t) => t.name).sort(),
      [
        "get_project",
        "list_items",
        "get_item",
        "create_item",
        "update_item",
        "add_note",
      ].sort(),
    );
    assert.equal((await result(client, "get_project")).id, project.id);
    const item = await result(client, "create_item", { title: "New idea" });
    assert.equal(item.status, "ideas");
    const edited = await result(client, "update_item", {
      id: item.id,
      title: "Ready to build",
      status: "todo",
      priority: "high",
    });
    assert.equal(edited.status, "todo");
    const codexNote = await result(client, "add_note", {
      item_id: item.id,
      body: "Written by MCP",
      images: [{ name: 'Suggestion', mime_type: 'image/png', data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }],
    });
    assert.equal(codexNote.author, "codex");
    assert.match(codexNote.body, /!\[Suggestion\]\(\/api\/note-images\//);
    const userNote = (await api(`/items/${item.id}/notes`, "POST", { body: "Written in app", author: "codex" })).data;
    assert.equal(userNote.author, "user");
    assert.deepEqual((await api(`/items/${item.id}/notes`)).data.map(note => note.author), ["codex", "user"]);
    assert.equal((await api(`/notes/${codexNote.id}`, "PATCH", { body: "Tampered" })).status, 403);
    assert.equal((await api(`/notes/${codexNote.id}`, "DELETE")).status, 403);
    assert.equal((await api(`/notes/${userNote.id}`, "PATCH", { body: "  " })).status, 400);
    const changedNote = await api(`/notes/${userNote.id}`, "PATCH", { body: "Edited in app", author: "codex" });
    assert.equal(changedNote.status, 200);
    assert.equal(changedNote.data.body, "Edited in app");
    assert.equal(changedNote.data.author, "user");
    assert.equal(changedNote.data.created_at, userNote.created_at);
    const disposable = (await api(`/items/${item.id}/notes`, "POST", { body: "Remove me" })).data;
    assert.equal((await api(`/notes/${disposable.id}`, "DELETE")).status, 200);
    assert.equal((await api(`/notes/${disposable.id}`, "DELETE")).status, 404);
    assert.equal(
      (await result(client, "get_item", { id: item.id })).notes[0].body,
      codexNote.body,
    );
    assert.equal(
      (await result(client, "list_items", { status: "todo" })).items[0].title,
      "Ready to build",
    );
    const denied = await client.callTool({
      name: "get_item",
      arguments: { id: otherItem.id },
    });
    assert.equal(denied.isError, true);
    assert.ok(!JSON.stringify(denied).includes("Do not disclose"));
    assert.equal(
      (
        await client.callTool({
          name: "update_item",
          arguments: { id: otherItem.id, title: "Intrusion" },
        })
      ).isError,
      true,
    );
    const readonly = (
      await api(`/projects/${project.id}/connections`, "POST", {
        name: "Read only",
        permission: "read",
      })
    ).data;
    const reader = await connect(readonly.token);
    assert.deepEqual(
      (await reader.listTools()).tools.map((t) => t.name).sort(),
      ["get_item", "get_project", "list_items"].sort(),
    );
    assert.equal(
      (
        await reader.callTool({
          name: "create_item",
          arguments: { title: "Blocked" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (await api(`/projects/${project.id}/connections`)).data.find(
        (c) => c.id === created.data.id,
      ).last_used_at !== null,
      true,
    );
    for (const c of clients.splice(0)) await c.close();
    await server.close();
    server = await startLocalServer({ databasePath, port: 0 });
    const restored = await connect(token);
    assert.deepEqual((await result(restored, "get_item", { id: item.id })).notes.map(note => note.author), ["codex", "user"]);
    assert.equal((await result(restored, "get_item", { id: item.id })).notes[1].body, "Edited in app");
    assert.equal(
      (await result(restored, "list_items")).items[0].title,
      "Ready to build",
    );
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    assert.equal(
      (
        await api(
          `/projects/${project.id}/connections/${created.data.id}`,
          "DELETE",
        )
      ).status,
      200,
    );
    await assert.rejects(restored.listTools());
    assert.equal(
      (await api(`/projects/${other.id}/items`)).data[0].title,
      "Private task",
    );
  } finally {
    for (const c of clients) await c.close();
    await server.close();
    assert.ok(directory.startsWith(join(tmpdir(), "devpilot-mcp-")));
    await rm(directory, { recursive: true, force: true });
  }
});
