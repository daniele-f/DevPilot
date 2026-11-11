# DevPilot first version

Build a usable private project tracker, starting with create project → add idea → board → edit → status change. Angular standalone components and signals, Supabase email/password authentication and Postgres, static deployment to Cloudflare Pages. Desktop uses a sidebar and five-column board; mobile uses compact navigation, horizontal board scrolling, and a full-screen details sheet. Both themes use the same restrained green accent.

Projects belong to one authenticated user. Items belong to a project and contain title, description, type (idea/feature/bug/task), priority (low/medium/high/urgent), status (ideas/todo/in_progress/testing/done), and archive timestamp. Notes belong to items. Project deletion cascades and requires confirmation. Archived items can be viewed and restored. Notes are plain text. No collaboration, integrations, AI, releases, or activity-history system.

Supabase RLS checks parent ownership for items and notes, including new foreign keys on update. Constraints enforce field limits and enumerated values. Frontend repositories isolate Supabase operations; a signal store owns loaded state and reports errors. Mutations become visible only after persistence succeeds. Request versions discard stale responses after project/account switches. No pretend demo data or local persistence fallback.

Alternatives considered: local-only storage cannot satisfy persistent authenticated data; a custom API duplicates Supabase for this scope. Use direct Supabase with RLS behind repository methods; future API/MCP integrations can reuse the schema and authorization model without shipping an integration now.

Implementation decisions are delegated by the user's request. Hosting remains Cloudflare Pages rather than Sites hosting. Hosted database setup depends on account provisioning. Missing configuration is shown honestly as setup guidance.
