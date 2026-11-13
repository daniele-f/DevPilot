alter table item_activity add column note_id text;
alter table item_activity add column note_created_at text;

drop trigger activity_note_delete;
create trigger activity_note_delete after delete on notes
when exists(select 1 from items where id=old.item_id)
begin
  insert into item_activity(item_id,actor,kind,field,old_value,note_id,note_created_at)
  values(old.item_id,(select actor from activity_context where id=1),'note_deleted','note',
    json_quote(old.body),old.id,old.created_at);
end;

-- Recover existing local positions only where retained live-event payloads
-- identify one deleted note unambiguously. Never guess from duplicate text.
with candidates as (
  select distinct a.sequence,n.note_id,json_extract(n.note_json,'$.created_at') as original_time
  from item_activity a join note_events n on n.item_id=a.item_id
  where a.kind='note_deleted' and n.note_json is not null
    -- Bounded logs cannot prove uniqueness after pruning, or when an older
    -- deleted note has no retained payload. Leave those positions unknown.
    and (select min(sequence) from note_events)=1
    and not exists(
      select 1 from note_events d where d.item_id=a.item_id and d.operation='delete'
      and not exists(select 1 from note_events payload where payload.note_id=d.note_id and payload.note_json is not null)
    )
    and not exists(
      select 1 from item_activity other where other.kind='note_deleted'
      and other.item_id=a.item_id and other.old_value=a.old_value and other.sequence<>a.sequence
    )
    and json_extract(n.note_json,'$.body')=json_extract(a.old_value,'$')
    and json_extract(n.note_json,'$.created_at')<=a.created_at
    and not exists(select 1 from notes live where live.id=n.note_id)
    and exists(select 1 from note_events d where d.note_id=n.note_id and d.operation='delete' and d.sequence>n.sequence)
), matches as (
  select sequence,min(note_id) as note_id,min(original_time) as original_time
  from candidates group by sequence having count(*)=1
)
update item_activity set
  note_id=(select note_id from matches where matches.sequence=item_activity.sequence),
  note_created_at=(select original_time from matches where matches.sequence=item_activity.sequence)
where sequence in (select sequence from matches);
