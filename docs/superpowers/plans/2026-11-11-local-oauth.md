# Local OAuth Implementation Plan

**Goal:** Connect Codex to a local DevPilot project through browser authentication without editing TOML.
**Architecture:** MCP SDK auth router with a SQLite provider, local browser consent and existing project-scoped MCP tools.
**Tech Stack:** Node, SQLite, MCP SDK, Express, Angular.
**Spec:** ../specs/2026-11-11-local-oauth-design.md

## Constraints and review focus

Local only; preserve existing bearer tokens and production separation. Test callback validation, PKCE/client/resource binding, browser CSRF, refresh replay and revocation. Do not leave a background app running.

## Tasks

- [x] Write failing integration tests for discovery, registration, consent, token exchange and MCP use.
- [x] Add migration and OAuth provider/browser page; mount SDK router before browser API guards.
- [x] Verify security failures, token rotation, persistence and legacy MCP compatibility.
- [x] Replace primary connection UI with URL/authentication instructions; update tests and documentation.
- [x] Run local and frontend tests and production build, review the change and fix findings.

Validation: 25 Angular tests, 10 local integration tests, production build/separation check. Independent review found refresh replay and concurrent-tab issues; reproducing tests failed before each fix and pass afterward. Sign-in desktop and consent mobile layouts visually checked using read-only mock pages; temporary preview closed afterward. No Codex user configuration was changed and no real project grant was created during tests.
