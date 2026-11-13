# Note images implementation plan

Goal: attach the three sidebar suggestions to DP #10000000 as Codex notes.

Use the existing local workspace and preserve its uncommitted changes. Store validated PNG/JPEG/WebP bytes in SQLite with a cascading note reference. Add optional images to the local add-note API and MCP tool. Keep note bodies compatible by appending image references; render only the protected internal image-reference syntax, leaving all other content plain text. This does not add production uploads or a user upload composer.

- [x] Add failing backend coverage for persistence, authenticated retrieval, invalid image rejection, and deletion/access isolation.
- [x] Implement image storage, scoped retrieval, MCP input, and inline note rendering.
- [x] Run backend checks and production build; no frontend tests or browsers.
- [x] Post the three images, verify their stored bytes, and hand the card to the user for review.

