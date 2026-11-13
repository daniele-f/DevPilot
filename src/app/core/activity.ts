import { Activity, Note, STATUSES } from './models';

export type TimelineEntry =
  | { id: string; kind: 'note'; created_at: string; note: Note }
  | { id: string; kind: 'activity'; created_at: string; activity: Activity };

function position(entry: TimelineEntry): { time: number; rank: number; key: string } {
  if (entry.kind === 'note') return { time: Date.parse(entry.created_at), rank: 1, key: entry.note.id };
  const event = entry.activity;
  if (event.kind === 'note_deleted' && event.note_created_at) {
    return { time: Date.parse(event.note_created_at), rank: 1, key: event.note_id ?? event.id };
  }
  return { time: Date.parse(entry.created_at), rank: event.kind === 'created' ? 0 : 2, key: event.id };
}

export function storyTimeline(notes: Note[], activity: Activity[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...notes.map(note => ({ id: `note:${note.id}`, kind: 'note' as const, created_at: note.created_at, note })),
    ...activity.filter(event => event.kind !== 'note_edited' && event.field !== 'next_action').map(event => ({ id: `activity:${event.id}`, kind: 'activity' as const, created_at: event.created_at, activity: event })),
  ];
  return entries.sort((a, b) => {
    const left = position(a), right = position(b);
    return left.time - right.time || left.rank - right.rank ||
      (left.rank === 1 ? left.key.localeCompare(right.key) :
        a.kind === 'activity' && b.kind === 'activity' ? a.activity.sequence - b.activity.sequence : a.id.localeCompare(b.id));
  });
}

export function activityAuthor(event: Activity): string {
  return event.actor === 'user' ? 'Me' : event.actor === 'codex' ? 'Codex' : 'System';
}

export function activityAction(event: Activity): string {
  if (event.kind === 'created') return 'created this story';
  if (event.kind === 'note_edited') return 'edited a note';
  if (event.kind === 'note_deleted') return 'removed a note';
  if (event.field === 'archived_at') return `${event.new_value ? 'archived' : 'restored'} this story`;
  if (event.field === 'status') {
    const destination = STATUSES.find(status => status.id === event.new_value)?.label ?? String(event.new_value);
    return `moved this story to ${destination}`;
  }
  if (event.field === 'next_actor') {
    const destination = event.new_value === 'user' ? 'Me' : event.new_value === 'codex' ? 'Codex' : 'Unassigned';
    return `assigned this story to ${destination}`;
  }
  const field = event.field === 'acceptance_criteria' ? 'acceptance checklist' : (event.field ?? 'story').replaceAll('_', ' ');
  return `changed the ${field}`;
}
