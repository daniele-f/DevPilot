import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';

function file(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}
function windowsDesktopLocation(env) {
  // Query the current user's registered package rather than hard-coding a version.
  const powershell = join(env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation"],
    { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}
function commandFor(path, platform) {
  if (!file(path)) return null;
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    // Node cannot spawn Windows command shims without a shell. Use the official
    // npm entrypoint directly instead, preserving argument boundaries and spaces.
    const script = join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    return file(script) ? [process.execPath, script] : null;
  }
  if (platform === 'win32' && !/\.exe$/i.test(path)) return null;
  return [path];
}

/** Resolve at each run so desktop app upgrades do not leave a stale binary path. */
export function resolveCodexCommand({ env = process.env, platform = process.platform, desktopLocation = () => windowsDesktopLocation(env) } = {}) {
  if (env.DEVPILOT_CODEX_BIN) {
    const path = env.DEVPILOT_CODEX_BIN.trim().replace(/^"(.*)"$/, '$1');
    const command = isAbsolute(path) ? commandFor(path, platform) : null;
    if (!command) throw new Error('DEVPILOT_CODEX_BIN must point to an existing Codex executable or official npm command shim.');
    return command;
  }
  const pathKey = Object.keys(env).find(key => platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');
  for (const entry of (env[pathKey] || '').split(platform === 'win32' ? ';' : ':')) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(directory)) continue;
    for (const name of platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']) {
      const command = commandFor(join(directory, name), platform);
      if (command) return command;
    }
  }
  if (platform === 'win32') {
    const directory = desktopLocation();
    const command = directory && isAbsolute(directory) ? commandFor(join(directory, 'app', 'resources', 'codex.exe'), platform) : null;
    if (command) return command;
  }
  throw new Error('Cannot find Codex. Install the Codex desktop app or CLI, or set DEVPILOT_CODEX_BIN to its executable path, then retry.');
}
