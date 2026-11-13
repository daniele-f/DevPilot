import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { prepareNoteImages } from "./note-images.mjs";

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(400, `Text is required and must be ${max} characters or fewer.`);
  return value.trim();
}
export function draft(value) {
  const title = text(value.title, 200);
  if (typeof value.description !== "string" || value.description.length > 20000)
    fail(400, "Description must be 20,000 characters or fewer.");
  if (
    !["idea", "feature", "bug", "task"].includes(value.type) ||
    !["low", "medium", "high", "urgent"].includes(value.priority) ||
    !["ideas", "todo", "in_progress", "testing", "done"].includes(value.status)
  )
    fail(400, "Choose a valid type, priority and status.");
  const next_actor = value.next_actor ?? null;
  const next_action = value.next_action ?? "";
  const criteria = value.acceptance_criteria ?? [];
  if (next_actor !== null && !["user", "codex"].includes(next_actor)) fail(400, "Choose Me, Codex or Unassigned for the next action.");
  if (typeof next_action !== "string" || next_action.length > 2000) fail(400, "Next action must be 2,000 characters or fewer.");
  if (!Array.isArray(criteria) || criteria.length > 50) fail(400, "Use up to 50 acceptance criteria.");
  const acceptance_criteria = criteria.map(entry => {
    if (!entry || typeof entry.completed !== "boolean") fail(400, "Each acceptance criterion needs text and a checked state.");
    return { text: text(entry.text, 500), completed: entry.completed };
  });
  return {
    title,
    description: value.description,
    type: value.type,
    priority: value.priority,
    status: value.status,
    next_actor,
    next_action: next_action.trim(),
    acceptance_criteria,
  };
}

