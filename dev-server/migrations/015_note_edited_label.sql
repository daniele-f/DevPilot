alter table notes add column edited_at text;
drop trigger activity_note_edit;
drop trigger notes_live_update;

-- A body edit updates the note itself and sends one canonical live payload.
-- The timestamp-only update must not emit a second event or board refresh.
create trigger notes_live_update after update of body on notes
when old.body is not new.body
begin
  update notes set edited_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=new.id;
  insert into note_events(user_id,project_id,item_id,note_id,operation,note_json)
    select p.owner_id,p.id,n.item_id,n.id,'update',json_object(
      'id',n.id,'item_id',n.item_id,'body',n.body,'created_at',n.created_at,
      'author',n.author,'edited_at',n.edited_at)
    from notes n join items i on i.id=n.item_id join projects p on p.id=i.project_id
    where n.id=new.id;
  delete from note_events where sequence <= (select max(sequence)-512 from note_events);
end;
