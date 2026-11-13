import { test } from "node:test";
import assert from "node:assert/strict";
import { startLocalServer } from "./server.mjs";
import { tailscaleAddress } from "../scripts/tailscale.mjs";

test("Tailscale mode requires a connected local IPv4 address", () => {
  const interfaces = { Tailscale: [{ address: "100.90.80.70", internal: false }] };
  assert.equal(tailscaleAddress({ BackendState: "Running", TailscaleIPs: ["100.90.80.70"] }, interfaces), "100.90.80.70");
  for (const status of [
    { BackendState: "Stopped", TailscaleIPs: ["100.90.80.70"] },
    { BackendState: "Running", TailscaleIPs: ["192.168.1.2"] },
    { BackendState: "Running", TailscaleIPs: ["100.90.80.71"] },
  ]) assert.throws(() => tailscaleAddress(status, interfaces), /Tailscale/);
});

test("phone origin can log in through the loopback proxy, but other origins and MCP stay blocked", async () => {
  const origin = "http://100.90.80.70:4200";
  const server = await startLocalServer({ databasePath: ":memory:", port: 0, browserOrigin: origin });
  const login = (value) => fetch(`${server.url}/api/auth/login`, {
    method: "POST",
    headers: { Origin: value, "Content-Type": "application/json", "X-DevPilot-Local": "1" },
    body: JSON.stringify({ username: "dev", password: "dev" }),
  });
  try {
    const response = await login(origin);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${server.url}/api/projects`, { headers: { Origin: origin, Cookie: cookie, "X-DevPilot-Local": "1" } })).status, 200);
    for (const bad of ["http://100.90.80.71:4200", "http://100.90.80.70:4201", "https://example.com", "null"]) {
      assert.equal((await login(bad)).status, 403);
    }
    assert.equal((await fetch(`${server.url}/mcp`, { headers: { Origin: origin } })).status, 403);
    assert.equal((await fetch(`${server.url}/api/projects`, { headers: { Origin: origin, "X-DevPilot-Local": "1" } })).status, 401);
  } finally { await server.close(); }
  const local = await startLocalServer({ databasePath: ":memory:", port: 0 });
  try {
    assert.equal((await fetch(`${local.url}/api/health`, { headers: { Origin: origin } })).status, 403);
  } finally { await local.close(); }
});
