-- Deliver notes directly on the existing Realtime connection.
drop trigger notes_live_card on public.notes;
drop function public.notify_card_note_change();
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end;
$$;
