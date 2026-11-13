export const STATUSES = [
  { id: "ideas", label: "Ideas", color: "#b49af5" },
  { id: "todo", label: "To Do", color: "#a1a8b5" },
  { id: "in_progress", label: "In Progress", color: "#e8b96c" },
  { id: "testing", label: "Ready for Review", color: "#75b8f1" },
  { id: "done", label: "Done", color: "#a7ec81" },
] as const;
export const TYPES = ["idea", "feature", "bug", "task"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Status = (typeof STATUSES)[number]["id"];
export type ItemType = (typeof TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];
export interface Project {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}
export interface AcceptanceCriterion {
  text: string;
  completed: boolean;
}
export interface ItemDraft {
  title: string;
  description: string;
  type: ItemType;
  priority: Priority;
  status: Status;
  next_actor?: "user" | "codex" | null;
  next_action?: string;
  acceptance_criteria?: AcceptanceCriterion[];
}
export interface Item extends ItemDraft {
  id: string;
  card_number?: number;
  lane_position?: number;
  project_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Note {
  id: string;
  item_id: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
  author?: "user" | "codex" | null;
}
export interface Activity {
  id: string;
  sequence: number;
  item_id: string;
  actor: "user" | "codex" | "system";
  actor_id?: string | null;
  note_id?: string | null;
  note_created_at?: string | null;
  kind: "created" | "changed" | "note_edited" | "note_deleted";
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}
export function validateName(value: string, max: number): string {
  const name = value.trim();
  if (!name) throw new Error("A title or name is required.");
  if (name.length > max) throw new Error(`Use ${max} characters or fewer.`);
  return name;
}
export function validateItem(draft: ItemDraft): ItemDraft {
  const title = validateName(draft.title, 200);
  if (draft.description.length > 20000)
    throw new Error("Description must be 20,000 characters or fewer.");
  if (
    !TYPES.includes(draft.type) ||
    !PRIORITIES.includes(draft.priority) ||
    !STATUSES.some((s) => s.id === draft.status)
  )
    throw new Error("Choose a valid type, priority and status.");
  if (draft.next_actor != null && !["user", "codex"].includes(draft.next_actor))
    throw new Error("Choose Me, Codex or Unassigned for the next action.");
  if (typeof (draft.next_action ?? "") !== "string" || (draft.next_action?.length ?? 0) > 2000)
    throw new Error("Next action must be 2,000 characters or fewer.");
  const entries = draft.acceptance_criteria ?? [];
  if (!Array.isArray(entries) || entries.length > 50) throw new Error("Use up to 50 acceptance criteria.");
  const acceptance_criteria = entries.map(entry => {
    if (!entry || typeof entry.completed !== "boolean") throw new Error("Each acceptance criterion needs a checked state.");
    return { text: validateName(entry.text, 500), completed: entry.completed };
  });
  return { title, description: draft.description, type: draft.type, priority: draft.priority, status: draft.status,
    next_actor: draft.next_actor ?? null, next_action: (draft.next_action ?? "").trim(), acceptance_criteria };
}
export function visibleItems(
  items: Item[],
  archived: boolean,
  query: string,
): Item[] {
  const term = query.trim().toLowerCase();
  return items.filter(
    (i) =>
      Boolean(i.archived_at) === archived &&
      `${i.card_number ?? ""} ${i.title} ${i.description}`.toLowerCase().includes(term),
  ).sort((a, b) => (a.lane_position ?? 0) - (b.lane_position ?? 0));
}
