# DevPilot

A small, private workspace for turning development ideas into shipped software.

## What works

- Email/password sign-up, sign-in, sign-out and password recovery through Supabase.
- Create, switch, rename and permanently delete your own projects.
- Ideas, features, bugs and tasks with title, description, priority and status.
- Five-column drag-and-drop board and searchable list view.
- Item details, plain-text notes, archive and restore.
- Responsive mobile navigation and dark/light themes.

Local development supports a project-scoped Codex MCP connection with browser OAuth authentication for reading and changing backlog items. Add the local server URL in Codex settings and authenticate; no manual configuration-file editing is needed. See [Connect Codex](docs/connect-codex.md). Hosted ChatGPT, GitHub, and AI generation are not implemented. Projects are private to one account; there is no team sharing.

Stories move through **Ideas → To Do → In Progress → Ready for Review → Done**. Each item can name the next actor (**Me**, **Codex**, or **Unassigned**), describe the next action and carry an acceptance checklist. Edit these in item details and save; board and list show compact handoff summaries. Checking criteria does not automatically complete a story. Codex must leave implemented work in Ready for Review until the user has tested and explicitly approved it. The persisted `testing` status key now means Ready for Review, preserving existing cards and client compatibility.

## Run locally

On Windows, double-click `start-dev.bat` to start the development server and open the browser. It installs dependencies automatically when they are missing. Only one instance is allowed. Keep this command window open while using DevPilot; press **Ctrl+C** there to stop it. A second launch displays an “already running” message and pauses rather than starting another instance or silently closing. The launcher works from any working directory, including paths containing spaces.

Use Node 24.15+ (Node 24 LTS recommended) and npm.

```sh
npm ci --legacy-peer-deps
```

Development is fully local. Run `npm start` or `start-dev.bat`, then sign in with username **dev** and password **dev**. No Supabase account, internet access, or `.env` is required. The launcher starts Angular on port 4200 and a loopback-only SQLite API on port 4202. Angular proxies `/api` requests to the local server.

Projects, items, notes, and the seeded dev account live in **`.local/devpilot.sqlite`**, outside browser storage. Local SQL migrations in `dev-server/migrations` run automatically at startup. The dev password is salted and hashed in SQLite. Sessions use an HttpOnly cookie, persist as token hashes in SQLite, and expire after eight hours. Backend reloads and local API restarts preserve valid logins; signing out revokes the session. Clearing browser storage does not delete the database. Registration and password recovery are production-only; production registration still requires at least eight password characters.

Stop the dev server before copying the database for a backup. `.local/` is ignored by Git. Browser-stored data from the earlier dev implementation remains untouched and is not automatically imported into SQLite.

```sh
npm start
```

