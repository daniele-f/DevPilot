import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireDevInstance } from "../scripts/dev-instance.mjs";
const close = (server) => new Promise((resolve) => server.close(resolve));
test("only one launcher can hold the instance guard, and closing it allows another", async () => {
  const first = await acquireDevInstance({ port: 0 });
  const port = first.address().port;
  try {
    await assert.rejects(acquireDevInstance({ port }), /already running/);
  } finally {
    await close(first);
  }
  const second = await acquireDevInstance({ port });
  await close(second);
});
