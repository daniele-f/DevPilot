import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startLocalServer } from "../dev-server/server.mjs";

const server = await startLocalServer();
console.log(`Local SQLite API: ${server.url}`);
console.log(`Database: ${resolve(".local/devpilot.sqlite")}`);
console.log("Local login: dev / dev");
const frontend = spawn(
  process.execPath,
  [
    "node_modules/@angular/cli/bin/ng.js",
    "serve",
    "--host",
    "127.0.0.1",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (frontend.exitCode === null) frontend.kill();
  await server.close();
  process.exit(code);
}
frontend.on("error", (error) => {
  console.error(error.message);
  void stop(1);
});
frontend.on("exit", (code, signal) => void stop(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void stop(0));
