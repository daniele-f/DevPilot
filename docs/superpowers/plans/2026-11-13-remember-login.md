# Remember Login Implementation Plan

> Execute inline using superpowers:executing-plans; preserve existing workspace changes.

**Goal:** Add opt-in remembered login to local and production sign-in.
**Architecture:** Local sessions use eight-hour session cookies or 30-day persistent cookies. Production uses a custom Supabase storage adapter that routes tokens to sessionStorage or localStorage and clears both on logout.
**Tech Stack:** Angular, Supabase JS, Node SQLite.
**Spec:** `docs/superpowers/specs/2026-11-13-remember-login-design.md`

## Constraints and review focus

- No browsers or frontend test suites; run backend tests, builds, and static checks.
- Preserve hashed tokens, rotation, and revocation. Only literal boolean true enables persistent local login.
- A refresh must preserve the selected storage; reloading must restore existing sessions, including legacy persistent tokens.
- New sign-in writes must remove stale tokens in the alternate store; logout removes both copies.
- Registration and recovery remain available without showing the checkbox.
- Work in the selected folder with existing uncommitted changes; do not commit unrelated work or update the card via MCP.

## Tasks

- [x] Add backend regression coverage for cookie attributes, expiry, rotation between modes, invalid credentials, restart restoration, and logout. Confirm new assertions fail before implementation.
- [x] Extend `LocalSessions.create(userId, previousToken, remember = false)` and `/api/auth/login` for 30-day opt-in persistence. Run backend regression coverage again.
- [x] Extend `AccountAuth.signIn(email, password, remember?)`, forward the choice in LocalAuth, and add the sign-in checkbox and scoped styles.
- [x] Add production auth storage routing and wire it into `productionProviders` and `Auth`. Add frontend unit coverage for user execution; do not run it.
- [x] Run the backend suite, production build, development build, and TypeScript static checks. Review the final changes and provide user testing steps.

## Execution record

Continuation follows the proposed design. Production token lifetime remains governed by Supabase settings; the option selects browser persistence, not a new server lifetime.

Backend regression confirmed red before implementation and green afterward; full backend suite passed (42 tests). TypeScript spec checking and both production/development builds passed. Frontend tests remain unexecuted by request.

Review found and resolved two production regressions: storage-disabled browsers now get independent memory fallbacks, and cross-tab auth events read this tab's actual credentials before updating the workspace. Added frontend regression coverage for these cases without running frontend suites. Follow-up review found no remaining important regression; TypeScript checking passed after fixes.

Post-review production and development builds passed. Production emits a bundle warning (655.60 kB against the 650 kB warning budget). Implementation and permitted checks are complete; user interaction and frontend acceptance testing remain with the user. No card was updated through MCP.
