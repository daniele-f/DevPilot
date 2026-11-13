import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from './server.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { Workspace } from './workspace.mjs';

for (const missingPayload of [false, true]) test(`position migration avoids ambiguous matches (missing payload: ${missingPayload})`, async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('pragma foreign_keys=on');
  try {
    const directory = new URL('./migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql') && f < '017_').sort())
      db.exec(await readFile(new URL(file, directory), 'utf8'));
    db.prepare('insert into users values (?,?,?,?)').run('alice', 'alice', 'salt', 'hash');
    const workspace = new Workspace(db);
    const project = workspace.createProject('alice', 'Migration');
    const item = workspace.saveItem('alice', project.id, { title: 'Position', description: '', type: 'idea', priority: 'medium', status: 'ideas' });
    const originalTime = '2026-01-01T12:00:00.000Z';
    const insert = db.prepare("insert into notes(id,item_id,body,created_at,author) values(?,?,?,?,'user')");
    insert.run('unique', item.id, 'Unique removed text', originalTime);
    insert.run('duplicate-a', item.id, 'Duplicate removed text', originalTime);
    insert.run('duplicate-b', item.id, 'Duplicate removed text', originalTime);
    for (const id of ['unique', 'duplicate-a', 'duplicate-b']) workspace.deleteNote('alice', id);
    // Retaining only one duplicate's payload must not turn it into a unique
    // match for both removal activities.
    if (missingPayload) db.prepare("delete from note_events where note_id='duplicate-a' and note_json is not null").run();
    db.exec(await readFile(new URL('017_removed_note_position.sql', directory), 'utf8'));
    const events = workspace.activity('alice', item.id).filter(event => event.kind === 'note_deleted');
    const unique = events.find(event => event.old_value === 'Unique removed text');
    assert.equal(unique.note_id, missingPayload ? null : 'unique');
    assert.equal(unique.note_created_at, missingPayload ? null : originalTime);
    for (const event of events.filter(event => event.old_value === 'Duplicate removed text')) {
      assert.equal(event.note_id, null);
      assert.equal(event.note_created_at, null);
    }
  } finally { db.close(); }
});

test('history starts at rollout, rolls back atomically and restores writer attribution', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('pragma foreign_keys=on');
  try {
    const directory = new URL('./migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql') && f < '012').sort())
      db.exec(await readFile(new URL(file, directory), 'utf8'));
    db.prepare('insert into users values (?,?,?,?)').run('alice', 'alice', 'salt', 'hash');
    db.prepare('insert into users values (?,?,?,?)').run('bob', 'bob', 'salt', 'hash');
    const workspace = new Workspace(db);
    const project = workspace.createProject('alice', 'History');
    // Create legacy data before the new migration without using new writer context.
    db.prepare("insert into items(id,project_id,title,type,priority,status,created_at,updated_at) values(?,?,'Legacy','idea','medium','ideas','2026-01-01','2026-01-01')").run('legacy', project.id);
    db.exec(await readFile(new URL('012_story_activity.sql', directory), 'utf8'));
    for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql') && f >= '013_').sort())
      db.exec(await readFile(new URL(file, directory), 'utf8'));
    assert.deepEqual(workspace.activity('alice', 'legacy'), []);
    assert.throws(() => workspace.activity('bob', 'legacy'), /Item not found/);
    assert.throws(() => workspace.asActor('codex', () => {
      workspace.saveItem('alice', project.id, { status: 'in_progress' }, 'legacy');
      throw new Error('Abort');
    }), /Abort/);
    assert.deepEqual(workspace.activity('alice', 'legacy'), []);
    assert.equal(workspace.item('legacy', 'alice').status, 'ideas');
    workspace.asActor('codex', () => workspace.saveItem('alice', project.id, { status: 'in_progress' }, 'legacy'));
    assert.equal(workspace.activity('alice', 'legacy')[0].actor, 'codex');
    workspace.saveItem('alice', project.id, { title: 'User edit' }, 'legacy');
    assert.equal(workspace.activity('alice', 'legacy').at(-1).actor, 'user');
    db.prepare("update items set priority='urgent' where id='legacy'").run();
    assert.equal(workspace.activity('alice', 'legacy').at(-1).actor, 'system');
    assert.equal(db.prepare('select actor from activity_context').get().actor, 'system');
    const note = workspace.addNote('alice', 'legacy', 'Unchanged');
    const count = workspace.activity('alice', 'legacy').length;
    workspace.editNote('alice', note.id, 'Unchanged');
    assert.equal(workspace.activity('alice', 'legacy').length, count);
    workspace.deleteNote('alice', note.id);
    assert.equal(workspace.activity('alice', 'legacy').at(-1).kind, 'note_deleted');
    assert.equal(workspace.activity('alice', 'legacy').at(-1).actor_id, 'alice');
    assert.ok(!workspace.activity('alice', 'legacy', 'codex').some(event => event.kind === 'note_deleted'), 'Codex must not see the user’s private deletion history');
    db.prepare('update projects set owner_id=? where id=?').run('bob', project.id);
    assert.ok(workspace.activity('bob', 'legacy').some(event => event.kind === 'changed'));
    assert.ok(!workspace.activity('bob', 'legacy').some(event => event.kind === 'note_deleted'), 'Another viewer with story access must not see the deletion event');
    const privateEvent = db.prepare("select id from item_activity where kind='note_deleted'").get();
    assert.throws(() => workspace.deleteActivity('bob', 'legacy', privateEvent.id), /not found/);
    workspace.deleteProject('bob', project.id);
    assert.equal(db.prepare('select count(*) as count from item_activity').get().count, 0);
  } finally { db.close(); }
});