/** Shared persistence operations for browser requests and project-scoped MCP tools. */
export class Workspace {
  changes = new EventEmitter();
  constructor(db) {
    this.db = db;
  }
  // Synchronous transaction: writer attribution cannot leak to another request
  // or survive a rejected write. Triggers default external writes to System.
  asActor(actor, run, actorId = null) {
    if (this.activityTransaction) return run();
    this.db.exec("BEGIN IMMEDIATE");
    this.activityTransaction = true;
    try {
      this.db.prepare("update activity_context set actor=?,actor_id=? where id=1").run(actor, actorId);
      const result = run();
      this.db.exec("update activity_context set actor='system',actor_id=null where id=1; COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.activityTransaction = false;
    }
  }
  activity(userId, itemId, viewer = "user") {
    this.item(itemId, userId);
    return this.db.prepare("select * from item_activity where item_id=? and kind<>'note_edited' and (field is null or field<>'next_action') and (kind<>'note_deleted' or (actor_id=? and actor=?)) order by created_at,sequence").all(itemId, userId, viewer)
      .map(row => ({ ...row, old_value: JSON.parse(row.old_value), new_value: JSON.parse(row.new_value) }));
  }
  deleteActivity(userId, itemId, id) {
    return this.asActor("user", () => {
      this.item(itemId, userId);
      const result = this.db.prepare("delete from item_activity where id=? and item_id=? and kind='note_deleted' and actor='user' and actor_id=?")
        .run(id, itemId, userId);
      if (!result.changes) fail(404, "Removed-note history not found.");
      return null;
    }, userId);
  }
  project(id, userId) {
    const value = this.db
      .prepare("select * from projects where id=? and owner_id=?")
      .get(id, userId);
    if (!value) fail(404, "Project not found.");
    return value;
  }
  item(id, userId) {
    const value = this.db
      .prepare(
        "select i.* from items i join projects p on p.id=i.project_id where i.id=? and p.owner_id=?",
      )
      .get(id, userId);
    if (!value) fail(404, "Item not found.");
    return { ...value, acceptance_criteria: JSON.parse(value.acceptance_criteria) };
  }
  projects(userId) {
    return this.db
      .prepare(
        "select * from projects where owner_id=? order by created_at,rowid",
      )
      .all(userId);
  }
  createProject(userId, name) {
    const id = randomUUID();
    this.db
      .prepare("insert into projects values (?,?,?,?)")
      .run(id, userId, text(name, 80), new Date().toISOString());
    return this.project(id, userId);
  }
  renameProject(userId, id, name) {
    this.project(id, userId);
    this.db
      .prepare("update projects set name=? where id=?")
      .run(text(name, 80), id);
    return this.project(id, userId);
  }
  deleteProject(userId, id) {
    this.project(id, userId);
    this.db.prepare("delete from projects where id=?").run(id);
    return null;
  }
  items(userId, projectId) {
    this.project(projectId, userId);
    return this.db
      .prepare(
        "select * from items where project_id=? order by lane_position,created_at,rowid",
      )
      .all(projectId)
      .map(value => ({ ...value, acceptance_criteria: JSON.parse(value.acceptance_criteria) }));
  }
  saveItem(userId, projectId, value, id) {
    return this.asActor("user", () => this.writeItem(userId, projectId, value, id), userId);
  }
  writeItem(userId, projectId, value, id) {
    this.project(projectId, userId);
    if (id && this.item(id, userId).project_id !== projectId)
      fail(404, "Item not found in project.");
    const v = draft(id ? { ...this.item(id, userId), ...value } : value);
    const now = new Date().toISOString();
    const itemId = id ?? randomUUID();
    if (id)
      this.db
        .prepare(
          "update items set title=?,description=?,type=?,priority=?,status=?,next_actor=?,next_action=?,acceptance_criteria=?,updated_at=? where id=?",
        )
        .run(v.title, v.description, v.type, v.priority, v.status, v.next_actor, v.next_action, JSON.stringify(v.acceptance_criteria), now, id);
    else
      this.db
        .prepare("insert into items (id,project_id,title,description,type,priority,status,archived_at,created_at,updated_at,next_actor,next_action,acceptance_criteria) values (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          itemId,
          projectId,
          v.title,
          v.description,
          v.type,
          v.priority,
          v.status,
          null,
          now,
          now,
          v.next_actor,
          v.next_action,
          JSON.stringify(v.acceptance_criteria),
        );
    const item = this.item(itemId, userId);
    return item;
  }
  archiveItem(userId, id, archived) {
    return this.asActor("user", () => this.writeArchive(userId, id, archived), userId);
  }
  writeArchive(userId, id, archived) {
    this.item(id, userId);
    if (typeof archived !== "boolean")
      fail(400, "Archive must be true or false.");
    const now = new Date().toISOString();
    this.db
      .prepare("update items set archived_at=?,updated_at=? where id=?")
      .run(archived ? now : null, now, id);
    const item = this.item(id, userId);
    return item;
  }
  notes(userId, itemId) {
    this.item(itemId, userId);
    return this.db
      .prepare("select * from notes where item_id=? order by created_at,rowid")
      .all(itemId);
  }
  addNote(userId, itemId, body, author = "user", images = []) {
    this.item(itemId, userId);
    const attachments = prepareNoteImages(images);
    const content = text(text(body, 10000) + attachments.map(image => `\n\n![${image.name}](/api/note-images/${image.id})`).join(''), 10000);
    const write = () => {
      const id = randomUUID();
      this.db
        .prepare("insert into notes (id,item_id,body,created_at,author) values (?,?,?,?,?)")
        .run(id, itemId, content, new Date().toISOString(), author);
      for (const image of attachments)
        this.db.prepare('insert into note_images (id,note_id,mime_type,data) values (?,?,?,?)').run(image.id, id, image.mime_type, image.data);
      return this.db.prepare("select * from notes where id=?").get(id);
    };
    return attachments.length ? this.asActor(author, write, userId) : write();
  }
  noteImage(userId, id) {
    const image = this.db.prepare('select a.*,n.item_id from note_images a join notes n on n.id=a.note_id where a.id=?').get(id);
    if (!image) fail(404, 'Image not found.');
    this.item(image.item_id, userId);
    return image;
  }
  editableNote(userId, id) {
    const note = this.db.prepare("select * from notes where id=?").get(id);
    if (!note) fail(404, "Note not found.");
    this.item(note.item_id, userId);
    if (note.author !== "user") fail(403, "You can only change your own notes.");
    return note;
  }
  editNote(userId, id, body) {
    return this.asActor("user", () => this.writeNote(userId, id, body), userId);
  }
  writeNote(userId, id, body) {
    this.editableNote(userId, id);
    this.db.prepare("update notes set body=? where id=?").run(text(body, 10000), id);
    return this.db.prepare("select * from notes where id=?").get(id);
  }
  deleteNote(userId, id) {
    return this.asActor("user", () => this.removeNote(userId, id), userId);
  }
  removeNote(userId, id) {
    this.editableNote(userId, id);
    this.db.prepare("delete from notes where id=?").run(id);
    return null;
  }
}
