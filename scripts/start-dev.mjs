import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { inspectDevelopment } from "./dev-status.mjs";
import { workspaceIdentity } from "../dev-server/workspace-identity.mjs";
import { acquireDevInstance } from "./dev-instance.mjs";
import { detectTailscaleAddress } from "./tailscale.mjs";
import { launchLocalApi } from './local-api-process.mjs';

const tailscale = process.argv.includes("--tailscale");
const args = process.argv.slice(2).filter((value) => value !== "--tailscale");
const portIndex = args.indexOf("--port");
const frontendPort = Number(
  args.find((value) => value.startsWith("--port="))?.split("=")[1] ??
    (portIndex >= 0 ? args[portIndex + 1] : 4200),
);
if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535)
  throw new Error("Choose a valid development port.");
let frontendHost = "127.0.0.1";
let frontendUrl = `http://${frontendHost}:${frontendPort}`;

const children = [];
let stopping = false;
let instance;
function launch(args) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  return track(child);
}
function track(child) {
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  instance?.close();
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    // Only terminate process trees created by this launcher.
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

try {
  if (tailscale) {
    if (args.some((value) => /^(--host|--proxy-config|--configuration|-c|--ssl|--allowed-hosts|--disable-host-check)(=|$)/.test(value)))
      throw new Error("Tailscale mode manages its host, HTTP and proxy settings. Use --port to choose another port.");
    frontendHost = detectTailscaleAddress();
    frontendUrl = `http://${frontendHost}:${frontendPort}`;
  }
  // Explicitly clear inherited settings for normal loopback-only startup.
  process.env.DEVPILOT_BROWSER_ORIGIN = tailscale ? frontendUrl : "";
  instance = await acquireDevInstance();
  const existing = await inspectDevelopment({
    apiUrl: "http://127.0.0.1:4202",
    frontendUrl,
    workspaceId: workspaceIdentity(resolve(".local/devpilot.sqlite")),
  });
  if (existing.apiRunning || existing.frontendRunning)
    throw new Error(
      "DevPilot is already running. Stop it from its original command window with Ctrl+C before starting again.",
    );
  track(launchLocalApi());
  let ready = false;
  for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4202/api/health", {
        headers: { "X-DevPilot-Local": "1" },
        signal: AbortSignal.timeout(500),
      });
      if (
        response.ok &&
        (await response.json()).capabilities?.includes("mcp")
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw new Error(
      "The local API failed to start. Review the error above for the cause.",
    );
  console.log("Local SQLite API: http://127.0.0.1:4202");
  console.log(`Database: ${resolve(".local/devpilot.sqlite")}`);
  console.log("Local login: dev / dev. Restart this launcher to apply backend changes after Codex finishes.");
  if (tailscale) {
    console.log(`Phone and PC URL: ${frontendUrl}`);
    console.log("Keep Tailscale connected on both devices. Press Ctrl+C here to stop DevPilot.");
  }
  launch([
    "node_modules/@angular/cli/bin/ng.js",
    "serve",
    "--host",
    frontendHost,
    ...(tailscale ? ["--proxy-config", "proxy.tailscale.conf.json"] : []),
    ...args,
  ]);
} catch (error) {
  console.error(error.message);
  stop(1);
}
