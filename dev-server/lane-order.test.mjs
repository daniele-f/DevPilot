import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { Workspace } from './workspace.mjs';

test('lane arrivals append, persist across reads, and ordinary edits retain position', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of (await readdir(new URL('./migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort())
      db.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('insert into users values(?,?,?,?)').run('owner', 'dev', 'salt', 'hash');
    const ws = new Workspace(db);
    const p = ws.createProject('owner', 'Board');
    const draft = { title: 'Old', description: '', type: 'task', priority: 'medium', status: 'todo' };
    const old = ws.saveItem('owner', p.id, draft);
    const first = ws.saveItem('owner', p.id, { ...draft, title: 'First', status: 'testing' });
    const second = ws.saveItem('owner', p.id, { ...draft, title: 'Second', status: 'testing' });
    const lane = () => new Workspace(db).items('owner', p.id).filter(i => i.status === 'testing').map(i => i.id);
    ws.saveItem('owner', p.id, { status: 'testing' }, old.id);
    assert.deepEqual(lane(), [first.id, second.id, old.id]);
    ws.saveItem('owner', p.id, { title: 'Edited', status: 'testing' }, first.id);
    assert.deepEqual(lane(), [first.id, second.id, old.id]);
    // External writers, including Codex, must get the same persistence rule.
    db.prepare('update items set status=? where id=?').run('todo', first.id);
    db.prepare('update items set status=? where id=?').run('testing', first.id);
    assert.deepEqual(lane(), [second.id, old.id, first.id]);
  } finally { db.close(); }
});
