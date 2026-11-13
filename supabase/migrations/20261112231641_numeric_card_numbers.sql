-- UUIDs remain the stable relational keys; card_number is the public label.
alter table public.items add column card_number integer
  generated always as identity (start with 10000000 minvalue 10000000 maxvalue 99999999 no cycle)
  unique check(card_number between 10000000 and 99999999);

create function public.keep_card_number() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.card_number is distinct from old.card_number then
    raise exception 'Card numbers cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.keep_card_number() from public, anon, authenticated;
create trigger items_keep_card_number before update of card_number on public.items
for each row execute function public.keep_card_number();
