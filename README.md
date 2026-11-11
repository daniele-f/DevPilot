# DevPilot

A small, private workspace for turning development ideas into shipped software.

## What works

- Email/password sign-up, sign-in, sign-out and password recovery through Supabase.
- Create, switch, rename and permanently delete your own projects.
- Ideas, features, bugs and tasks with title, description, priority and status.
- Five-column drag-and-drop board and searchable list view.
- Item details, plain-text notes, archive and restore.
- Responsive mobile navigation and dark/light themes.

There are no AI, GitHub, API or MCP integrations in this version. Projects are private to one account; there is no team sharing.

## Run locally

Use Node 24.15+ (Node 24 LTS recommended) and npm.

```sh
npm ci --legacy-peer-deps
```

Copy `.env.example` to `.env` and set:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the publishable key belongs in frontend configuration. Never use a service-role or secret key. `scripts/configure.mjs` creates the ignored `public/config.json` at build/start time. These two values are public client configuration; authorization is enforced by database policies.

Apply every SQL file in `supabase/migrations` in filename order to a fresh Supabase project using the SQL editor, or link the CLI to the intended project and run its migration push command. Check `supabase --help` for the installed CLI version before running commands against a hosted database. The hosted DevPilot project created for this repository already has both migrations applied.

In Supabase **Authentication → URL Configuration**, set the Site URL to your deployed origin and add `http://127.0.0.1:4200` plus your production/preview origins to allowed redirect URLs. Email/password authentication must be enabled. Hosted sign-up normally requires email confirmation. Configure custom SMTP before opening sign-up to general users; Supabase's built-in mail service is restricted. Password reset links return to the app and show the new-password form.

```sh
npm start
```

Open [DevPilot locally](http://127.0.0.1:4200). Without Supabase configuration, the app displays setup instructions and does not pretend to persist data.

## Verify

```sh
npm test
npm run test:db
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
src/app/ui/                  Auth, item panel and icons
src/app/app.ts + app.html    Project navigation, board/list and project forms
supabase/migrations/        Reproducible schema and row-level security
scripts/                    Build configuration and database checks
```

The browser talks directly to Supabase behind the repository interface. All exposed tables have RLS. Item and note policies follow the parent project's owner, including update checks. Future services can use the same schema without bypassing ownership enforcement.

Board order follows creation time within each status; arbitrary manual ranking is outside this first version. Writes are confirmed by Supabase before the UI updates. A failed save preserves the draft. There is no offline mode or simultaneous multi-user editing. Notes are append-only in the UI.
