drop trigger notes_live_insert;
drop trigger notes_live_update;
drop trigger notes_live_delete;
create table note_events (
  sequence integer primary key autoincrement,
  user_id text not null,
  project_id text not null,
  item_id text not null,
  note_id text not null,
  operation text not null,
  note_json text
);
create trigger notes_live_insert after insert on notes
begin
  insert into note_events(user_id,project_id,item_id,note_id,operation,note_json)
    select p.owner_id,p.id,new.item_id,new.id,'insert',json_object('id',new.id,'item_id',new.item_id,'body',new.body,'created_at',new.created_at,'author',new.author)
    from items i join projects p on p.id=i.project_id where i.id=new.item_id;
  delete from note_events where sequence <= (select max(sequence)-512 from note_events);
end;
create trigger notes_live_update after update on notes
begin
  insert into note_events(user_id,project_id,item_id,note_id,operation,note_json)
    select p.owner_id,p.id,new.item_id,new.id,'update',json_object('id',new.id,'item_id',new.item_id,'body',new.body,'created_at',new.created_at,'author',new.author)
    from items i join projects p on p.id=i.project_id where i.id=new.item_id;
  delete from note_events where sequence <= (select max(sequence)-512 from note_events);
end;
create trigger notes_live_delete after delete on notes
begin
  insert into note_events(user_id,project_id,item_id,note_id,operation,note_json)
    select p.owner_id,p.id,old.item_id,old.id,'delete',null
    from items i join projects p on p.id=i.project_id where i.id=old.item_id;
  delete from note_events where sequence <= (select max(sequence)-512 from note_events);
end;

