# Local story Codex runs implementation plan

**Goal:** Start a real local Codex run from a saved story and return progress, questions, approvals and results to that story.

**Architecture:** The local API owns one stdio App Server process per active project. SQLite stores the project folder and run/thread metadata. A local-only Angular client exposes project setup, run state, replies and stop; existing story notes carry durable progress.

**Scope:** DP #10000009 and the user's approval to run locally using Codex App Server, skipping design questions. Reuse Codex's ChatGPT sign-in; no API keys are provisioned or consumed by DevPilot. Keep the current checkout because it contains the working project changes this feature extends.

## Constraints and review focus

- No browser or frontend test execution. Run backend tests and production build.
- Preserve existing uncommitted changes. Do not commit unrelated work.
- Authorize every route against story/project ownership; never accept executable commands from HTTP.
- Sandbox writes to the configured project folder; ask users about command and file approvals.
- Prevent simultaneous runs against the same project/folder. Handle process death, stop, and API restart explicitly.
- Completed work goes to Ready for Review with next actor user; questions and failures remain actionable and never mark Done.

## Tasks

- [x] Add backend integration tests using an actual JSONL child-process fixture. Cover story context, resume, questions/approvals, duplicate starts, folder validation, ownership, process failure and restart.
- [x] Add a stdio RPC transport, persistent run coordinator and migration. Connect authenticated API routes for folder configuration, start/status/reply/stop.
- [x] Add an optional local-only client and story run panel. Require saving story edits first; show state and actionable requests, support follow-up after a completed question, and clean up polling on close.
- [x] Document setup and user verification. Run the full backend suite, build and static checks; review the diff and move the card to testing with a concise Codex note.

## Execution record

Baseline backend suite: 22 tests passed with loopback access enabled. New integration tests: 9 passed. Installed App Server initialize/account-read check succeeded with ChatGPT account type; no model turn was started during verification. Code review found and fixed late mutation responses crossing story navigation, long reply notes exceeding the per-note limit, and a shutdown/start race. Polling ignores stale pre-mutation responses; stop requests interrupt the turn before bounded process termination. Final read-only review found no blockers. Migration is 020 to follow concurrent lane-order work in the checkout.

Ruling: verification uses a real stdio test peer for agent turns and only a metadata handshake with the installed CLI. Running a live model against the working checkout would introduce uncontrolled edits while implementing the integration; the user will exercise a real story for acceptance.

Startup follow-up: the development watcher had applied the original 019 Codex migration before its rename. Made the renamed 020 migration idempotent for the existing tables/index and corrected the misleading launcher error. The new migration-history regression reproduced the failure before the fix; all 33 backend tests passed afterward. Existing-workspace API startup and unchanged Codex settings/history were verified on a temporary backend port.

Placement correction: project-level local Codex setup now lives under Connect AI, using CodexConnectionSetup. Removed the folder editor from story controls; unconfigured stories direct the user to Connect AI. Story controls read the saved project setting and keep only run actions, state and replies. Production build and TypeScript checking passed; no frontend tests or browsers were used.

Executable discovery follow-up: a normal Windows launcher lacks the desktop app's injected PATH, so the bare Codex command failed despite the app being installed. Added per-launch resolution of explicit overrides, PATH executables/official npm shims and the current user's registered Codex desktop package. The installed app initialized and reported ChatGPT sign-in after replacing the verification process PATH with Machine+User PATH. No agent turn was started in that check.

Run lifecycle follow-up: the latest real story run started successfully, then an API restart interrupted it. Removed automatic backend watching from the launcher: the API owns active stdio sessions and must remain stable while agents edit backend files. The new lifecycle test reproduced a dropped connection under watch mode and now preserves an active run across a source edit. Backend changes require an explicit launcher restart after work; frontend reload remains unchanged.

A live isolated read-only turn exposed inherited desktop launch metadata causing the shell error “registered Core launch requires an installed app.” New App Server processes now drop only the parent's private Core, session and tool-pipe identity, preserving user configuration, credentials and sandbox settings. Regression failed before the fix and passed afterward. A fresh live run through the production transport successfully executed Get-Location and returned a review summary without editing files. Final review found no blockers; no frontend tests or browser checks were run.
