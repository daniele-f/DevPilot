import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from './server.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('note images persist, require card access, reject invalid content and cascade on deletion', async () => {
  const server = await startLocalServer({ databasePath: ':memory:', port: 0 });
  let cookie = '';
  const api = async (path, method = 'GET', value) => {
    const response = await fetch(`${server.url}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-DevPilot-Local': '1', Cookie: cookie },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, value: await response.json() };
  };
  try {
    await api('/auth/login', 'POST', { username: 'dev', password: 'dev' });
    const project = (await api('/projects', 'POST', { name: 'Images' })).value;
    const item = (await api(`/projects/${project.id}/items`, 'POST', { title: 'Image card', description: '', type: 'feature', priority: 'medium', status: 'todo' })).value;
    const note = (await api(`/items/${item.id}/notes`, 'POST', { body: 'Compact rail', images: [{ name: 'Compact rail', mime_type: 'image/png', data_base64: png }] })).value;
    assert.match(note.body, /!\[Compact rail\]\(\/api\/note-images\/[a-f0-9-]+\)/);
    const imagePath = note.body.match(/\(([^)]*)\)/)[1];
    const image = await fetch(`${server.url}${imagePath}`, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
    assert.equal((await fetch(`${server.url}${imagePath}`)).status, 401);
    assert.equal((await api(`/items/${item.id}/notes`, 'POST', { body: 'Bad', images: [{ name: 'Bad', mime_type: 'image/png', data_base64: Buffer.from('<script>bad</script>').toString('base64') }] })).response.status, 400);
    assert.equal((await api(`/items/${item.id}/notes`)).value.length, 1);
    await api(`/notes/${note.id}`, 'DELETE');
    assert.equal((await fetch(`${server.url}${imagePath}`, { headers: { Cookie: cookie } })).status, 404);
  } finally { await server.close(); }
});
