create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create index projects_owner_id_idx on public.projects(owner_id);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  type text not null default 'idea' check (type in ('idea','feature','bug','task')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'ideas' check (status in ('ideas','todo','in_progress','testing','done')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_project_id_idx on public.items(project_id);
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index notes_item_id_idx on public.notes(item_id);
create function public.set_item_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger items_updated_at before update on public.items for each row execute function public.set_item_updated_at();
revoke all on function public.set_item_updated_at() from public, anon, authenticated;
alter table public.projects enable row level security;
alter table public.items enable row level security;
alter table public.notes enable row level security;
create policy projects_owner on public.projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy items_owner on public.items for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy notes_owner on public.notes for all to authenticated
  using (exists (select 1 from public.items i join public.projects p on p.id = i.project_id where i.id = item_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.items i join public.projects p on p.id = i.project_id where i.id = item_id and p.owner_id = (select auth.uid())));
revoke all on public.projects, public.items, public.notes from anon;
grant select, insert, update, delete on public.projects, public.items to authenticated;
grant select, insert on public.notes to authenticated;
