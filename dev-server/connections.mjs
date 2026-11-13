import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fail, text } from "./workspace.mjs";
const columns =
  "id,project_id,name,permission,created_at,last_used_at,revoked_at";
const digest = (token) => createHash("sha256").update(token).digest("hex");
export class Connections {
  constructor(db, workspace, mcpUrl) {
    this.db = db;
    this.workspace = workspace;
    this.mcpUrl = mcpUrl;
  }
  list(userId, projectId) {
    this.workspace.project(projectId, userId);
    return this.db
      .prepare(
        `select ${columns} from ai_connections where project_id=? order by created_at,rowid`,
      )
      .all(projectId);
  }
  create(userId, projectId, value) {
    this.workspace.project(projectId, userId);
    const name = text(value.name, 80);
    if (!["read", "edit"].includes(value.permission))
      fail(400, "Choose read-only or edit permission.");
    const id = randomUUID();
    const token = `dp_${randomBytes(32).toString("hex")}`;
    this.db
      .prepare("insert into ai_connections values (?,?,?,?,?,?,?,?)")
      .run(
        id,
        projectId,
        name,
        value.permission,
        digest(token),
        new Date().toISOString(),
        null,
        null,
      );
    const configuration = `[mcp_servers.devpilot_${id.replaceAll("-", "_")}]\nurl = ${JSON.stringify(this.mcpUrl())}\nhttp_headers = { Authorization = ${JSON.stringify("Bearer " + token)} }\ndefault_tools_approval_mode = "prompt"\n`;
    return {
      ...this.db
        .prepare(`select ${columns} from ai_connections where id=?`)
        .get(id),
      token,
      configuration,
    };
  }
  revoke(userId, projectId, id) {
    this.workspace.project(projectId, userId);
    const connection = this.db
      .prepare("select id from ai_connections where id=? and project_id=?")
      .get(id, projectId);
    if (!connection) fail(404, "Connection not found.");
    this.db
      .prepare(
        "update ai_connections set revoked_at=coalesce(revoked_at,?) where id=?",
      )
      .run(new Date().toISOString(), id);
    return null;
  }
  authorize(header) {
    const match = header?.match(/^Bearer (dp_[a-f0-9]{64})$/);
    if (!match) fail(401, "A valid project connection token is required.");
    const connection = this.db
      .prepare(
        "select c.*,p.owner_id from ai_connections c join projects p on p.id=c.project_id where c.token_hash=? and c.revoked_at is null",
      )
      .get(digest(match[1]));
    if (!connection) fail(401, "Connection is invalid or revoked.");
    this.db
      .prepare("update ai_connections set last_used_at=? where id=?")
      .run(new Date().toISOString(), connection.id);
    return connection;
  }
}
