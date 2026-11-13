import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspectDevelopment } from "../scripts/dev-status.mjs";

async function fixture(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
test("startup detects existing API and frontend before attempting to bind their ports", async () => {
  const api = await fixture((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: "DevPilot local API",
        workspace_id: "workspace",
        capabilities: ["mcp"],
      }),
    );
  });
  const frontend = await fixture((req, res) =>
    res.end("<title>DevPilot</title><app-root></app-root>"),
  );
  try {
    assert.deepEqual(
      await inspectDevelopment({
        apiUrl: api.url,
        frontendUrl: frontend.url,
        workspaceId: "workspace",
      }),
      { apiRunning: true, frontendRunning: true },
    );
  } finally {
    await frontend.close();
    await api.close();
  }
});
test("the launcher refuses unrelated servers and another workspace", async () => {
  const api = await fixture((req, res) =>
    res.end(
      JSON.stringify({
        name: "DevPilot local API",
        workspace_id: "other-workspace",
        capabilities: ["mcp"],
      }),
    ),
  );
  const frontend = await fixture((req, res) => res.end("Another application"));
  try {
    await assert.rejects(
      inspectDevelopment({
        apiUrl: api.url,
        frontendUrl: frontend.url,
        workspaceId: "workspace",
      }),
      /another|occupied/,
    );
    await assert.rejects(
      inspectDevelopment({
        apiUrl: api.url,
        frontendUrl: frontend.url,
        workspaceId: "other-workspace",
      }),
      /frontend port is occupied by another application/,
    );
  } finally {
    await frontend.close();
    await api.close();
  }
});
