import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
create publication supabase_realtime;`);
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
assert.equal((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='items'")).rows.length, 1);
assert.equal((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='projects'")).rows.length, 1);
assert.equal((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notes'")).rows.length, 1);
await db.exec(await readFile("supabase/migrations/20261112224747_live_project_updates.sql", "utf8"));
// The publication setup is safe to reapply on an already-enabled project.
await db.exec(await readFile("supabase/migrations/20261112211017_live_board_updates.sql", "utf8"));
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
await db.exec(
  `insert into auth.users values ('${alice}'), ('${bob}'); set role authenticated; set request.jwt.claim.sub='${alice}';`,
);
const project = (
  await db.query(
    "insert into public.projects(name) values ('DevPilot') returning id",
  )
).rows[0];
const item = (
  await db.query(
    "insert into public.items(project_id,title) values ($1,'First idea') returning id",
    [project.id],
  )
).rows[0];
const firstNumber = (await db.query("select card_number from public.items where id=$1", [item.id])).rows[0].card_number;
const activityFor = async () => (await db.query("select * from public.item_activity where item_id=$1 order by created_at,sequence", [item.id])).rows;
assert.equal((await activityFor())[0].kind, 'created');
assert.equal((await activityFor())[0].actor, 'user');
assert.equal((await activityFor())[0].actor_id, alice);
const initialActivity = (await activityFor()).length;
await db.query("update public.items set title=title where id=$1", [item.id]);
assert.equal((await activityFor()).length, initialActivity, 'No-op saves have no history');
await db.exec('begin');
await db.query("update public.items set title='Rolled back' where id=$1", [item.id]);
await db.exec('rollback');
assert.equal((await activityFor()).length, initialActivity, 'Rolled-back writes have no history');
await assert.rejects(db.query("insert into public.item_activity(item_id,actor,kind) values ($1,'codex','created')", [item.id]));
await assert.rejects(db.query("update public.item_activity set actor='codex' where item_id=$1", [item.id]));
assert.equal((await db.query("delete from public.item_activity where item_id=$1 returning id", [item.id])).rows.length, 0, 'Regular activity cannot be deleted');
assert.match(String(firstNumber), /^\d{8}$/);
const numberedCard = (await db.query("insert into public.items(project_id,title) values ($1,'Next number') returning id,card_number", [project.id])).rows[0];
assert.equal(numberedCard.card_number, firstNumber + 1);
await assert.rejects(db.query("update public.items set card_number=20000000 where id=$1", [item.id]));
await assert.rejects(db.query("insert into public.items(project_id,title,card_number) values ($1,'Manual number',20000000)", [project.id]));
await db.query("delete from public.items where id=$1", [numberedCard.id]);
const cardTimestamp = async () => (await db.query("select updated_at::text as value from public.items where id=$1", [item.id])).rows[0].value;
let beforeNoteChange = await cardTimestamp();
await db.query(
  "insert into public.notes(item_id,body) values ($1,'A useful note')",
  [item.id],
);
assert.equal(await cardTimestamp(), beforeNoteChange, "Note insertion uses its own event instead of invalidating the card");
assert.equal((await db.query("select author from public.notes")).rows[0].author, "user");
beforeNoteChange = await cardTimestamp();
const beforeNoteEditActivity = (await activityFor()).length;
const ownNote = (await db.query("update public.notes set body='Edited note' returning id,body,edited_at,created_at")).rows[0];
assert.equal(await cardTimestamp(), beforeNoteChange, "Note editing uses its own event instead of invalidating the card");
assert.equal(ownNote.body, "Edited note");
assert.ok(ownNote.edited_at);
assert.equal((await activityFor()).length, beforeNoteEditActivity, 'Note editing does not create history');
await db.query('update public.notes set body=body where id=$1', [ownNote.id]);
assert.equal((await db.query('select edited_at from public.notes where id=$1', [ownNote.id])).rows[0].edited_at.getTime(), ownNote.edited_at.getTime());
await assert.rejects(db.query("update public.notes set author='codex' where id=$1", [ownNote.id]));
await db.exec("reset role");
await db.query("insert into public.notes(item_id,body,author) values ($1,'Codex note','codex'),($1,'Legacy note',null)", [item.id]);
await db.exec("set role authenticated");
assert.equal((await db.query("update public.notes set body='Tampered' where author='codex' or author is null returning id")).rows.length, 0);
assert.equal((await db.query("delete from public.notes where author='codex' or author is null returning id")).rows.length, 0);
await assert.rejects(db.query("insert into public.notes(item_id,body,author) values ($1,'Spoofed','codex')", [item.id]));
beforeNoteChange = await cardTimestamp();
assert.equal((await db.query("delete from public.notes where id=$1 returning id", [ownNote.id])).rows.length, 1);
assert.equal(await cardTimestamp(), beforeNoteChange, "Note deletion uses its own event instead of invalidating the card");
assert.equal((await activityFor()).at(-1).kind, 'note_deleted');
assert.equal((await activityFor()).at(-1).old_value, 'Edited note');
// Even another identity with project access must not see Alice's deletion.
const privateDeletion = (await activityFor()).at(-1);
assert.equal(privateDeletion.note_id, ownNote.id);
assert.ok(privateDeletion.note_created_at, 'Deleted-note history retains the original creation time');
assert.equal(privateDeletion.note_created_at.getTime(), ownNote.created_at.getTime());
await db.exec('reset role');
await db.query('update public.projects set owner_id=$1 where id=$2', [bob, project.id]);
await db.exec(`set role authenticated; set request.jwt.claim.sub='${bob}';`);
assert.ok((await activityFor()).some(event => event.kind === 'created'), 'Bob can read the story history after gaining access');
assert.ok(!(await activityFor()).some(event => event.id === privateDeletion.id), 'Deletion history is visible only to its deleting identity');
assert.equal((await db.query('delete from public.item_activity where id=$1 returning id', [privateDeletion.id])).rows.length, 0, 'Another viewer cannot remove private history');
await db.exec('reset role');
await db.query('update public.projects set owner_id=$1 where id=$2', [alice, project.id]);
await db.exec(`set role authenticated; set request.jwt.claim.sub='${alice}';`);
assert.ok((await activityFor()).some(event => event.id === privateDeletion.id));
const beforeDismiss = (await activityFor()).length;
assert.equal((await db.query('delete from public.item_activity where id=$1 returning id', [privateDeletion.id])).rows.length, 1);
assert.equal((await activityFor()).length, beforeDismiss - 1, 'Dismissing history creates no replacement activity');
await assert.rejects(db.query("insert into public.notes(item_id,body,author) values ($1,'Invalid author','robot')", [item.id]));
await db.query(
  "update public.items set status='testing', archived_at=now() where id=$1",
  [item.id],
);
assert.equal(
  (await db.query("select status from public.items")).rows[0].status,
  "testing",
);
const criteria = [{ text: "User tests the handoff", completed: false }];
await db.query("update public.items set next_actor='user',next_action='Try it',acceptance_criteria=$1::jsonb where id=$2", [JSON.stringify(criteria), item.id]);
const workflow = (await db.query("select next_actor,next_action,acceptance_criteria from public.items where id=$1", [item.id])).rows[0];
assert.equal(workflow.next_actor, "user");
assert.deepEqual(workflow.acceptance_criteria, criteria);
const workflowHistory = await activityFor();
assert.deepEqual(workflowHistory.find(e => e.field === 'acceptance_criteria').new_value, criteria);
assert.equal(workflowHistory.find(e => e.field === 'status').old_value, 'ideas');
assert.equal(workflowHistory.find(e => e.field === 'status').new_value, 'testing');
await assert.rejects(db.query("update public.items set next_actor='robot' where id=$1", [item.id]));
for (const invalid of [{}, [{ text: " ", completed: false }], [{ text: "Works", completed: "yes" }], [{ text: "Missing checked state" }]])
  await assert.rejects(db.query("update public.items set acceptance_criteria=$1::jsonb where id=$2", [JSON.stringify(invalid), item.id]));
await assert.rejects(
  db.query("insert into public.items(project_id,title) values ($1,'   ')", [
    project.id,
  ]),
);
await assert.rejects(
  db.query("insert into public.projects(name) values (E'\\t\\n')"),
);
await assert.rejects(
  db.query("insert into public.items(project_id,title) values ($1,E'\\t\\n')", [
    project.id,
  ]),
);
await assert.rejects(
  db.query("insert into public.notes(item_id,body) values ($1,E'\\t\\n')", [
    item.id,
  ]),
);
await assert.rejects(
  db.query("update public.items set status='invalid' where id=$1", [item.id]),
);
await db.exec(`set request.jwt.claim.sub='${bob}';`);
for (const table of ["projects", "items", "notes", "item_activity"])
  assert.equal(
    (await db.query(`select * from public.${table}`)).rows.length,
    0,
    `${table} must be private`,
  );
await assert.rejects(
  db.query(
    "insert into public.items(project_id,title) values ($1,'Intrusion')",
    [project.id],
  ),
);
await assert.rejects(
  db.query("insert into public.notes(item_id,body) values ($1,'Intrusion')", [
    item.id,
  ]),
);
const other = (
  await db.query(
    "insert into public.projects(name) values ('Other') returning id",
  )
).rows[0];
await db.exec(`set request.jwt.claim.sub='${alice}';`);
await assert.rejects(
  db.query("update public.items set project_id=$1 where id=$2", [
    other.id,
    item.id,
  ]),
);
await assert.rejects(
  db.query("update public.projects set owner_id=$1 where id=$2", [
    bob,
    project.id,
  ]),
);
await db.query("update public.items set status='todo' where id=$1", [item.id]);
const arrival = (await db.query("insert into public.items(project_id,title,status) values ($1,'Lane resident','testing') returning id,lane_position", [project.id])).rows[0];
await db.query("update public.items set status='testing' where id=$1", [item.id]);
const position = async () => Number((await db.query('select lane_position from public.items where id=$1', [item.id])).rows[0].lane_position);
const movedPosition = await position();
assert.ok(movedPosition > Number(arrival.lane_position), 'Older card appends to destination');
await db.query("update public.items set title=title,status=status where id=$1", [item.id]);
assert.equal(await position(), movedPosition, 'Ordinary saves retain position');
await db.query('delete from public.items where id=$1', [arrival.id]);
await db.query("delete from public.projects where id=$1", [project.id]);
assert.equal((await db.query("select * from public.items")).rows.length, 0);
assert.equal((await db.query("select * from public.notes")).rows.length, 0);
await db.exec("reset role; set role anon;");
await assert.rejects(db.query("select * from public.projects"));
await db.close();
console.log(
  "Database checks passed: CRUD, constraints, RLS isolation, foreign-key reassignment, cascade, anonymous denial.",
);
