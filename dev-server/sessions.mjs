import { createHash, randomBytes } from "node:crypto";

export const LOCAL_SESSION_SECONDS = 8 * 60 * 60;
export const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;
const digest = (token) => createHash("sha256").update(token).digest("hex");
const valid = (token) => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

// Store only hashes so a database copy cannot be used as browser credentials.
export class LocalSessions {
  constructor(db) {
    this.db = db;
    this.db.prepare("delete from local_sessions where expires_at<=?").run(Date.now());
  }
  get(token) {
    if (!valid(token)) return null;
    const session = this.db.prepare("select user_id,expires_at from local_sessions where token_hash=?").get(digest(token));
    if (!session) return null;
    if (session.expires_at <= Date.now()) {
      this.delete(token);
      return null;
    }
    return { userId: session.user_id };
  }
  create(userId, previousToken, remember = false) {
    const token = randomBytes(32).toString("hex");
    const seconds = remember === true ? REMEMBERED_SESSION_SECONDS : LOCAL_SESSION_SECONDS;
    this.db.prepare("insert into local_sessions values (?,?,?)").run(digest(token), userId, Date.now() + seconds * 1000);
    this.delete(previousToken);
    return token;
  }
  delete(token) {
    if (valid(token)) this.db.prepare("delete from local_sessions where token_hash=?").run(digest(token));
  }
}
