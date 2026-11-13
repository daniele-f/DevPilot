alter table public.items add column lane_position bigint not null default 0;
with ranked as (
  select id,row_number() over(order by created_at,id) as position from public.items
)
update public.items set lane_position=ranked.position from ranked where ranked.id=items.id;

create sequence public.item_lane_position_seq;
select setval('public.item_lane_position_seq',coalesce(max(lane_position),0)+1,false) from public.items;
grant usage on sequence public.item_lane_position_seq to authenticated;

create function public.assign_item_lane_position() returns trigger
language plpgsql set search_path=public as $$
begin
  if TG_OP='INSERT' then
    new.lane_position := nextval('public.item_lane_position_seq');
  elsif new.status is distinct from old.status then
    new.lane_position := nextval('public.item_lane_position_seq');
  else
    new.lane_position := old.lane_position;
  end if;
  return new;
end;
$$;
create trigger items_lane_position before insert or update on public.items
for each row execute function public.assign_item_lane_position();
