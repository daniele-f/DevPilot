create function public.valid_acceptance_criteria(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare entry jsonb;
begin
  if jsonb_typeof(value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(value) > 50 then return false; end if;
  for entry in select jsonb_array_elements(value) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'text') is distinct from 'string'
      or char_length(entry->>'text') > 500
      or not ((entry->>'text') ~ '[^[:space:]]')
      or jsonb_typeof(entry->'completed') is distinct from 'boolean'
    then return false; end if;
  end loop;
  return true;
end;
$$;

alter table public.items
  add column next_actor text check (next_actor in ('user','codex')),
  add column next_action text not null default '' check (char_length(next_action)<=2000),
  add column acceptance_criteria jsonb not null default '[]'::jsonb
    check (public.valid_acceptance_criteria(acceptance_criteria));

comment on column public.items.status is 'ideas, todo, in_progress, testing (Ready for Review), done. Done requires user testing and explicit approval.';
