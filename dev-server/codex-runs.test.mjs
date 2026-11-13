import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from './server.mjs';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from './workspace.mjs';
import { CodexRuns } from './codex-runs.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const command = [process.execPath, fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url))];
test('run overview spans owned projects, isolates accounts and excludes archived or superseded attention', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of (await readdir(new URL('./migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort())
      db.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
    for (const id of ['owner', 'other']) db.prepare('insert into users values(?,?,?,?)').run(id, id, 'salt', 'hash');
    const workspace = new Workspace(db);
    const runs = new CodexRuns(db, workspace, command);
    const add = (owner, status, archived = false) => {
      const project = workspace.createProject(owner, 'Project');
      const item = workspace.saveItem(owner, project.id, { title: 'Story', description: '', type: 'task', priority: 'medium', status: 'in_progress' });
      if (archived) workspace.archiveItem(owner, item.id, true);
      db.prepare('insert into codex_runs(id,item_id,project_id,cwd,status,created_at,updated_at) values(?,?,?,?,?,?,?)')
        .run(item.id, item.id, project.id, cwd, status, 'now', 'now');
      return item;
    };
    const active = add('owner', 'running');
    const input = add('owner', 'needs_input');
    add('other', 'waiting');
    add('owner', 'waiting', true);
    const superseded = add('owner', 'needs_input');
    db.prepare('insert into codex_runs(id,item_id,project_id,cwd,status,created_at,updated_at) values(?,?,?,?,?,?,?)')
      .run('new-run', superseded.id, superseded.project_id, cwd, 'review', 'now', 'now');
    assert.deepEqual(new Set(runs.overview('owner').map(run => run.item.id)), new Set([active.id, input.id]));
    assert.equal(runs.overview('other').length, 1);
    assert.deepEqual(runs.overview('unknown'), []);
  } finally { db.close(); }
});
async function setup(t, databasePath = ':memory:') {
  let server = await startLocalServer({ port: 0, databasePath, codexCommand: command });
  t.after(() => server.close());
  let cookie = '';
  const request = async (path, method = 'GET', value) => {
    const res = await fetch(server.url + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-DevPilot-Local': '1', Cookie: cookie }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    if (res.headers.has('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await request('/auth/login', 'POST', { username: 'dev', password: 'dev' });
  const project = (await request('/projects', 'POST', { name: 'Run project' })).body;
  const item = async mode => (await request(`/projects/${project.id}/items`, 'POST', { title: 'Run story', description: `MODE:${mode}`, type: 'feature', priority: 'medium', status: 'todo', acceptance_criteria: [{ text: 'Acceptance example', completed: false }] })).body;
  const wait = async (id, predicate) => {
    for (let i = 0; i < 150; i++) {
      const run = (await request(`/items/${id}/codex`)).body;
      if (predicate(run)) return run;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Run state did not arrive');
  };
  const restart = async change => {
    await server.close();
    if (change) { const db = new DatabaseSync(databasePath); try { change(db); } finally { db.close(); } }
    server = await startLocalServer({ port: 0, databasePath, codexCommand: command });
  };
  return { request, project, item, wait, restart };
}

test('local run receives story context and notes, streams progress and hands work to user review', async t => {
  const { request, project, item, wait } = await setup(t);
  const story = await item('context');
  assert.equal((await request(`/items/${story.id}/codex`, 'POST')).status, 400);
  assert.equal((await request(`/projects/${project.id}/codex`, 'PUT', { cwd })).status, 200);
  await request(`/items/${story.id}/notes`, 'POST', { body: 'Important story note' });
  assert.equal((await request(`/items/${story.id}/codex`, 'POST')).status, 200);
  const run = await wait(story.id, r => r?.status === 'review');
  assert.equal(run.thread_id, 'fixture-thread');
  const saved = (await request(`/projects/${project.id}/items`)).body[0];
  assert.equal(saved.status, 'testing');
  assert.equal(saved.next_actor, 'user');
  const notes = (await request(`/items/${story.id}/notes`)).body;
  assert.ok(notes.some(n => n.author === 'codex' && /Reading the project/.test(n.body)));
  assert.ok(notes.some(n => /Implemented and checked/.test(n.body)));
});

test('Codex handoffs leave next action retired and context uses notes plus history', async t => {
  const { request, project, item, wait } = await setup(t);
  const story = await item('context');
  await request('/projects/' + project.id + '/codex', 'PUT', { cwd });
  assert.equal((await request('/projects/' + project.id + '/items/' + story.id, 'PATCH', { next_action: 'Retired secret action', priority: 'high' })).status, 200);
  await request('/items/' + story.id + '/notes', 'POST', { body: 'Important story note' });
  await request('/items/' + story.id + '/codex', 'POST');
  const run = await wait(story.id, r => ['review', 'failed'].includes(r?.status));
  assert.equal(run.status, 'review');
  const saved = (await request('/projects/' + project.id + '/items')).body[0];
  assert.equal(saved.next_action, '');
  const history = (await request('/items/' + story.id + '/activity')).body;
  assert.ok(history.every(event => event.field !== 'next_action'));
});

test('pending approvals and questions require an explicit validated reply on the story', async t => {
  const { request, project, item, wait } = await setup(t);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  for (const mode of ['approval', 'question']) {
    const story = await item(mode);
    await request(`/items/${story.id}/codex`, 'POST');
    const run = await wait(story.id, r => r?.pending?.length);
    const pending = run.pending[0];
    const overview = await request('/codex/runs');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.length, 1);
    assert.equal(overview.body[0].item.id, story.id);
    assert.equal(overview.body[0].status, 'waiting');
    assert.equal(overview.body[0].approval, mode === 'approval');
    assert.equal((await request(`/items/${story.id}/codex/reply`, 'POST', { request_id: pending.id, decision: 'acceptForSession' })).status, 400);
    const value = mode === 'approval' ? { decision: 'accept' } : { answers: { color: 'Blue' } };
    assert.equal((await request(`/items/${story.id}/codex/reply`, 'POST', { request_id: pending.id, ...value })).status, 200);
    await wait(story.id, r => r?.status === 'review');
    assert.deepEqual((await request('/codex/runs')).body, []);
    assert.equal((await request(`/items/${story.id}/codex/reply`, 'POST', { request_id: pending.id, ...value })).status, 409);
  }
});

test('folder validation, ownership and project locks prevent unintended execution', async t => {
  const { request, project, item, wait } = await setup(t);
  const otherProject = (await request('/projects', 'POST', { name: 'Other project' })).body;
  await request(`/projects/${otherProject.id}/codex`, 'PUT', { cwd });
  const otherStory = (await request(`/projects/${otherProject.id}/items`, 'POST', { title: 'Other story', description: '', type: 'feature', priority: 'medium', status: 'todo' })).body;
  assert.equal((await request(`/projects/${project.id}/codex`, 'PUT', { cwd: 'relative' })).status, 400);
  assert.equal((await request('/projects/not-owned/codex', 'PUT', { cwd })).status, 404);
  assert.equal((await request('/items/not-owned/codex', 'POST')).status, 404);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const first = await item('hang');
  const second = await item('hang');
  await request(`/items/${first.id}/codex`, 'POST');
  await wait(first.id, r => r?.status === 'running');
  assert.equal((await request(`/items/${otherStory.id}/codex`, 'POST')).status, 409);
  assert.equal((await request(`/items/${second.id}/codex`, 'POST')).status, 409);
  assert.equal((await request(`/projects/${project.id}/codex`, 'PUT', { cwd })).status, 409);
  await request(`/items/${first.id}/codex/stop`, 'POST');
  await wait(first.id, r => r?.status === 'interrupted');
  assert.ok((await request(`/items/${first.id}/notes`)).body.some(n => /acknowledged the stop/.test(n.body)));
  assert.equal((await request(`/items/${second.id}/codex`, 'POST')).status, 200);
});

test('a long valid answer is delivered once and preserved completely in story notes', async t => {
  const { request, project, item, wait } = await setup(t);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const story = await item('longquestion');
  await request(`/items/${story.id}/codex`, 'POST');
  const run = await wait(story.id, r => r?.pending?.length);
  const answer = 'x'.repeat(10000);
  const response = await request(`/items/${story.id}/codex/reply`, 'POST', { request_id: run.pending[0].id, answers: { color: answer } });
  assert.equal(response.status, 200);
  await wait(story.id, r => r?.status === 'review');
  const notes = (await request(`/items/${story.id}/notes`)).body.filter(n => n.author === 'user');
  assert.ok(notes.map(n => n.body).join('').includes(answer));
});

test('process failure and a completed question hand control to the user without marking Done', async t => {
  const { request, project, item, wait } = await setup(t);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const crash = await item('crash');
  await request(`/items/${crash.id}/codex`, 'POST');
  await wait(crash.id, r => r?.status === 'failed');
  const question = await item('needsinput');
  await request(`/items/${question.id}/codex`, 'POST');
  await wait(question.id, r => r?.status === 'needs_input');
  assert.equal((await request(`/items/${question.id}/codex`, 'POST', { message: 'Use blue. resume-check' })).status, 200);
  await wait(question.id, r => r?.status === 'review');
  const saved = (await request(`/projects/${project.id}/items`)).body;
  assert.ok(saved.every(i => i.status !== 'done'));
});

test('file proposals are previewable and explicit declines reach Codex without granting permission', async t => {
  const { request, project, item, wait } = await setup(t);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  for (const mode of ['file', 'decline']) {
    const story = await item(mode);
    await request(`/items/${story.id}/codex`, 'POST');
    const run = await wait(story.id, r => r?.pending?.length);
    if (mode === 'file') assert.equal(run.pending[0].item.changes[0].diff, '+example');
    const response = await request(`/items/${story.id}/codex/reply`, 'POST', { request_id: run.pending[0].id, decision: 'decline' });
    assert.equal(response.status, 200);
    await wait(story.id, r => r?.status === 'review');
  }
});

test('restart clears orphaned approvals, preserves the folder and resumes the saved thread', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'devpilot-codex-'));
  const { request, project, item, wait, restart } = await setup(t, join(directory, 'runs.sqlite'));
  t.after(async () => { assert.ok(directory.startsWith(join(tmpdir(), 'devpilot-codex-'))); await rm(directory, { recursive: true, force: true }); });
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const story = await item('needsinput');
  await request(`/items/${story.id}/codex`, 'POST');
  await wait(story.id, r => r?.status === 'needs_input');
  await restart(db => db.prepare("update codex_runs set status='waiting',pending='[{\"id\":123}]'").run());
  const state = (await request(`/items/${story.id}/codex`)).body;
  assert.equal(state.status, 'interrupted');
  assert.deepEqual(state.pending, []);
  assert.equal((await request(`/projects/${project.id}/codex`)).body.cwd, cwd.replace(/[\\/]$/, ''));
  assert.equal((await request(`/items/${story.id}/codex/reply`, 'POST', { request_id: 123, decision: 'accept' })).status, 409);
  assert.equal((await request(`/items/${story.id}/codex`, 'POST', { message: 'resume-check' })).status, 200);
  await wait(story.id, r => r?.status === 'review');
});

