import { InjectionToken } from "@angular/core";
import { SupabaseClient } from "@supabase/supabase-js";
import { NoteEvent } from "./note-events";
import {
  Item,
  Activity,
  ItemDraft,
  Note,
  Project,
  validateItem,
  validateName,
} from "./models";

export interface Repository {
  watchWorkspace?(userId: string, changed: () => void, connected: (ready: boolean) => void, noteChanged?: (event: NoteEvent) => void): () => void;
  watchItems?(projectId: string, changed: () => void, connected: (ready: boolean) => void): () => void;
  projects(): Promise<Project[]>;
  createProject(name: string, ownerId: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  items(projectId: string): Promise<Item[]>;
  saveItem(projectId: string, draft: ItemDraft, id?: string): Promise<Item>;
  archiveItem(id: string, archived: boolean): Promise<Item>;
  notes(itemId: string): Promise<Note[]>;
  activity?(itemId: string): Promise<Activity[]>;
  deleteActivity?(itemId: string, id: string): Promise<void>;
  addNote(itemId: string, body: string): Promise<Note>;
  editNote(id: string, body: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
}
export const REPOSITORY = new InjectionToken<Repository>("DevPilot repository");
export class SupabaseRepository implements Repository {
  constructor(private readonly db: SupabaseClient) {}
  watchWorkspace(userId: string, changed: () => void, connected: (ready: boolean) => void, noteChanged?: (event: NoteEvent) => void): () => void {
    // RLS controls which shared rows are visible. No actor filter: changes by
    // any authorized writer must invalidate the same shared state.
    const channel = this.db.channel(`workspace:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, payload => {
        const operation = payload.eventType.toLowerCase() as NoteEvent["operation"];
        const row = (operation === "delete" ? payload.old : payload.new) as Partial<Note>;
        if (!row.id) { changed(); return; }
        const event: NoteEvent = { id: `hosted:${payload.commit_timestamp}:${operation}:${row.id}`, operation, note_id: row.id,
          ...(row.item_id ? { item_id: row.item_id } : {}), ...(operation !== "delete" ? { note: row as Note } : {}) };
        if (noteChanged) noteChanged(event); else changed();
      })
      .subscribe(status => {
        connected(status === "SUBSCRIBED");
      });
    return () => { void this.db.removeChannel(channel); };
  }
  watchItems(projectId: string, changed: () => void, connected: (ready: boolean) => void): () => void {
    const channel = this.db.channel(`board:${projectId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "items", filter: `project_id=eq.${projectId}` }, changed)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "items", filter: `project_id=eq.${projectId}` }, changed)
      // Postgres Changes cannot filter DELETE events; only invalidate and fetch
      // the selected project's rows through the existing ownership policies.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "items" }, changed)
      .subscribe(status => {
        connected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") changed();
      });
    return () => { void this.db.removeChannel(channel); };
  }
  async editNote(id: string, body: string): Promise<Note> {
    const { data, error } = await this.db.from("notes")
      .update({ body: validateName(body, 10000) }).eq("id", id).eq("author", "user").select().single();
    if (error) throw error;
    return data;
  }
  async deleteNote(id: string): Promise<void> {
    const { data, error } = await this.db.from("notes")
      .delete().eq("id", id).eq("author", "user").select("id").single();
    if (error || !data) throw error ?? new Error("Note was not removed.");
  }
  async projects(): Promise<Project[]> {
    const { data, error } = await this.db
      .from("projects")
      .select("*")
      .order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async createProject(name: string, ownerId: string): Promise<Project> {
    const { data, error } = await this.db
      .from("projects")
      .insert({ name: validateName(name, 80), owner_id: ownerId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  async renameProject(id: string, name: string): Promise<Project> {
    const { data, error } = await this.db
      .from("projects")
      .update({ name: validateName(name, 80) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  async deleteProject(id: string): Promise<void> {
    const { data, error } = await this.db
      .from("projects")
      .delete()
      .eq("id", id)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Project was not deleted.");
  }
  async items(projectId: string): Promise<Item[]> {
    const { data, error } = await this.db
      .from("items")
      .select("*")
      .eq("project_id", projectId)
      .order("lane_position");
    if (error) throw error;
    return data ?? [];
  }
  async saveItem(
    projectId: string,
    draft: ItemDraft,
    id?: string,
  ): Promise<Item> {
    const value = validateItem(draft);
    const query = id
      ? this.db
          .from("items")
          .update(value)
          .eq("id", id)
          .eq("project_id", projectId)
      : this.db.from("items").insert({ ...value, project_id: projectId });
    const { data, error } = await query.select().single();
    if (error) throw error;
    return data;
  }
  async archiveItem(id: string, archived: boolean): Promise<Item> {
    const { data, error } = await this.db
      .from("items")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  async notes(itemId: string): Promise<Note[]> {
    const { data, error } = await this.db
      .from("notes")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async activity(itemId: string): Promise<Activity[]> {
    const result: Activity[] = [];
    let cursor = 0;
    for (;;) {
      // Keyset paging preserves newer history beyond the API row cap. Continue
      // until an empty page, including when the server caps pages below 500.
      const { data, error } = await this.db.from("item_activity").select("*")
        .eq("item_id", itemId).gt("sequence", cursor).order("sequence").limit(500);
      if (error) throw error;
      if (!data?.length) return result;
      result.push(...data);
      cursor = data[data.length - 1].sequence;
    }
  }
  async deleteActivity(itemId: string, id: string): Promise<void> {
    const { data, error } = await this.db.from("item_activity").delete()
      .eq("id", id).eq("item_id", itemId).eq("kind", "note_deleted").eq("actor", "user")
      .select("id").single();
    if (error || !data) throw error ?? new Error("Removed-note history was not removed.");
  }
  async addNote(itemId: string, body: string): Promise<Note> {
    const { data, error } = await this.db
      .from("notes")
      .insert({ item_id: itemId, body: validateName(body, 10000), author: "user" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
