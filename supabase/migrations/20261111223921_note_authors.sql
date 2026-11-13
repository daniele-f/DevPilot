-- Leave existing notes unattributed; all new app notes default to Me.
alter table public.notes add column author text check (author in ('user', 'codex'));
alter table public.notes alter column author set default 'user';
