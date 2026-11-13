import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { Workspace } from "./workspace.mjs";

test("numeric card IDs backfill existing cards, preserve links and allocate immutable eight-digit numbers", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  try {
    for (const name of (await readdir(new URL("./migrations/", import.meta.url))).filter(name => name.endsWith(".sql") && name < "011_").sort())
      db.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8"));
    db.prepare("insert into users values(?,?,?,?)").run("owner", "dev", "salt", "hash");
    const workspace = new Workspace(db);
    const project = workspace.createProject("owner", "Project");
    const draft = { title: "Existing", description: "Keep details", type: "idea", priority: "medium", status: "ideas" };
    // Seed the pre-history schema using the persistence primitives: actor
    // transactions are available only after the activity migration.
    const first = workspace.writeItem("owner", project.id, draft);
    const archived = workspace.writeItem("owner", project.id, { ...draft, title: "Archived" });
    workspace.writeArchive("owner", archived.id, true);
    workspace.addNote("owner", first.id, "Keep my note", "codex");
    const before = db.prepare("select * from items order by id").all();
    const notes = db.prepare("select * from notes order by id").all();
    db.exec(await readFile(new URL("./migrations/011_numeric_card_numbers.sql", import.meta.url), "utf8"));
    const numbered = db.prepare("select * from items order by id").all();
    assert.deepEqual(numbered.map(({ card_number, ...row }) => row), before.map(row => ({ ...row })));
    assert.deepEqual(db.prepare("select * from notes order by id").all(), notes);
    assert.deepEqual(numbered.map(row => row.card_number).sort(), [10000000,10000001]);
    db.exec(await readFile(new URL("./migrations/012_story_activity.sql", import.meta.url), "utf8"));
    db.exec(await readFile(new URL("./migrations/014_private_note_deletion_history.sql", import.meta.url), "utf8"));
    const created = workspace.saveItem("owner", project.id, { ...draft, title: "New" });
    assert.equal(created.card_number, 10000002);
    const edited = workspace.saveItem("owner", project.id, { ...draft, title: "Edited", status: "testing" }, created.id);
    assert.equal(edited.card_number, created.card_number);
    assert.throws(() => db.prepare("update items set card_number=? where id=?").run(20000000, created.id));
    assert.throws(() => db.prepare("update items set card_number=null where id=?").run(created.id));
    db.prepare("delete from items where id=?").run(created.id);
    assert.equal(workspace.saveItem("owner", project.id, draft).card_number, 10000003);
    db.prepare("update card_number_counter set value=99999999").run();
    const count = db.prepare("select count(*) as value from items").get().value;
    assert.throws(() => workspace.saveItem("owner", project.id, draft));
    assert.equal(db.prepare("select count(*) as value from items").get().value, count);
  } finally { db.close(); }
});
