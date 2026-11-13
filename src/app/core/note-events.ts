import { Note } from "./models";

export interface NoteEvent {
  id: string;
  delivery?: number;
  operation: "insert" | "update" | "delete";
  note_id: string;
  item_id?: string;
  note?: Note;
}

/** Stable IDs make repeated deliveries and HTTP acknowledgements idempotent. */
export function applyNoteEvent(notes: Note[], event: NoteEvent, itemId: string): Note[] {
  if (event.item_id && event.item_id !== itemId) return notes;
  if (event.operation === "delete") return notes.filter(note => note.id !== event.note_id);
  if (!event.note || event.note.item_id !== itemId) return notes;
  const result = notes.filter(note => note.id !== event.note_id);
  result.push(event.note);
  return result.sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
