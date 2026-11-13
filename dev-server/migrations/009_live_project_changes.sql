-- Project metadata belongs to shared state, just like cards and notes.
create trigger projects_live_insert after insert on projects
begin
  insert into card_revisions(project_id,user_id,revision) values(new.id,new.owner_id,1)
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger connections_live_insert after insert on ai_connections
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=new.project_id
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger connections_live_update after update on ai_connections
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=new.project_id
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger connections_live_delete after delete on ai_connections
begin
  insert into card_revisions(project_id,user_id,revision)
    select id,owner_id,1 from projects where id=old.project_id
    on conflict(project_id) do update set revision=revision+1;
end;
create trigger projects_live_update after update on projects
begin
  insert into card_revisions(project_id,user_id,revision) values(new.id,new.owner_id,1)
    on conflict(project_id) do update set user_id=new.owner_id,revision=revision+1;
end;
