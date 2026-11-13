import { spawn } from 'node:child_process';

function standaloneEnvironment() {
  const env = { ...process.env };
  // A new App Server is a standalone client, not a child of the desktop app's
  // registered Core/session/tool bridge. Keep user configuration and credentials
  // (including CODEX_HOME) while dropping only the parent's private identity.
  const privateKeys = new Set([
    'CODEX_APP_RUNTIME_CLI_PATH', 'CODEX_APP_TOOLS_PIPE_PATH',
    'CODEX_WINDOWS_REGISTERED_CORE', 'CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY',
    'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID',
    'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  ]);
  for (const key of Object.keys(env)) if (privateKeys.has(key.toUpperCase())) delete env[key];
  return env;
}

/** Private stdio connection: the executable is configured by the host, never HTTP. */
export class CodexRpc {
  sequence = 0;
  pending = new Map();
  buffer = '';
  closed = false;
  constructor(command, cwd, onMessage, onClose) {
    this.child = spawn(command[0], [...command.slice(1), 'app-server'], {
      cwd, env: standaloneEnvironment(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    const fail = error => {
      if (this.closed) return;
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
      this.pending.clear();
      onClose(error);
    };
    this.child.on('error', error => fail(new Error(`Cannot start the Codex executable (${error.code || 'spawn failed'}). Check its installation or DEVPILOT_CODEX_BIN setting.`)));
    this.child.stdin.on('error', () => fail(new Error('Codex App Server input closed.')));
    this.child.on('close', code => fail(new Error(`Codex App Server exited (${code ?? 'no exit code'}).`)));
    // Drain stderr without storing credentials or unbounded diagnostic output.
    this.child.stderr.resume();
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (this.buffer.length > 8_000_000) { fail(new Error('Codex response exceeded the message limit.')); this.close(); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (!message.method && this.pending.has(message.id)) {
            const request = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(request.timer);
            if (message.error) request.reject(new Error(message.error.message || 'Codex request failed.'));
            else request.resolve(message.result);
          } else onMessage(message);
        } catch (error) { fail(new Error('Codex sent an invalid response.')); this.close(); return; }
      }
    });
  }
  send(message) {
    if (this.closed) throw new Error('Codex App Server is disconnected.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() {
    if (!this.child.killed) this.child.kill();
    return this.exited;
  }
}
