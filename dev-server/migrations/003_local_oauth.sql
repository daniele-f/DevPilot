CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  metadata TEXT NOT NULL
);
CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES ai_connections(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_tokens_connection ON oauth_tokens(connection_id);
CREATE INDEX oauth_tokens_expiry ON oauth_tokens(expires_at);
