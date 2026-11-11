import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
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
await db.query(
  "insert into public.notes(item_id,body) values ($1,'A useful note')",
  [item.id],
);
await db.query(
  "update public.items set status='testing', archived_at=now() where id=$1",
  [item.id],
);
assert.equal(
  (await db.query("select status from public.items")).rows[0].status,
  "testing",
);
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
for (const table of ["projects", "items", "notes"])
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
await db.query("delete from public.projects where id=$1", [project.id]);
assert.equal((await db.query("select * from public.items")).rows.length, 0);
assert.equal((await db.query("select * from public.notes")).rows.length, 0);
await db.exec("reset role; set role anon;");
await assert.rejects(db.query("select * from public.projects"));
await db.close();
console.log(
  "Database checks passed: CRUD, constraints, RLS isolation, foreign-key reassignment, cascade, anonymous denial.",
);
