-- Actor context is changed/restored in the same write transaction.
create table activity_context(id integer primary key check(id=1), actor text not null);
insert into activity_context values(1,'system');
create table item_activity (
  sequence integer primary key autoincrement,
  id text not null unique default (lower(hex(randomblob(16)))),
  item_id text not null references items(id) on delete cascade,
  actor text not null, kind text not null, field text,
  old_value text not null default 'null', new_value text not null default 'null',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index item_activity_item on item_activity(item_id,created_at,sequence);
create trigger activity_created after insert on items begin
  insert into item_activity(item_id,actor,kind) values(new.id,(select actor from activity_context where id=1),'created');
end;
create trigger activity_title after update of title on items when old.title is not new.title begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','title',json_quote(old.title),json_quote(new.title));
end;
create trigger activity_description after update of description on items when old.description is not new.description begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','description',json_quote(old.description),json_quote(new.description));
end;
create trigger activity_type after update of type on items when old.type is not new.type begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','type',json_quote(old.type),json_quote(new.type));
end;
create trigger activity_priority after update of priority on items when old.priority is not new.priority begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','priority',json_quote(old.priority),json_quote(new.priority));
end;
create trigger activity_status after update of status on items when old.status is not new.status begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','status',json_quote(old.status),json_quote(new.status));
end;
create trigger activity_next_actor after update of next_actor on items when old.next_actor is not new.next_actor begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','next_actor',json_quote(old.next_actor),json_quote(new.next_actor));
end;
create trigger activity_next_action after update of next_action on items when old.next_action is not new.next_action begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','next_action',json_quote(old.next_action),json_quote(new.next_action));
end;
create trigger activity_acceptance_criteria after update of acceptance_criteria on items when old.acceptance_criteria is not new.acceptance_criteria begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','acceptance_criteria',old.acceptance_criteria,new.acceptance_criteria);
end;
create trigger activity_archived_at after update of archived_at on items when old.archived_at is not new.archived_at begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.id,(select actor from activity_context where id=1),'changed','archived_at',json_quote(old.archived_at),json_quote(new.archived_at));
end;
create trigger activity_note_edit after update of body on notes when old.body is not new.body begin
  insert into item_activity(item_id,actor,kind,field,old_value,new_value)
  values(new.item_id,(select actor from activity_context where id=1),'note_edited','note',json_quote(old.body),json_quote(new.body));
end;
create trigger activity_note_delete after delete on notes when exists(select 1 from items where id=old.item_id) begin
  insert into item_activity(item_id,actor,kind,field,old_value)
  values(old.item_id,(select actor from activity_context where id=1),'note_deleted','note',json_quote(old.body));
end;
