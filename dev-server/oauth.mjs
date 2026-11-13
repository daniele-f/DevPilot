import express from "express";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { consentPage } from "./oauth-page.mjs";
import { fail } from "./workspace.mjs";

const secret = () => randomBytes(32).toString("hex");
const digest = value => createHash("sha256").update(value).digest("hex");
const now = () => Date.now();
const loopbackCallback = value => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && !u.username && !u.password && !u.hash;
  } catch { return false; }
};

export class LocalOAuth {
  constructor(db, workspace, connections, baseUrl) {
    this.db = db;
    this.workspace = workspace;
    this.connections = connections;
    this.baseUrl = baseUrl;
    this.flows = new Map();
    this.codes = new Map();
    this.browsers = new Map();
    this.clientsStore = {
      getClient: id => {
        const row = db.prepare("select metadata from oauth_clients where id=?").get(id);
        return row ? JSON.parse(row.metadata) : undefined;
      },
      registerClient: client => {
        if (!client.redirect_uris.length || client.redirect_uris.length > 5 || !client.redirect_uris.every(loopbackCallback))
          throw new InvalidClientMetadataError("Local DevPilot supports only loopback HTTP callbacks.");
        if (client.token_endpoint_auth_method && client.token_endpoint_auth_method !== "none")
          throw new InvalidClientMetadataError("Register as a public client with PKCE (none).");
        const registered = { ...client, client_id: randomUUID(), client_id_issued_at: Math.floor(now() / 1000), token_endpoint_auth_method: "none" };
        delete registered.client_secret;
        delete registered.client_secret_expires_at;
        db.prepare("insert into oauth_clients values (?,?)").run(registered.client_id, JSON.stringify(registered));
        return registered;
      },
    };
  }
  resource(resource) {
    if (resource && resource.href !== `${this.baseUrl()}/mcp`)
      throw new InvalidRequestError("The resource must be this local DevPilot MCP server.");
    return `${this.baseUrl()}/mcp`;
  }
  prune() {
    for (const collection of [this.flows, this.codes])
      for (const [key, value] of collection) if (value.expires < now()) collection.delete(key);
    for (const [key, expires] of this.browsers) if (expires < now()) this.browsers.delete(key);
    this.db.prepare("delete from oauth_tokens where expires_at<?").run(now());
    this.db.prepare("delete from oauth_consumed_refresh where expires_at<?").run(now());
  }
  async authorize(client, params, res) {
    this.prune();
    this.resource(params.resource);
    if (params.scopes?.some(s => !["read", "edit"].includes(s))) throw new InvalidScopeError("Choose read or edit access.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError("A valid S256 PKCE challenge is required.");
    if (this.flows.size >= 100) throw new InvalidRequestError("Too many pending sign-ins. Try again later.");
    const id = secret();
    this.flows.set(id, { id, client, params, csrf: secret(), expires: now() + 10 * 60_000, attempts: 0 });
    res.redirect(302, `/oauth/consent?flow=${id}`);
  }
  code(client, code) {
    const record = this.codes.get(digest(code));
    if (!record || record.clientId !== client.client_id || record.expires < now())
      throw new InvalidGrantError("Authorization code is invalid or expired.");
    return record;
  }
  async challengeForAuthorizationCode(client, code) { return this.code(client, code).challenge; }
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const record = this.code(client, code);
    if (redirectUri !== record.redirectUri || this.resource(resource) !== record.resource)
      throw new InvalidGrantError("Authorization code binding does not match.");
    this.codes.delete(digest(code));
    return this.issue(client.client_id, record.connectionId, record.resource);
  }
  activeToken(token, kind) {
    return this.db.prepare(`select t.*,c.permission,c.project_id,c.id,p.owner_id from oauth_tokens t
      join ai_connections c on c.id=t.connection_id join projects p on p.id=c.project_id
      where t.token_hash=? and t.kind=? and t.expires_at>? and c.revoked_at is null`).get(digest(token), kind, now());
  }
  issue(clientId, connectionId, resource) {
    const grant = this.db.prepare("select permission from ai_connections where id=? and revoked_at is null").get(connectionId);
    if (!grant) throw new InvalidGrantError("Connection has been revoked.");
    const access = `dpo_${secret()}`, refresh = `dpr_${secret()}`;
    const insert = this.db.prepare("insert into oauth_tokens values (?,?,?,?,?,?)");
    insert.run(digest(access), "access", clientId, connectionId, resource, now() + 3600_000);
    insert.run(digest(refresh), "refresh", clientId, connectionId, resource, now() + 30 * 86400_000);
    return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope: grant.permission === "edit" ? "read edit" : "read" };
  }
  async exchangeRefreshToken(client, token, scopes, resource) {
    this.prune();
    const used = this.db.prepare("select * from oauth_consumed_refresh where token_hash=? and client_id=?").get(digest(token), client.client_id);
    if (used && this.resource(resource) === used.resource) {
      this.db.prepare("update ai_connections set revoked_at=coalesce(revoked_at,?) where id=?").run(new Date().toISOString(), used.connection_id);
      throw new InvalidGrantError("Refresh token reuse detected. Authenticate again.");
    }
    const record = this.activeToken(token, "refresh");
    if (!record || record.client_id !== client.client_id || this.resource(resource) !== record.resource)
      throw new InvalidGrantError("Refresh token is invalid, expired or revoked.");
    const permitted = record.permission === "edit" ? ["read", "edit"] : ["read"];
    if (scopes && (scopes.some(s => !permitted.includes(s)) || permitted.some(s => !scopes.includes(s))))
      throw new InvalidScopeError("Refresh cannot change project permissions. Authenticate again.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("insert into oauth_consumed_refresh values (?,?,?,?,?)").run(digest(token), client.client_id, record.connection_id, record.resource, record.expires_at);
      this.db.prepare("delete from oauth_tokens where token_hash=?").run(digest(token));
      const tokens = this.issue(client.client_id, record.connection_id, record.resource);
      this.db.exec("COMMIT");
      return tokens;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  authorizeAccess(header) {
    const match = header?.match(/^Bearer (dpo_[a-f0-9]{64})$/);
    const record = match && this.activeToken(match[1], "access");
    if (!record || record.resource !== `${this.baseUrl()}/mcp`) fail(401, "Connection is invalid, expired or revoked.");
    this.db.prepare("update ai_connections set last_used_at=? where id=?").run(new Date().toISOString(), record.connection_id);
    return { ...record, id: record.connection_id };
  }
  async verifyAccessToken(token) {
    const record = this.activeToken(token, "access");
    if (!record) throw new InvalidTokenError("Invalid access token.");
    return { token, clientId: record.client_id, scopes: record.permission === "edit" ? ["read", "edit"] : ["read"], expiresAt: Math.floor(record.expires_at / 1000), resource: new URL(record.resource) };
  }
  async revokeToken(client, { token }) {
    const record = this.activeToken(token, "access") || this.activeToken(token, "refresh");
    if (record?.client_id === client.client_id)
      this.connections.revoke(record.owner_id, record.project_id, record.connection_id);
  }
  router() {
    const app = express();
    app.disable("x-powered-by");
    app.use(mcpAuthRouter({ provider: this, issuerUrl: new URL(this.baseUrl()), resourceServerUrl: new URL(`${this.baseUrl()}/mcp`), scopesSupported: ["read", "edit"], resourceName: "DevPilot local workspace" }));
    app.use("/oauth/consent", express.urlencoded({ extended: false, limit: "8kb" }));
    app.all("/oauth/consent", (req, res) => {
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      // no-referrer makes native form POSTs send Origin: null, which our
      // loopback guard correctly rejects. Keep same-origin form origins while
      // withholding referrers from the client's cross-origin callback.
      res.setHeader("Referrer-Policy", "same-origin");
      try {
        this.prune();
        const flow = this.flows.get(req.method === "GET" ? req.query.flow : req.body?.flow);
        if (!flow) return res.status(400).send("This sign-in expired. Start authentication again in Codex.");
        const cookie = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith("devpilot_oauth="))?.slice(15);
        const page = (status = 200, error = "") => res.status(status).type("html").send(consentPage(flow, flow.userId ? this.workspace.projects(flow.userId) : [], error));
        if (req.method === "GET") {
          if (!flow.browser) {
            flow.browser = this.browsers.has(cookie) ? cookie : secret();
            this.browsers.set(flow.browser, now() + 600_000);
            res.cookie("devpilot_oauth", flow.browser, { httpOnly: true, sameSite: "lax", path: "/oauth", maxAge: 600_000 });
          } else if (cookie !== flow.browser) return res.status(403).send("Start authentication again in Codex.");
          return page();
        }
        if (req.method !== "POST") return res.status(405).send("Use GET or POST.");
        if (!flow.browser || cookie !== flow.browser || req.body.csrf !== flow.csrf) return res.status(403).send("Invalid sign-in request. Start again in Codex.");
        const redirect = (key, value) => {
          this.flows.delete(flow.id);
          const target = new URL(flow.params.redirectUri);
          target.searchParams.set(key, value);
          if (flow.params.state !== undefined) target.searchParams.set("state", flow.params.state);
          res.redirect(302, target.href);
        };
        if (req.body.action === "deny") return redirect("error", "access_denied");
        if (req.body.action === "signin" && !flow.userId) {
          if (++flow.attempts > 5) { this.flows.delete(flow.id); return res.status(429).send("Too many attempts. Start authentication again."); }
          const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
          const password = typeof req.body.password === "string" ? req.body.password : "";
          if (password.length > 2000) return page(400, "Password is too long.");
          const user = this.db.prepare("select * from users where username=?").get(username);
          const supplied = scryptSync(password, user?.salt ?? "invalid-user", 64);
          if (!user || !timingSafeEqual(supplied, Buffer.from(user.password_hash, "hex"))) return page(401, "Incorrect username or password.");
          flow.userId = user.id;
          flow.csrf = secret();
          return page();
        }
        if (req.body.action !== "allow" || !flow.userId) return page(400, "Sign in before authorizing access.");
        const permission = req.body.permission;
        if (!["read", "edit"].includes(permission) || (permission === "edit" && flow.params.scopes?.length && !flow.params.scopes.includes("edit"))) return page(400, "Choose an allowed permission.");
        const connection = this.connections.create(flow.userId, req.body.project_id, { name: (flow.client.client_name || "Codex").slice(0, 80), permission });
        const code = secret();
        this.codes.set(digest(code), { clientId: flow.client.client_id, connectionId: connection.id, redirectUri: flow.params.redirectUri,
          resource: this.resource(flow.params.resource), challenge: flow.params.codeChallenge, expires: now() + 60_000 });
        return redirect("code", code);
      } catch (error) { res.status(error.status || 400).send(error.status ? error.message : "Unable to authorize this connection. Start again in Codex."); }
    });
    app.use((_req, res) => res.status(404).json({ message: "Route not found." }));
    return app;
  }
}
