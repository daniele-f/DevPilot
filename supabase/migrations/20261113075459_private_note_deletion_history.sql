-- Deleted-note history belongs to the deleting user, not to every viewer of
-- the story. Preserve the normal ownership check as well as identity privacy.
alter policy activity_owner_read on public.item_activity
using (
  exists (
    select 1 from public.items i join public.projects p on p.id=i.project_id
    where i.id=item_activity.item_id and p.owner_id=(select auth.uid())
  )
  and (
    kind <> 'note_deleted'
    or (actor='user' and actor_id=(select auth.uid()))
  )
);
