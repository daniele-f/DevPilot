import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function launchLocalApi({ entrypoint = fileURLToPath(new URL('../dev-server/server.mjs', import.meta.url)), cwd = process.cwd(), stdio = 'inherit' } = {}) {
  // This process owns the agent's stdio connection. A source watcher would kill
  // that connection whenever Codex edits the backend it is working on.
  return spawn(process.execPath, [entrypoint], { cwd, stdio, windowsHide: true });
}
