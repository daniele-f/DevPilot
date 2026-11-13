import { test } from "node:test";
import assert from "node:assert/strict";
import { startLocalServer } from "./server.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("workflow fields round-trip, preserve omitted edits and reject malformed checklists", async () => {
  const server = await startLocalServer({ databasePath: ":memory:", port: 0 });
  let cookie = "";
  const api = async (path, method = "GET", value) => {
    const response = await fetch(`${server.url}/api${path}`, { method, headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: cookie }, ...(value ? { body: JSON.stringify(value) } : {}) });
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, value: await response.json() };
  };
  try {
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    const project = (await api("/projects", "POST", { name: "Workflow QA" })).value;
    const base = { title: "Ready for review", description: "", type: "feature", priority: "medium", status: "testing" };
    const workflow = { next_actor: "user", next_action: "Try the mobile flow", acceptance_criteria: [{ text: "Works on mobile", completed: false }] };
    const created = await api(`/projects/${project.id}/items`, "POST", { ...base, ...workflow });
    assert.equal(created.status, 200);
    assert.equal(created.value.next_actor, "user");
    assert.deepEqual(created.value.acceptance_criteria, workflow.acceptance_criteria);
    const path = `/projects/${project.id}/items/${created.value.id}`;
    assert.equal((await api(path, "PATCH", { ...base, title: "Revised" })).value.next_action, workflow.next_action);
    const completed = await api(path, "PATCH", { ...base, ...workflow, acceptance_criteria: [{ text: "Works on mobile", completed: true }] });
    assert.equal(completed.value.status, "testing", "Checking acceptance never automatically marks Done");
    for (const invalid of [{ next_actor: "robot" }, { next_action: "x".repeat(2001) }, { acceptance_criteria: [{ text: "", completed: false }] }, { acceptance_criteria: [{ text: "Works", completed: "yes" }] }, { acceptance_criteria: Array(51).fill({ text: "Many", completed: false }) }]) {
      assert.equal((await api(path, "PATCH", { ...base, ...invalid })).status, 400);
    }
    const cleared = await api(path, "PATCH", { ...base, next_actor: null, next_action: "", acceptance_criteria: [] });
    assert.equal(cleared.value.next_actor, null);
    assert.deepEqual(cleared.value.acceptance_criteria, []);
    const stored = (await api(`/projects/${project.id}/items`)).value[0];
    assert.deepEqual(stored.acceptance_criteria, []);
    const connection = (await api(`/projects/${project.id}/connections`, "POST", { name: "Workflow client", permission: "edit" })).value;
    const client = new Client({ name: "Workflow QA", version: "1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }));
      const changed = await client.callTool({ name: "update_item", arguments: { id: created.value.id, next_actor: "codex", next_action: "Address feedback", acceptance_criteria: workflow.acceptance_criteria } });
      assert.ok(!changed.isError);
      assert.equal(JSON.parse(changed.content[0].text).next_actor, "codex");
      const titleOnly = await client.callTool({ name: "update_item", arguments: { id: created.value.id, title: "Review again" } });
      const persisted = JSON.parse(titleOnly.content[0].text);
      assert.equal(persisted.next_action, "Address feedback");
      assert.deepEqual(persisted.acceptance_criteria, workflow.acceptance_criteria);
      const details = await client.callTool({ name: "get_item", arguments: { id: created.value.id } });
      const history = JSON.parse(details.content[0].text).activity;
      assert.equal(history.at(-1).actor, "codex");
      assert.equal(history.at(-1).field, "title");
      assert.equal(history.at(-1).new_value, "Review again");
      assert.equal(history[0].actor, "user", "MCP must not rewrite prior attribution");
      const privateNote = (await api(`/items/${created.value.id}/notes`, "POST", { body: "A user-deleted note" })).value;
      await api(`/notes/${privateNote.id}`, "DELETE");
      const personalHistory = (await api(`/items/${created.value.id}/activity`)).value;
      assert.equal(personalHistory.at(-1).kind, "note_deleted");
      const afterDeletion = await client.callTool({ name: "get_item", arguments: { id: created.value.id } });
      const visibleToCodex = JSON.parse(afterDeletion.content[0].text);
      assert.ok(!visibleToCodex.activity.some(event => event.kind === "note_deleted"));
      assert.equal(visibleToCodex.total_activity, personalHistory.length - 1, "Private events must not leak through history counts");
      const listed = await client.callTool({ name: "list_items", arguments: {} });
      assert.equal(JSON.parse(listed.content[0].text).items[0].next_actor, "codex");
    } finally { await client.close(); }
  } finally { await server.close(); }
});
