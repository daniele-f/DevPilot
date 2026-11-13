# Story History Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display durable activity events between notes on each story.

**Architecture:** SQLite/Postgres triggers append activity rows atomically. Repositories expose activity reads and the card merges activity with notes by timestamp, preserving note controls and drafts.

**Tech Stack:** Angular, SQLite, Postgres, Node backend tests, PGlite.

**Spec:** docs/superpowers/specs/2026-11-13-story-history-design.md

## Global Constraints

- Approved inline activity presentation, distinct from notes.
- No browser use or frontend test suite execution.
- Preserve unrelated workspace changes; no automatic commit of existing changes.
- Ready for Review handoff with next actor user, never Done without acceptance.

## Review Focus

- No-op saves must not generate events.
- Rejected writes and rolled-back writes must not leave activity.
- Other owners cannot read or forge history.
- Note edit/removal history must survive changes to the note.
- Live refresh must preserve unfinished edits and stable chronological ordering.

### Task 1: Durable local history

Files: dev-server/migrations/012_story_activity.sql, dev-server/workspace.mjs, dev-server/mcp.mjs, dev-server/server.mjs, dev-server/activity.test.mjs.

- [x] Add backend tests for creation, field diffs, no-ops, rollback, note changes, ownership and MCP attribution; verify failure.
- [x] Add activity triggers, transaction-scoped actor attribution and owner-checked GET /api/items/:id/activity.
- [x] Run backend history tests and existing backend suites.

### Task 2: Hosted persistence

Files: new Supabase migration, scripts/test-database.mjs.

- [x] Add database assertions for durable diffs, private reads and denied direct activity writes.
- [x] Add trigger-only history writes and select ownership policy. Reuse existing items/notes realtime notifications after commit; a second publication would duplicate invalidations.
- [x] Run database checks.

### Task 3: Timeline and handoff

Files: src/app/core/models.ts, repository.ts, local.ts, src/app/ui/item-panel.ts, icon.ts, src/styles.css.

- [x] Expose activity(itemId) in both repositories and refresh it through existing live paths.
- [x] Merge notes and activity chronologically; render activity in compact muted rows with expandable old/new details.
- [x] Build and review the diff; record results and user test steps on the card; move to testing/user.

Execution ruling: continue in the existing workspace because the feature builds on substantial uncommitted shared persistence/live-update work. The user's approval authorizes implementation; no repeated design approval needed.
