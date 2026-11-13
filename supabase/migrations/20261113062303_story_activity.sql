create table public.item_activity (
  sequence bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  actor text not null check (actor in ('user','codex','system')),
  actor_id uuid,
  kind text not null check (kind in ('created','changed','note_edited','note_deleted')),
  field text,
  old_value jsonb not null default 'null'::jsonb,
  new_value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index item_activity_item on public.item_activity(item_id,created_at,sequence);
alter table public.item_activity enable row level security;
revoke all on public.item_activity from anon, authenticated;
grant select on public.item_activity to authenticated;
create policy activity_owner_read on public.item_activity for select to authenticated
using (exists (
  select 1 from public.items i join public.projects p on p.id=i.project_id
  where i.id=item_activity.item_id and p.owner_id=(select auth.uid())
));

-- The trigger needs insert access while application roles have SELECT only.
-- Keep the definer function outside exposed schemas, with a fixed search path
-- and an explicit owner check for authenticated writers.
create schema if not exists private;
create function private.record_story_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  story_id uuid;
  owner uuid;
  writer uuid := auth.uid();
  writer_label text;
  previous jsonb;
  current_value jsonb;
  field_name text;
begin
  if tg_table_name = 'items' then
    story_id := new.id;
  elsif tg_op = 'DELETE' then
    story_id := old.item_id;
  else
    story_id := new.item_id;
  end if;
  select p.owner_id into owner from public.items i join public.projects p on p.id=i.project_id where i.id=story_id;
  -- Cascade deletion removes the story and its history as a unit.
  if owner is null then return null; end if;
  if writer is not null and writer <> owner then
    raise exception 'Story activity requires project ownership';
  end if;
  writer_label := case when writer is not null then 'user' else 'system' end;
  if tg_table_name = 'items' then
    if tg_op = 'INSERT' then
      insert into public.item_activity(item_id,actor,actor_id,kind) values(story_id,writer_label,writer,'created');
    else
      previous := to_jsonb(old);
      current_value := to_jsonb(new);
      foreach field_name in array array['title','description','type','priority','status','next_actor','next_action','acceptance_criteria','archived_at'] loop
        if previous->field_name is distinct from current_value->field_name then
          insert into public.item_activity(item_id,actor,actor_id,kind,field,old_value,new_value)
          values(story_id,writer_label,writer,'changed',field_name,previous->field_name,current_value->field_name);
        end if;
      end loop;
    end if;
  elsif tg_op = 'DELETE' then
    insert into public.item_activity(item_id,actor,actor_id,kind,field,old_value)
    values(story_id,writer_label,writer,'note_deleted','note',to_jsonb(old.body));
  elsif old.body is distinct from new.body then
    insert into public.item_activity(item_id,actor,actor_id,kind,field,old_value,new_value)
    values(story_id,writer_label,writer,'note_edited','note',to_jsonb(old.body),to_jsonb(new.body));
  end if;
  return null;
end;
$$;
revoke all on function private.record_story_activity() from public, anon, authenticated;
create trigger story_activity after insert or update on public.items
for each row execute function private.record_story_activity();
create trigger story_note_activity after update or delete on public.notes
for each row execute function private.record_story_activity();

-- Existing items/notes realtime events invalidate activity reads after commit.
-- No second stream or board invalidation is needed for note changes.
