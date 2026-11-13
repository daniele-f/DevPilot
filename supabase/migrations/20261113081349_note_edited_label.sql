alter table public.notes add column edited_at timestamptz;

create function private.stamp_note_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.edited_at := null;
  elsif old.body is distinct from new.body then
    new.edited_at := clock_timestamp();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_note_edit() from public, anon, authenticated;
create trigger notes_stamp_edit before insert or update on public.notes
for each row execute function private.stamp_note_edit();

-- Only removal belongs in note history. Edits travel as note updates instead.
drop trigger story_note_activity on public.notes;
create trigger story_note_activity after delete on public.notes
for each row execute function private.record_story_activity();

-- Keep previously recorded edits out of the timeline too, while preserving
-- deleting-user privacy and normal project ownership for other activity.
alter policy activity_owner_read on public.item_activity
using (
  kind <> 'note_edited'
  and exists (
    select 1 from public.items i join public.projects p on p.id=i.project_id
    where i.id=item_activity.item_id and p.owner_id=(select auth.uid())
  )
  and (kind <> 'note_deleted' or (actor='user' and actor_id=(select auth.uid())))
);
