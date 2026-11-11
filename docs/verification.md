# First-version verification

Verified on 2026-11-11:

- Production Angular build succeeds.
- 21 domain, store, component, local API client and auth tests pass using Angular's compiled Vitest runner. Two SQLite API integration tests also pass, including file persistence across a server restart.
- Both SQL migrations pass on ephemeral Postgres, including authenticated CRUD, cross-user isolation, foreign-key reassignment prevention, anonymous denial, whitespace rejection, status constraints and cascade deletion.
- Hosted migrations applied to Supabase project `ffhilwthdmuomsrjvjnw` (DevPilot, un-idea organization, Ireland).
- Supabase security advisor reports no schema/RLS warnings. Its final scan reports default Auth leaked-password protection is disabled; configure it in the dashboard where available. [Supabase remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Hosted RLS check with another identity returns zero visible projects, items and notes.
- Real browser smoke test: email/password login, create project, create idea, edit title/status, add note, drag into Testing, reload and verify persistence, archive, restore and change status from mobile list.
- Desktop dark theme and mobile light theme/editor/navigation visually inspected.
- Production dependency audit has no reported vulnerabilities. Angular CLI development dependency tree retains 16 moderate findings related to glob/minimatch; suggested npm resolution requires a major Angular CLI upgrade. No high/critical findings remain.

Review fixes: token refresh no longer destroys drafts, rejected list writes restore the old control value, initial list values match persisted status, pending note text/requests cannot be lost by save/archive, initial note reads cannot overwrite appended notes, and SQL rejects whitespace-only text.

Limits: confirmation/reset email delivery and redirect settings require the Supabase dashboard. They were not tested with a real inbox. Cloudflare Pages deployment is configured and documented but has not been performed. No browser automation package or fake production-data mode is shipped.

Development uses a local SQLite API and `.local/devpilot.sqlite` for the `dev` / `dev` account, projects, items and notes. No Supabase account was created for it. Browser checks verified sign-in, project/item creation and persistence across reload. Integration tests also verify database persistence across API restarts, authenticated CRUD, cascading deletion and cross-origin request guards. Local SQL migrations apply automatically. Existing browser-only dev data is preserved separately and is not automatically imported. Only production builds select Supabase; `npm run build` verifies that no local login or API client code is present in production JavaScript. Local development requires neither Supabase configuration nor email redirects. Production registration retains its eight-character password minimum.
