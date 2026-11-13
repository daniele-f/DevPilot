-- Keep consumed hashes until their original expiry to detect refresh-token theft.
CREATE TABLE oauth_consumed_refresh (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES ai_connections(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_consumed_refresh_expiry ON oauth_consumed_refresh(expires_at);
