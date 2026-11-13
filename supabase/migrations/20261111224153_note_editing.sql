drop policy notes_owner on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (exists (select 1 from public.items i join public.projects p on p.id=i.project_id where i.id=item_id and p.owner_id=(select auth.uid())));
create policy notes_insert on public.notes for insert to authenticated
  with check (author='user' and exists (select 1 from public.items i join public.projects p on p.id=i.project_id where i.id=item_id and p.owner_id=(select auth.uid())));
create policy notes_edit on public.notes for update to authenticated
  using (author='user' and exists (select 1 from public.items i join public.projects p on p.id=i.project_id where i.id=item_id and p.owner_id=(select auth.uid())))
  with check (author='user' and exists (select 1 from public.items i join public.projects p on p.id=i.project_id where i.id=item_id and p.owner_id=(select auth.uid())));
create policy notes_remove on public.notes for delete to authenticated
  using (author='user' and exists (select 1 from public.items i join public.projects p on p.id=i.project_id where i.id=item_id and p.owner_id=(select auth.uid())));
grant update (body), delete on public.notes to authenticated;
