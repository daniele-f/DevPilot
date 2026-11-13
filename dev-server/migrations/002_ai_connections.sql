create table ai_connections (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80),
  permission text not null check(permission in ('read','edit')),
  token_hash text not null unique,
  created_at text not null,
  last_used_at text,
  revoked_at text
);
create index ai_connections_project on ai_connections(project_id);
