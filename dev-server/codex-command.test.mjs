import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These checks exercise the host's lookup, independently of an agent run.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'devpilot-codex-command-'));
  t.after(async () => { assert.ok(directory.startsWith(join(tmpdir(), 'devpilot-codex-command-'))); await rm(directory, { recursive: true, force: true }); });
  return directory;
}
async function resolver() { return (await import('./codex-command.mjs')).resolveCodexCommand; }

test('Windows discovers the installed desktop executable when the normal PATH has no Codex', async t => {
  const root = await fixture(t);
  const executable = join(root, 'app', 'resources', 'codex.exe');
  await mkdir(join(root, 'app', 'resources'), { recursive: true });
  await writeFile(executable, 'fixture');
  const resolve = await resolver();
  assert.deepEqual(resolve({ platform: 'win32', env: { Path: '' }, desktopLocation: () => root }), [executable]);
});

test('an explicit executable wins and an invalid explicit override is never silently replaced', async t => {
  const root = await fixture(t);
  const executable = join(root, 'custom codex.exe');
  await writeFile(executable, 'fixture');
  const resolve = await resolver();
  assert.deepEqual(resolve({ platform: 'win32', env: { DEVPILOT_CODEX_BIN: executable }, desktopLocation: () => { throw new Error('Must not discover another account'); } }), [executable]);
  assert.throws(() => resolve({ platform: 'win32', env: { DEVPILOT_CODEX_BIN: join(root, 'missing.exe') }, desktopLocation: () => root }), /DEVPILOT_CODEX_BIN/);
});

test('official npm command shims run through Node without using a shell', async t => {
  const root = await fixture(t);
  const script = join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  await mkdir(join(root, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true });
  await writeFile(join(root, 'codex.cmd'), 'fixture npm shim');
  await writeFile(script, 'fixture entrypoint');
  const resolve = await resolver();
  assert.deepEqual(resolve({ platform: 'win32', env: { Path: root }, desktopLocation: () => '' }), [process.execPath, script]);
});

test('lookup ignores relative PATH entries and reports a missing installation clearly', async () => {
  const resolve = await resolver();
  assert.throws(() => resolve({ platform: 'win32', env: { Path: '.;relative-folder' }, desktopLocation: () => '' }), /Cannot find Codex/);
});
