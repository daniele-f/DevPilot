# Shared workflow implementation plan

Story: c1360c12-b04e-4d7a-bb9b-8180bc2e62d2. User approved lanes, next actor, next action and acceptance checklist. Done requires Daniele's testing and approval.

Keep the persisted `testing` status key for compatibility; display it as Ready for Review everywhere. Add nullable `next_actor` (user/codex), `next_action` (up to 2,000 characters), and `acceptance_criteria` (up to 50 text/completed entries). Defaults preserve old items. Save checklist edits with the item; do not mutate loaded originals. A checked checklist alone never moves a story to Done.

- [x] Add failing validation and persistence tests; SQLite migration, service serialization/validation and MCP schemas. Preserve workflow fields when older clients omit them.
- [x] Add matching Postgres migration and run authenticated/RLS migration tests. Prepare only; do not deploy production as part of local iteration.
- [x] Relabel the lane, add item detail controls and compact board/list handoff summaries; verify draft isolation and saving.
- [x] Run frontend/local/database tests and production build, review and browser-check desktop/mobile.
- [x] Put the story in Ready for Review with next actor User, concrete testing instructions and unchecked user acceptance items.
- [ ] Daniele tests and explicitly approves the story before it is moved to Done.

Verification: 29 frontend tests, 12 local integration tests, Postgres migration/RLS checks and production build/separation pass. Independent review found no important issues. Browser QA caught checklist autosize/padding behavior, fixed with a stable content-width wrapper; mobile criterion client height and scroll height match. Mobile editor save and board/list summaries verified. Both real stories retain unchecked user acceptance criteria.
