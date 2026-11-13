import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { startLocalServer } from "./server.mjs";

test("remember login controls cookie persistence, server expiry, rotation and logout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-remember-"));
  const databasePath = join(directory, "sessions.sqlite");
  let server = await startLocalServer({ databasePath, port: 0 });
  const db = new DatabaseSync(databasePath);
  const call = (path, body, cookie = "") => fetch(`${server.url}/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = (remember, cookie) => call("login", { username: "dev", password: "dev", remember }, cookie);
  const cookieOf = response => response.headers.get("set-cookie").split(";")[0];
  const expiresAt = cookie => db.prepare("select expires_at from local_sessions where token_hash=?")
    .get(createHash("sha256").update(cookie.split("=")[1]).digest("hex"))?.expires_at;
  try {
    let started = Date.now();
    const ordinary = await login(false);
    assert.equal(ordinary.status, 200);
    assert.doesNotMatch(ordinary.headers.get("set-cookie"), /Max-Age|Expires=/i);
    const ordinaryCookie = cookieOf(ordinary);
    assert.ok(expiresAt(ordinaryCookie) >= started + 28800 * 1000);
    assert.ok(expiresAt(ordinaryCookie) <= Date.now() + 28800 * 1000);

    started = Date.now();
    const remembered = await login(true, ordinaryCookie);
    assert.equal(remembered.status, 200);
    assert.match(remembered.headers.get("set-cookie"), /Max-Age=2592000(?:;|$)/);
    assert.match(remembered.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Path=\/api/);
    const rememberedCookie = cookieOf(remembered);
    assert.equal(expiresAt(ordinaryCookie), undefined, "Previous session is revoked");
    assert.ok(expiresAt(rememberedCookie) >= started + 2592000 * 1000);
    assert.ok(expiresAt(rememberedCookie) <= Date.now() + 2592000 * 1000);

    await server.close();
    server = await startLocalServer({ databasePath, port: 0 });
    assert.equal((await (await call("session", undefined, rememberedCookie)).json()).id, "local-dev");

    const rejected = await call("login", { username: "dev", password: "wrong", remember: true }, rememberedCookie);
    assert.equal(rejected.status, 401);
    assert.equal(rejected.headers.get("set-cookie"), null);
    assert.equal(db.prepare("select count(*) as total from local_sessions").get().total, 1);

    const temporary = await login(false, rememberedCookie);
    assert.doesNotMatch(temporary.headers.get("set-cookie"), /Max-Age|Expires=/i);
    assert.equal(expiresAt(rememberedCookie), undefined, "Switching modes revokes persistent session");
    const temporaryCookie = cookieOf(temporary);
    assert.equal(await (await call("session", undefined, rememberedCookie)).json(), null);

    const logout = await call("logout", {}, temporaryCookie);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal(expiresAt(temporaryCookie), undefined);
    assert.equal(await (await call("session", undefined, temporaryCookie)).json(), null);

    const optedIn = cookieOf(await login(true));
    await call("logout", {}, optedIn);
    assert.equal(expiresAt(optedIn), undefined, "Logout revokes remembered sessions too");

    for (const choice of [undefined, "true", 1]) {
      const response = await login(choice);
      assert.doesNotMatch(response.headers.get("set-cookie"), /Max-Age|Expires=/i);
      await call("logout", {}, cookieOf(response));
    }

    const expiredCookie = cookieOf(await login(true));
    db.prepare("update local_sessions set expires_at=0").run();
    assert.equal(await (await call("session", undefined, expiredCookie)).json(), null);
    assert.equal(db.prepare("select count(*) as total from local_sessions").get().total, 0);
  } finally {
    db.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
