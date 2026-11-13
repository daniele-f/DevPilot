-- Reuse card invalidation for other windows of the same user. Do not create
-- another activity entry when dismissing private removed-note history.
create trigger dismissed_activity_live after delete on item_activity
when old.kind='note_deleted'
begin
  insert into card_revisions(project_id,user_id,revision)
    select p.id,p.owner_id,1 from items i join projects p on p.id=i.project_id where i.id=old.item_id
    on conflict(project_id) do update set revision=revision+1;
end;
