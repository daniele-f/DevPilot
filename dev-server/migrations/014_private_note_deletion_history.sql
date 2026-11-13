alter table activity_context add column actor_id text;
alter table item_activity add column actor_id text;

-- Keep the deleting identity independent of the project's current owner.
-- Older events without a recorded identity stay private to nobody.
create trigger activity_writer_identity after insert on item_activity
when new.actor_id is null and (select actor_id from activity_context where id=1) is not null
begin
  update item_activity set actor_id=(select actor_id from activity_context where id=1)
  where sequence=new.sequence;
end;
