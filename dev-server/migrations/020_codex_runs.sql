-- Early local installs applied this schema as 019_codex_runs.sql.
-- Preserve their configuration and run history when recording the new filename.
create table if not exists codex_projects (
  project_id text primary key references projects(id) on delete cascade,
  cwd text not null
);
create table if not exists codex_runs (
  id text primary key,
  item_id text not null references items(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  cwd text not null,
  thread_id text,
  turn_id text,
  status text not null,
  summary text not null default '',
  pending text not null default '[]',
  created_at text not null,
  updated_at text not null
);
create index if not exists codex_runs_item on codex_runs(item_id, created_at);
