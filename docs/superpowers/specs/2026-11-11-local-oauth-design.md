# Local OAuth for DevPilot

The approved next slice replaces copied bearer-token configuration with Codex's MCP URL and Authenticate flow. Local accounts and data remain in SQLite; production and public plugin distribution are outside this slice.

## Approach

Use the existing MCP SDK OAuth server handlers, dynamic public-client registration and S256 PKCE. A local browser page asks for credentials, one project, and read/edit permission before issuing a grant. Manual configuration remains a legacy compatibility path, not the primary UI. A hosted plugin would require public hosting and distribution work and is deferred.

OAuth clients, hashed access/refresh tokens and project grants persist in SQLite. Authorization requests and single-use codes expire in memory. Refresh tokens rotate; revoking a project connection invalidates all of its tokens. Redirects are limited to loopback HTTP callbacks. Resource, client, redirect and PKCE bindings must be enforced. Consent requires a browser-bound nonce and explicit POST; no approval on GET.

The Connect AI panel supplies the server URL and setup instructions, lists existing project connections, and supports revocation. Authentication opens a separate local page; there is no implied connection before Codex contacts the server.
