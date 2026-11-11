create table users (
  id text primary key,
  username text not null unique,
  salt text not null,
  password_hash text not null
);
create table projects (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80),
  created_at text not null
);
create index projects_owner on projects(owner_id);
create table items (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 200),
  description text not null default '' check(length(description)<=20000),
  type text not null check(type in ('idea','feature','bug','task')),
  priority text not null check(priority in ('low','medium','high','urgent')),
  status text not null check(status in ('ideas','todo','in_progress','testing','done')),
  archived_at text,
  created_at text not null,
  updated_at text not null
);
create index items_project on items(project_id);
create table notes (
  id text primary key,
  item_id text not null references items(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 10000),
  created_at text not null
);
create index notes_item on notes(item_id);