test('malformed App Server output becomes an actionable failure', async t => {
  const { request, project, item, wait } = await setup(t);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const story = await item('malformed');
  await request(`/items/${story.id}/codex`, 'POST');
  const run = await wait(story.id, r => r?.status === 'failed');
  assert.match(run.summary, /invalid response/);
  const saved = (await request(`/projects/${project.id}/items`)).body[0];
  assert.equal(saved.next_actor, 'user');
});

test('a start awaiting folder validation cannot launch after shutdown begins', async t => {
  const db = new DatabaseSync(':memory:');
  for (const name of (await readdir(new URL('./migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort())
    db.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
  db.prepare('insert into users values (?,?,?,?)').run('owner', 'owner', 'unused', 'unused');
  const workspace = new Workspace(db);
  const project = workspace.createProject('owner', 'Shutdown project');
  const story = workspace.saveItem('owner', project.id, { title: 'Shutdown story', description: '', status: 'todo', type: 'task', priority: 'medium' });
  const runs = new CodexRuns(db, workspace, command);
  t.after(async () => { await runs.close(); db.close(); });
  await runs.configure('owner', project.id, { cwd });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  // Hold only the filesystem boundary to reproduce the shutdown interleaving.
  runs.folder = async () => { await gate; return cwd; };
  const starting = runs.start('owner', story.id);
  await runs.close();
  release();
  await assert.rejects(starting, /shutting down/);
  assert.equal(runs.state('owner', story.id), null);
});

test('startup preserves Codex data when the original migration filename was already applied', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'devpilot-codex-migration-'));
  const { request, project, item, wait, restart } = await setup(t, join(directory, 'runs.sqlite'));
  t.after(async () => { assert.ok(directory.startsWith(join(tmpdir(), 'devpilot-codex-migration-'))); await rm(directory, { recursive: true, force: true }); });
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const story = await item('needsinput');
  await request(`/items/${story.id}/notes`, 'POST', { body: 'Keep this note during migration.' });
  await request(`/items/${story.id}/codex`, 'POST');
  const original = await wait(story.id, r => r?.status === 'needs_input');
  await restart(db => db.prepare("update schema_migrations set name='019_codex_runs.sql' where name='020_codex_runs.sql'").run());
  const recovered = (await request(`/items/${story.id}/codex`)).body;
  assert.equal(recovered.id, original.id);
  assert.equal(recovered.thread_id, original.thread_id);
  assert.equal((await request(`/projects/${project.id}/codex`)).body.cwd, original.cwd);
  assert.ok((await request(`/items/${story.id}/notes`)).body.some(n => n.body === 'Keep this note during migration.'));
  // The successful migration is recorded, so subsequent starts also succeed.
  await restart();
  assert.equal((await request(`/items/${story.id}/codex`)).body.id, original.id);
});

test('standalone agents do not inherit the parent desktop launch identity or tool pipe', async t => {
  const values = { CODEX_WINDOWS_REGISTERED_CORE: '1', CODEX_APP_TOOLS_PIPE_PATH: 'parent-only-pipe', CODEX_THREAD_ID: 'parent-thread', DEVPILOT_EXPECT_CODEX_HOME: process.env.CODEX_HOME || '' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { request, project, item, wait } = await setup(t);
  await request(`/projects/${project.id}/codex`, 'PUT', { cwd });
  const story = await item('environment');
  await request(`/items/${story.id}/codex`, 'POST');
  const run = await wait(story.id, r => r?.status === 'review' || r?.status === 'failed');
  assert.equal(run.status, 'review');
});
