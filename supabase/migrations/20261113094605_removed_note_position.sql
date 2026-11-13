alter table public.item_activity add column note_id uuid;
alter table public.item_activity add column note_created_at timestamptz;

create function private.record_removed_note_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  writer uuid := auth.uid();
  project_owner uuid;
begin
  select p.owner_id into project_owner from public.items i
  join public.projects p on p.id=i.project_id where i.id=old.item_id;
  if project_owner is null then return null; end if;
  if writer is not null and writer <> project_owner then
    raise exception 'Story activity requires project ownership';
  end if;
  insert into public.item_activity(item_id,actor,actor_id,kind,field,old_value,note_id,note_created_at)
  values(old.item_id,case when writer is not null then 'user' else 'system' end,writer,
    'note_deleted','note',to_jsonb(old.body),old.id,old.created_at);
  return null;
end;
$$;
revoke all on function private.record_removed_note_activity() from public, anon, authenticated;
drop trigger story_note_activity on public.notes;
create trigger story_note_activity after delete on public.notes
for each row execute function private.record_removed_note_activity();
