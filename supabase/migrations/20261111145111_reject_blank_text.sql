alter table public.projects add constraint projects_name_nonblank check (name ~ '[^[:space:]]');
alter table public.items add constraint items_title_nonblank check (title ~ '[^[:space:]]');
alter table public.notes add constraint notes_body_nonblank check (body ~ '[^[:space:]]');
