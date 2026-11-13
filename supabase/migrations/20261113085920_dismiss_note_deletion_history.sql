grant delete on public.item_activity to authenticated;
create policy activity_owner_dismiss on public.item_activity for delete to authenticated
using (
  kind='note_deleted' and actor='user' and actor_id=(select auth.uid())
  and exists (
    select 1 from public.items i join public.projects p on p.id=i.project_id
    where i.id=item_activity.item_id and p.owner_id=(select auth.uid())
  )
);

-- Invalidate open cards through their existing subscription, without a new
-- activity row or broadcasting the contents of a private deletion event.
create function private.notify_activity_dismissed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.kind='note_deleted' then
    update public.items set updated_at=clock_timestamp() where id=old.item_id;
  end if;
  return null;
end;
$$;
revoke all on function private.notify_activity_dismissed() from public, anon, authenticated;
create trigger dismissed_activity_live after delete on public.item_activity
for each row execute function private.notify_activity_dismissed();
