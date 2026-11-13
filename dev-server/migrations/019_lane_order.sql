alter table items add column lane_position integer not null default 0;
with ranked as (
  select id,row_number() over(order by created_at,rowid) as position from items
)
update items set lane_position=(select position from ranked where ranked.id=items.id);

create trigger items_lane_insert after insert on items
begin
  update items set lane_position=(select coalesce(max(lane_position),0)+1 from items) where id=new.id;
end;
create trigger items_lane_move after update of status on items
when new.status is not old.status
begin
  update items set lane_position=(select coalesce(max(lane_position),0)+1 from items) where id=new.id;
end;
