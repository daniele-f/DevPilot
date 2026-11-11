export const STATUSES = [
  { id: "ideas", label: "Ideas", color: "#b49af5" },
  { id: "todo", label: "To Do", color: "#a1a8b5" },
  { id: "in_progress", label: "In Progress", color: "#e8b96c" },
  { id: "testing", label: "Testing", color: "#75b8f1" },
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
export interface ItemDraft {
  title: string;
  description: string;
  type: ItemType;
  priority: Priority;
  status: Status;
}
export interface Item extends ItemDraft {
  id: string;
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
  return { ...draft, title };
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
      `${i.title} ${i.description}`.toLowerCase().includes(term),
  );
}
