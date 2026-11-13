import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startLocalServer } from "./server.mjs";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("parallel consent tabs share a browser binding without invalidating earlier forms", async () => {
  const server = await startLocalServer({ databasePath: ":memory:", port: 0 });
  try {
    const registered = await fetch(`${server.url}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:49152/callback"], token_endpoint_auth_method: "none" }) });
    const client = await registered.json();
    let cookie = "";
    const forms = [];
    for (let i = 0; i < 2; i++) {
      const auth = await fetch(`${server.url}/authorize?${new URLSearchParams({ client_id: client.client_id, response_type: "code", code_challenge_method: "S256", code_challenge: "a".repeat(43) })}`, { redirect: "manual" });
      const page = await fetch(new URL(auth.headers.get("location"), server.url), { headers: { Cookie: cookie } });
      // Native form POSTs under no-referrer send Origin: null and fail the local guard.
      assert.equal(page.headers.get("referrer-policy"), "same-origin");
      if (page.headers.has("set-cookie")) cookie = page.headers.get("set-cookie").split(";")[0];
      const html = await page.text();
      forms.push({ flow: html.match(/name="flow" value="([^"]+)"/)[1], csrf: html.match(/name="csrf" value="([^"]+)"/)[1], action: "signin", username: "dev", password: "dev" });
    }
    for (const form of forms) {
      const response = await fetch(`${server.url}/oauth/consent`, { method: "POST", headers: { Cookie: cookie, Origin: server.url, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Authorize project access/);
    }
  } finally { await server.close(); }
});

test("SDK OAuth discovery and edit tools work across an API restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devpilot-oauth-"));
  const databasePath = join(directory, "oauth.sqlite");
  let server = await startLocalServer({ databasePath, port: 0 });
  let client;
  try {
    const serverUrl = new URL(`${server.url}/mcp`);
    const login = await fetch(`${server.url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1" }, body: JSON.stringify({ username: "dev", password: "dev" }) });
    const project = await (await fetch(`${server.url}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: login.headers.get("set-cookie").split(";")[0] }, body: JSON.stringify({ name: "SDK OAuth project" }) })).json();
    let information, tokens, verifier, authorizationUrl;
    const provider = {
      redirectUrl: "http://127.0.0.1:49153/callback",
      clientMetadata: { client_name: "SDK Codex QA", redirect_uris: ["http://127.0.0.1:49153/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
      clientInformation: () => information, saveClientInformation: value => { information = value; },
      tokens: () => tokens, saveTokens: value => { tokens = value; },
      codeVerifier: () => verifier, saveCodeVerifier: value => { verifier = value; },
      redirectToAuthorization: value => { authorizationUrl = value; },
    };
    assert.equal(await auth(provider, { serverUrl, scope: "read edit" }), "REDIRECT");
    const start = await fetch(authorizationUrl, { redirect: "manual" });
    const page = await fetch(new URL(start.headers.get("location"), server.url));
    const cookie = page.headers.get("set-cookie").split(";")[0];
    const html = await page.text();
    const flow = html.match(/name="flow" value="([^"]+)"/)[1];
    let csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    const submit = fields => fetch(`${server.url}/oauth/consent`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ flow, csrf, ...fields }) });
    const signedIn = await submit({ action: "signin", username: "dev", password: "dev" });
    csrf = (await signedIn.text()).match(/name="csrf" value="([^"]+)"/)[1];
    const approved = await submit({ action: "allow", project_id: project.id, permission: "edit" });
    const authorizationCode = new URL(approved.headers.get("location")).searchParams.get("code");
    assert.equal(await auth(provider, { serverUrl, authorizationCode }), "AUTHORIZED");
    const connect = async () => {
      client = new Client({ name: "OAuth integration QA", version: "1.0" });
      await client.connect(new StreamableHTTPClientTransport(serverUrl, { authProvider: provider }));
    };
    await connect();
    const itemResult = await client.callTool({ name: "create_item", arguments: { title: "OAuth idea" } });
    assert.equal(itemResult.isError, undefined);
    const item = JSON.parse(itemResult.content[0].text);
    await client.close();
    const port = Number(serverUrl.port);
    await server.close();
    server = await startLocalServer({ databasePath, port });
    await connect();
    const result = await client.callTool({ name: "update_item", arguments: { id: item.id, status: "todo" } });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).status, "todo");
    // Force SDK refresh using the persisted registration and server-side refresh token.
    assert.equal(await auth(provider, { serverUrl }), "AUTHORIZED");
    assert.equal((await client.listTools()).tools.length, 6);
  } finally {
    await client?.close();
    await server.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + "\\") && directory.includes("devpilot-oauth-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("OAuth browser consent, PKCE, resource binding, refresh rotation and project revocation", async () => {
  const server = await startLocalServer({ databasePath: ":memory:", port: 0 });
  const url = server.url;
  let cookie = "";
  const api = async (path, method = "GET", value) => {
    const r = await fetch(`${url}/api${path}`, { method, headers: {
      "Content-Type": "application/json", "X-DevPilot-Local": "1", Cookie: cookie,
    }, ...(value ? { body: JSON.stringify(value) } : {}) });
    if (r.headers.has("set-cookie")) cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal(r.status, 200);
    return r.json();
  };
  const post = (path, value, headers = {}) => fetch(`${url}${path}`, {
    method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(value),
  });
  try {
    const unauth = await fetch(`${url}/mcp`);
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate"), /resource_metadata=/);
    const resource = await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(resource.resource, `${url}/mcp`);
    const metadata = await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    const register = async (redirect = "http://127.0.0.1:49152/callback") => fetch(metadata.registration_endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        client_name: "Codex QA", redirect_uris: [redirect], token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      }),
    });
    assert.equal((await register("https://evil.example/callback")).status, 400);
    const registered = await register();
    assert.equal(registered.status, 201);
    const client = await registered.json();
    await api("/auth/login", "POST", { username: "dev", password: "dev" });
    const project = await api("/projects", "POST", { name: "OAuth QA" });
    const verifier = "a".repeat(64);
    const params = { client_id: client.client_id, redirect_uri: client.redirect_uris[0],
      response_type: "code", code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      resource: `${url}/mcp`, state: "roundtrip-state" };
    const start = await fetch(`${metadata.authorization_endpoint}?${new URLSearchParams(params)}`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const consent = await fetch(new URL(start.headers.get("location"), url), { redirect: "manual" });
    assert.equal(consent.status, 200);
    const browserCookie = consent.headers.get("set-cookie").split(";")[0];
    const html = await consent.text();
    assert.ok(!html.includes(project.name), "Project names are hidden before sign-in");
    const flow = html.match(/name="flow" value="([^"]+)"/)[1];
    let csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    const fields = { flow, csrf, username: "dev", password: "dev", project_id: project.id, permission: "read", action: "signin" };
    assert.equal((await post("/oauth/consent", fields)).status, 403);
    assert.equal((await post("/oauth/consent", { ...fields, csrf: "wrong" }, { Cookie: browserCookie })).status, 403);
    assert.equal((await post("/oauth/consent", { ...fields, password: "wrong" }, { Cookie: browserCookie })).status, 401);
    const signedIn = await post("/oauth/consent", fields, { Cookie: browserCookie });
    assert.equal(signedIn.status, 200);
    const selection = await signedIn.text();
    assert.match(selection, /OAuth QA/);
    csrf = selection.match(/name="csrf" value="([^"]+)"/)[1];
    assert.equal((await post("/oauth/consent", { ...fields, csrf, action: "allow", project_id: "missing-project" }, { Cookie: browserCookie })).status, 404);
    const approved = await post("/oauth/consent", { ...fields, csrf, action: "allow" }, { Cookie: browserCookie });
    assert.equal(approved.status, 302);
    const callback = new URL(approved.headers.get("location"));
    assert.equal(callback.searchParams.get("state"), params.state);
    const exchange = { grant_type: "authorization_code", client_id: client.client_id,
      code: callback.searchParams.get("code"), code_verifier: verifier, redirect_uri: params.redirect_uri, resource: `${url}/mcp` };
    assert.equal((await post("/token", { ...exchange, code_verifier: "b".repeat(64) })).status, 400);
    assert.equal((await post("/token", { ...exchange, resource: `${url}/other` })).status, 400);
    assert.equal((await post("/token", { ...exchange, redirect_uri: "http://127.0.0.1:49152/other" })).status, 400);
    const otherClient = await (await register()).json();
    assert.equal((await post("/token", { ...exchange, client_id: otherClient.client_id })).status, 400);
    const issued = await post("/token", exchange);
    assert.equal(issued.status, 200);
    const tokens = await issued.json();
    assert.equal((await post("/token", exchange)).status, 400, "Code is single use");
    const mcp = async (token, method, params) => {
      const r = await fetch(`${url}/mcp`, { method: "POST", headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) });
      return { status: r.status, value: await r.json() };
    };
    const tools = await mcp(tokens.access_token, "tools/list");
    assert.equal(tools.status, 200);
    assert.deepEqual(tools.value.result.tools.map(t => t.name).sort(), ["get_item", "get_project", "list_items"]);
    const selected = await mcp(tokens.access_token, "tools/call", { name: "get_project", arguments: {} });
    assert.match(JSON.stringify(selected.value), new RegExp(project.id));
    assert.equal((await post("/revoke", { client_id: otherClient.client_id, token: tokens.access_token })).status, 200);
    assert.equal((await mcp(tokens.access_token, "tools/list")).status, 200, "Another client cannot revoke this grant");
    const refresh = { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token, resource: `${url}/mcp` };
    assert.equal((await post("/token", { ...refresh, scope: "edit" })).status, 400);
    const rotated = await post("/token", refresh);
    assert.equal(rotated.status, 200);
    const next = await rotated.json();
    assert.notEqual(next.refresh_token, tokens.refresh_token);
    assert.equal((await post("/token", refresh)).status, 400);
    assert.equal((await mcp(next.access_token, "tools/list")).status, 401, "Refresh replay revokes the surviving token family");
    const grants = await api(`/projects/${project.id}/connections`);
    assert.equal(grants.length, 1);
    await api(`/projects/${project.id}/connections/${grants[0].id}`, "DELETE");
    assert.equal((await mcp(next.access_token, "tools/list")).status, 401);
    assert.equal((await post("/token", { ...refresh, refresh_token: next.refresh_token })).status, 400);
  } finally { await server.close(); }
});