test('story activity records durable changes, not no-op saves, and guards ownership', async () => {
  const server = await startLocalServer({ databasePath: ':memory:', port: 0 });
  let cookie = '';
  const api = async (path, method = 'GET', value) => {
    const response = await fetch(`${server.url}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-DevPilot-Local': '1', Cookie: cookie }, ...(value ? { body: JSON.stringify(value) } : {}) });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, value: await response.json() };
  };
  try {
    await api('/auth/login', 'POST', { username: 'dev', password: 'dev' });
    const project = (await api('/projects', 'POST', { name: 'History' })).value;
    const item = (await api(`/projects/${project.id}/items`, 'POST', { title: 'History story', description: '', type: 'idea', priority: 'medium', status: 'ideas' })).value;
    const history = () => api(`/items/${item.id}/activity`);
    const created = await history();
    assert.equal(created.status, 200);
    assert.equal(created.value[0].kind, 'created');
    const path = `/projects/${project.id}/items/${item.id}`;
    await api(path, 'PATCH', { status: 'in_progress', description: 'New description' });
    let events = (await history()).value;
    assert.equal(events.length, 3);
    const move = events.find(e => e.field === 'status');
    assert.equal(move.actor, 'user');
    assert.equal(move.old_value, 'ideas');
    assert.equal(move.new_value, 'in_progress');
    await api(path, 'PATCH', { status: 'in_progress' });
    await api(path, 'PATCH', { status: 'invalid' });
    assert.equal((await history()).value.length, 3);
    const note = (await api(`/items/${item.id}/notes`, 'POST', { body: 'Original note' })).value;
    assert.equal((await history()).value.length, 3, 'A new note represents its own creation');
    assert.equal(note.edited_at, null);
    const edited = (await api(`/notes/${note.id}`, 'PATCH', { body: 'Revised note' })).value;
    assert.ok(edited.edited_at, 'The edited note carries its own label timestamp');
    assert.equal((await history()).value.length, 3, 'Editing a note must not add history');
    const unchanged = (await api(`/notes/${note.id}`, 'PATCH', { body: 'Revised note' })).value;
    assert.equal(unchanged.edited_at, edited.edited_at, 'No-op edits preserve the timestamp');
    await api(`/notes/${note.id}`, 'DELETE');
    events = (await history()).value;
    assert.equal(events.length, 4);
    assert.ok(!events.some(event => event.kind === 'note_edited'));
    assert.equal(events.at(-1).kind, 'note_deleted');
    assert.equal(events.at(-1).old_value, 'Revised note');
    assert.equal(events.at(-1).note_id, note.id);
    assert.equal(events.at(-1).note_created_at, note.created_at, 'Removal preserves the original note position');
    const removedHistory = events.at(-1);
    const deleteHistory = id => api(`/items/${item.id}/activity/${id}`, 'DELETE');
    assert.equal((await deleteHistory(events[0].id)).status, 404, 'Ordinary history cannot be removed');
    assert.equal((await deleteHistory(removedHistory.id)).status, 200);
    assert.equal((await history()).value.length, events.length - 1, 'No replacement activity is created');
    assert.ok(!(await history()).value.some(event => event.id === removedHistory.id));
    assert.equal((await deleteHistory(removedHistory.id)).status, 404);
    assert.equal((await api(`/items/${item.id}/notes`)).value.length, 0);
    await api(`/items/${item.id}/archive`, 'PATCH', { archived: true });
    assert.equal((await history()).value.at(-1).field, 'archived_at');
    assert.equal((await api('/items/00000000-0000-4000-8000-000000000000/activity')).status, 404);
    await api('/auth/logout', 'POST');
    assert.equal((await history()).status, 401);
  } finally { await server.close(); }
});
