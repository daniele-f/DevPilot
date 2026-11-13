import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('the launcher API process keeps an active story run alive when backend source changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'devpilot-api-lifetime-'));
  const worker = join(directory, 'api.mjs');
  const serverModule = new URL('./server.mjs', import.meta.url).href;
  const fixture = fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url));
  await writeFile(worker, `import {startLocalServer} from ${JSON.stringify(serverModule)};\nconst api=await startLocalServer({port:0,databasePath:':memory:',codexCommand:${JSON.stringify([process.execPath, fixture])}});\nconsole.log(api.url);\nprocess.on('SIGTERM',()=>void api.close().then(()=>process.exit(0)));\n`);
  const { launchLocalApi } = await import('../scripts/local-api-process.mjs');
  const child = launchLocalApi({ entrypoint: worker, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    if (process.platform === 'win32' && child.exitCode === null)
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
    await exited;
    assert.ok(directory.startsWith(join(tmpdir(), 'devpilot-api-lifetime-')));
    await rm(directory, { recursive: true, force: true });
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  child.stderr.resume();
  let cookie = '';
  const request = async (path, method = 'GET', value) => {
    const res = await fetch(url + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-DevPilot-Local': '1', Cookie: cookie }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    if (res.headers.has('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    assert.equal(res.status, 200);
    return res.json();
  };
  await request('/auth/login', 'POST', { username: 'dev', password: 'dev' });
  const project = await request('/projects', 'POST', { name: 'Stable runner' });
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd: directory });
  const story = await request(`/projects/${project.id}/items`, 'POST', { title: 'Keep running', description: 'MODE:hang', type: 'task', priority: 'medium', status: 'todo' });
  await request(`/items/${story.id}/codex`, 'POST', {});
  for (let i = 0; i < 100; i++) {
    const state = await request(`/items/${story.id}/codex`);
    if (state.status === 'running') break;
    assert.ok(i < 99, 'Run must start');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await appendFile(worker, '\n// Backend edit during an agent turn.\n');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const state = await request(`/items/${story.id}/codex`);
  assert.equal(state.status, 'running');
  assert.equal(output.match(/http:\/\/127\.0\.0\.1:\d+/g).length, 1, 'API must not restart');
  assert.equal((await request(`/items/${story.id}/codex/stop`, 'POST', {})).status, 'interrupted');
});