Open [DevPilot locally](http://localhost:4200). Keep the launcher running; **Ctrl+C** stops both Angular and the local API. Frontend changes reload automatically. The local API stays running while Codex works, including when it edits backend files. Restart the launcher after the run finishes to apply backend changes; existing valid login sessions persist. The launcher checks API capabilities before starting Angular. All browsers using this server share the same local database file.

## Test on a phone through Tailscale

Connect Tailscale on the PC and phone using the same account. Double-click
`start-dev-tailscale.bat` (or run `npm start -- --tailscale`). This starts DevPilot
only when you launch it. It detects the PC's connected Tailscale IPv4 address and
prints **Phone and PC URL**, for example `http://100.66.101.70:4200`.
Open that URL in the phone browser and sign in with **dev / dev**. Both browsers
use the same `.local/devpilot.sqlite` database. You can also open that URL on the
PC; `localhost:4200` is for the normal launcher, not the Tailscale launcher.

Keep the PC awake, Tailscale connected on both devices, and the launcher window
open. Phone Wi-Fi and mobile data both work. Press **Ctrl+C** in the launcher to
stop both DevPilot processes. Use `start-dev.bat` for normal localhost-only use;
stop one mode before starting the other. To use another port, run
`npm start -- --tailscale --port 4300` and use the URL it prints.

Only Angular binds to the Tailscale address; the database API and MCP/OAuth stay
on loopback. The proxy preserves browser Origin and forwards API Host to the
loopback target. Only the exact configured phone origin is additionally accepted
for `/api/` routes, with existing session and request-header checks retained.
Access depends on the tailnet's device/access rules. No public tunnel, router
port forwarding, or Tailscale Serve configuration is needed.

If Windows Firewall prompts, allow Node.js for this connection. If the phone
cannot load the printed URL, confirm both devices are connected in Tailscale,
that incoming connections are enabled for the PC, and that Windows Firewall
allows inbound TCP on the chosen frontend port on the Tailscale interface. Do
not disable the firewall. The launcher reports an actionable error if Tailscale
is unavailable or disconnected.

## Production configuration

Only production builds connect to Supabase. `npm run build` selects the production environment; the development login and local data adapter are excluded from its output. There is no automatic fallback to local authentication in production.

Copy `.env.example` to `.env` for a production build and set:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the publishable key belongs in frontend configuration. Never use a service-role or secret key. `scripts/configure.mjs` creates the ignored `.generated/production/config.json` at production build time. Angular copies it into the production output as `config.json`; development does not load it. These two values are public client configuration; authorization is enforced by database policies.

Apply every SQL file in `supabase/migrations` in filename order to a fresh Supabase project using the SQL editor, or link the CLI to the intended project and run its migration push command. Check `supabase --help` for the installed CLI version before running commands against a hosted database. The hosted DevPilot project created for this repository already has both migrations applied.

In Supabase **Authentication → URL Configuration**, set the Site URL to your deployed origin and add your production/preview origins to allowed redirect URLs. Email/password authentication must be enabled. Hosted sign-up normally requires email confirmation. Configure custom SMTP before opening sign-up to general users; Supabase's built-in mail service is restricted. Password reset links return to the app and show the new-password form. Production without Supabase configuration displays setup instructions.

## Verify

```sh
npm test
npm run test:db
npm run test:local
npm run build
```

Unit tests exercise input validation, archive/search behavior, persisted item transitions, failed writes, and stale responses after project/account switches. Database tests run the actual migration against an ephemeral PGlite Postgres instance with simulated Supabase roles and `auth.uid()`, checking cross-user reads/writes, foreign-key reassignment, constraints, cascade deletion and anonymous denial. They do not replace a hosted Auth/browser smoke test.

Component regression tests also cover token-refresh draft retention, persisted status rendering, rejected status changes, pending note protection and validation feedback. The initial browser smoke test used a temporary account against the hosted DevPilot project; its account and data were removed afterward. Supabase dashboard redirect settings and email delivery still need configuring for your own sign-up and password-reset links; the database connector does not expose those settings.

## Deploy to Cloudflare Pages

Connect this repository in Cloudflare Pages. Use:

| Setting               | Value                                      |
| --------------------- | ------------------------------------------ |
| Framework             | Angular                                    |
| Build command         | `npm run build`                            |
| Output directory      | `dist/devpilot/browser`                    |
| Node version          | `24`                                       |
| Environment variables | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |

The repository `.npmrc` ensures consistent peer-dependency handling with the lockfile. Supabase configuration is generated during the build. The static client needs no Cloudflare Function or server secrets. Pages supplies SPA fallback when there is no top-level `404.html`. Security response headers are included in `public/_headers`. For localhost development, Angular's dev server does not apply the production headers. Supabase URL configuration must include the Pages URL for confirmation and password-reset redirects.

## Structure

```text
src/app/core/models.ts       Domain types, field constraints, filtering
src/app/core/repository.ts   Persistence interface and Supabase adapter
src/app/core/store.ts        Workspace state, mutation and request lifecycle
src/app/core/auth.ts         Supabase session and email auth
src/app/core/local.ts        Development-only SQLite API client
src/app/core/providers*.ts   Build-time development/production selection
dev-server/                 Loopback API, SQLite migrations and integration tests
src/app/ui/                  Auth, item panel and icons
src/app/app.ts + app.html    Project navigation, board/list and project forms
supabase/migrations/        Reproducible schema and row-level security
scripts/                    Build configuration and database checks
```

In production, the browser talks directly to Supabase behind the repository interface. All exposed tables have RLS. Item and note policies follow the parent project's owner, including update checks. Development uses the same interface with a local SQLite API. Future services can use the same production schema without bypassing ownership enforcement.

Board order follows creation time within each status; arbitrary manual ranking is outside this first version. Writes are confirmed by the selected persistence adapter before the UI updates. A failed save preserves the draft. There is no offline mode or simultaneous multi-user editing.

Cards display a unique eight-digit numeric `card_number`, starting at `10000000`. Migrations assign numbers to all existing cards, including archived cards. Future cards receive numbers automatically; numbers are immutable and are not reused after deletion. Internal UUIDs remain the relational/API keys so notes, links and existing integrations keep working. Apply `20261112231641_numeric_card_numbers.sql` for hosted storage; the local API applies `011_numeric_card_numbers.sql` on startup.

### Live board updates

The local API sends authenticated workspace events for shared project, card, note and connection metadata changes. SQLite triggers maintain project revisions plus a bounded log of the last 512 note events. A single server-side check every 500 ms while clients are connected detects committed changes, including administrative writes from a separate SQLite connection. Notifications are scoped to the authenticated account, not the writer. This queries the small revision/event tables, not every card or note, and does not make browsers poll. Changes made with triggers disabled or by replacing the database file are outside this mechanism; normal SQL inserts, updates and deletes are covered.

Production uses Supabase Postgres Changes for projects, cards and notes, protected by existing RLS. Project/card notifications prompt an ownership-checked refetch. Note insert/update/delete payloads use the same connection to update only the affected note in an open card. Delete payloads may contain only the note ID; no deleted note text is needed. Notifications do not filter by writer; future team access requires separate membership and authorization work.

Note events are applied by stable note ID so repeated delivery or a matching save acknowledgement cannot create duplicates. Events arriving during a fresh fetch are buffered and reapplied over its result. Older HTTP acknowledgements cannot overwrite a newer note event. Initial connection, reconnect, focus/visibility resume and disconnected fallback fetch the current notes; ordinary note events do not refetch the board or the note list. A retained-event gap requests a fresh snapshot. The local event log is bounded and is not a permanent chat history or replay guarantee; the notes table remains the source of truth.

Shared updates never write personal search, filters, sorting, view mode, selected project or open-card selection. External project creation does not switch the viewer to it. If the selected project is removed, its saved cards are cleared without selecting another project; an open card editor stays mounted so unfinished text can be copied. Project names also update in an open connection panel, and its saved connection list refreshes without resetting local form/view state.

Open details merge saved changes into untouched fields and refresh notes. Dirty fields, checklists, title edits and note drafts stay intact; conflicting card fields show a notice. If a card or an edited note is removed elsewhere, unfinished text stays available to copy and saving the removed record is blocked. A healthy subscription does not poll the board; disconnected clients retry with a 30-second fallback. Hidden tabs skip refreshes and catch up when visible or focused. Subscriptions close on project/account changes and component destruction.

For hosted deployment, apply all migrations including `20261112230032_chat_note_events.sql`. The final configuration publishes `public.items`, `public.projects` and `public.notes` through `supabase_realtime`, and removes the superseded note-to-card invalidation trigger. Confirm that Realtime is enabled and the publication includes all three tables before testing hosted updates. These repository changes do not apply migrations to your hosted database. Restart the local API to apply its migrations; existing browser and phone proxy routes support the event endpoints.
