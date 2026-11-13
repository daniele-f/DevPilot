-- Durable, bounded invalidations also cover writes from another SQLite connection.
create table card_revisions (
  project_id text primary key,
  user_id text not null,
  revision integer not null default 1
);
create trigger items_live_insert after insert on items
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=new.project_id
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger items_live_update after update on items
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=new.project_id
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger items_live_delete after delete on items
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=old.project_id
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger notes_live_insert after insert on notes
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=(select project_id from items where id=new.item_id)
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger notes_live_update after update on notes
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=(select project_id from items where id=new.item_id)
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger notes_live_delete after delete on notes
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=(select project_id from items where id=old.item_id)
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger projects_live_delete before delete on projects
begin
  insert into card_revisions(project_id,user_id,revision) values(old.id,old.owner_id,1)
    on conflict(project_id) do update set revision=revision+1;
end;

