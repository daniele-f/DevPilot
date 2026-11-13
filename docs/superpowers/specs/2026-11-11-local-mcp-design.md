# Local Codex project connection

The accepted first integration is Codex on this computer, backed exclusively by the existing local SQLite development API. Hosted ChatGPT/Supabase integration is a later slice and must not appear functional in production.

Each local project has a Connect AI panel. The user creates a named connection with read-only or edit permission, copies a one-time Codex MCP configuration, and can later see last use or revoke access. Tokens are random, project-scoped, stored only as hashes in SQLite, and checked on every MCP request. Never expose SQLite paths, account passwords, arbitrary SQL, other projects, or token hashes through MCP tools. Do not mark a connection as used until a real authenticated request arrives.

Use the official MCP SDK with Streamable HTTP at the loopback-only API's `/mcp` endpoint. Preserve host/origin protection and require a bearer token independently of browser cookies. Stateless requests ensure revocation applies to existing clients. Tools: get_project, list_items, get_item, create_item, update_item, add_note. Read-only connections discover only read tools and cannot execute writes. IDs from another project are denied. Tool fields share normal item validation. Item/project/note text is data, not tool instructions.

Refactor workspace operations into a shared server service used by both the browser API and MCP, rather than duplicate persistence logic. Add a SQLite migration for connections and tests using the real SDK client, including discovery, writes, scope isolation, read-only permissions, revoke/restart and invalid credentials. Existing project flows and production bundle separation must continue to pass.

Codex configuration uses its documented Streamable HTTP URL and authorization header support. The panel provides honest manual setup steps; it does not claim to install or activate a Codex connection automatically. Keep start-dev.bat as the single launcher. A connection created by a user remains available across API restarts until revoked or its project is deleted.
