import { connect } from "node:net";

async function portOpen(url) {
  const target = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({
      host: target.hostname,
      port: Number(target.port) || 80,
    });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
export async function inspectDevelopment({ apiUrl, frontendUrl, workspaceId }) {
  let apiRunning = false;
  let frontendRunning = false;
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      headers: { "X-DevPilot-Local": "1" },
      signal: AbortSignal.timeout(800),
    });
    const value = await response.json();
    apiRunning =
      response.ok &&
      value.name === "DevPilot local API" &&
      value.workspace_id === workspaceId &&
      value.capabilities?.includes("mcp");
  } catch {}
  if (!apiRunning && (await portOpen(apiUrl)))
    throw new Error(
      `The API port is occupied by an outdated server or another workspace. Close its old launcher first: ${apiUrl}`,
    );
  try {
    const response = await fetch(frontendUrl, {
      signal: AbortSignal.timeout(800),
    });
    const html = await response.text();
    frontendRunning =
      response.ok &&
      html.includes("<app-root") &&
      /<title>DevPilot\b/i.test(html);
  } catch {}
  if (!frontendRunning && (await portOpen(frontendUrl)))
    throw new Error(
      `The frontend port is occupied by another application: ${frontendUrl}`,
    );
  return {
    apiRunning: Boolean(apiRunning),
    frontendRunning: Boolean(frontendRunning),
  };
}
