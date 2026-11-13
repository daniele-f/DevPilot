alter table items add column card_number integer
  check(card_number is null or card_number between 10000000 and 99999999);

with numbered as (
  select id,9999999 + row_number() over(order by created_at,id) as number from items
)
update items set card_number=(select number from numbered where numbered.id=items.id);
create unique index items_card_number on items(card_number);

create table card_number_counter (
  singleton integer primary key check(singleton=1),
  value integer not null check(value between 9999999 and 99999999)
);
insert into card_number_counter values(1,(select coalesce(max(card_number),9999999) from items));

create trigger items_assign_card_number after insert on items
when new.card_number is null
begin
  update card_number_counter set value=value+1 where singleton=1;
  update items set card_number=(select value from card_number_counter where singleton=1) where id=new.id;
end;
create trigger items_card_number_generated before insert on items
when new.card_number is not null
begin
  select raise(abort,'Card numbers are assigned automatically.');
end;
create trigger items_card_number_immutable before update of card_number on items
when old.card_number is not null and new.card_number is not old.card_number
begin
  select raise(abort,'Card numbers cannot be changed.');
end;
