-- Keep existing ownership/RLS policies; only publish item invalidations.
-- Plain Postgres test environments may not have Supabase's publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
     ) then
    alter publication supabase_realtime add table public.items;
  end if;
end;
$$;
