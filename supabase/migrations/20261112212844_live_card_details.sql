-- Notes invalidate their parent card, reusing the existing project-filtered
-- items subscription. This includes raw SQL writes and note DELETEs, which
-- cannot be reliably filtered in a Postgres Changes subscription.
create function public.notify_card_note_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP <> 'INSERT' then
    update public.items set updated_at = now() where id = old.item_id;
  end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.item_id <> old.item_id) then
    update public.items set updated_at = now() where id = new.item_id;
  end if;
  return null;
end;
$$;
revoke all on function public.notify_card_note_change() from public, anon, authenticated;
create trigger notes_live_card after insert or update or delete on public.notes
for each row execute function public.notify_card_note_change();
