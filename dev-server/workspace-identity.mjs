import { createHash } from "node:crypto";
import { resolve } from "node:path";
export function workspaceIdentity(databasePath) {
  return createHash("sha256")
    .update(databasePath === ":memory:" ? databasePath : resolve(databasePath))
    .digest("hex");
}
