create table note_images (
  id text primary key,
  note_id text not null references notes(id) on delete cascade,
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  data blob not null check(length(data) between 1 and 5242880)
);
create index note_images_note on note_images(note_id);
