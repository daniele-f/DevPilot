alter table notes add column author text check (author in ('user', 'codex'));
