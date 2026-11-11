import { InjectionToken } from "@angular/core";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  Item,
  ItemDraft,
  Note,
  Project,
  validateItem,
  validateName,
} from "./models";

export interface Repository {
  projects(): Promise<Project[]>;
  createProject(name: string, ownerId: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  items(projectId: string): Promise<Item[]>;
  saveItem(projectId: string, draft: ItemDraft, id?: string): Promise<Item>;
  archiveItem(id: string, archived: boolean): Promise<Item>;
  notes(itemId: string): Promise<Note[]>;
  addNote(itemId: string, body: string): Promise<Note>;
}
export const REPOSITORY = new InjectionToken<Repository>("DevPilot repository");
export class SupabaseRepository implements Repository {
  constructor(private readonly db: SupabaseClient) {}
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
      .order("created_at");
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
  async addNote(itemId: string, body: string): Promise<Note> {
    const { data, error } = await this.db
      .from("notes")
      .insert({ item_id: itemId, body: validateName(body, 10000) })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
