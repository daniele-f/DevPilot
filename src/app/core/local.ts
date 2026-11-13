import { signal } from "@angular/core";
import { Account, AccountAuth } from "./auth";
import { Repository } from "./repository";
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

export class LocalApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class LocalApi {
  constructor(
    private readonly request: typeof fetch = (input, options) =>
      fetch(input, options),
  ) {}
  async call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.request(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-DevPilot-Local": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new LocalApiError(response.status, data.message ?? "Local database request failed.");
    return data as T;
  }
}

/** Development login is backed by the local SQLite API, never Supabase. */
export class LocalAuth implements AccountAuth {
  readonly local = true;
  readonly user = signal<Account | null>(null);
  readonly ready = signal(false);
  readonly recovery = signal(false);
  constructor(private readonly api: LocalApi) {
    void api
      .call<Account | null>("/auth/session")
      .then((user) => this.user.set(user))
      .catch(() => this.user.set(null))
      .finally(() => this.ready.set(true));
  }
  async signIn(username: string, password: string, remember = false): Promise<void> {
    const user = await this.api.call<Account>("/auth/login", "POST", {
      username: username.trim(),
      password,
      remember,
    });
    this.user.set(user);
  }
  async signOut(): Promise<void> {
    await this.api.call("/auth/logout", "POST");
    this.user.set(null);
  }
  async signUp(): Promise<boolean> {
    throw new Error("Account registration is available in production.");
  }
  async resetPassword(): Promise<void> {
    throw new Error("Password recovery is available in production.");
  }
  async updatePassword(): Promise<void> {
    throw new Error("Password changes are available in production.");
  }
}

export class LocalRepository implements Repository {
  constructor(private readonly api: LocalApi) {}
  watchWorkspace(_userId: string, changed: () => void, connected: (ready: boolean) => void, noteChanged?: (event: NoteEvent) => void): () => void {
    const stream = new EventSource("/api/events");
    stream.addEventListener("ready", () => connected(true));
    stream.addEventListener("change", changed);
    stream.addEventListener("resync", () => { connected(false); connected(true); });
    stream.addEventListener("note", event => {
      try {
        const note = JSON.parse((event as MessageEvent).data) as NoteEvent;
        if (noteChanged) noteChanged(note); else changed();
      } catch { connected(false); connected(true); }
    });
    stream.onerror = () => connected(false);
    return () => stream.close();
  }
  watchItems(projectId: string, changed: () => void, connected: (ready: boolean) => void): () => void {
    const stream = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
    stream.addEventListener("ready", () => { connected(true); changed(); });
    stream.addEventListener("change", changed);
    stream.addEventListener("note", changed);
    stream.addEventListener("resync", changed);
    stream.onerror = () => connected(false);
    return () => stream.close();
  }
  editNote(id: string, body: string): Promise<Note> {
    return this.api.call(`/notes/${encodeURIComponent(id)}`, "PATCH", { body: validateName(body, 10000) });
  }
  deleteNote(id: string): Promise<void> {
    return this.api.call(`/notes/${encodeURIComponent(id)}`, "DELETE");
  }
  projects(): Promise<Project[]> {
    return this.api.call("/projects");
  }
  createProject(name: string, _ownerId: string): Promise<Project> {
    return this.api.call("/projects", "POST", { name: validateName(name, 80) });
  }
  renameProject(id: string, name: string): Promise<Project> {
    return this.api.call(`/projects/${encodeURIComponent(id)}`, "PATCH", {
      name: validateName(name, 80),
    });
  }
  deleteProject(id: string): Promise<void> {
    return this.api.call(`/projects/${encodeURIComponent(id)}`, "DELETE");
  }
  items(projectId: string): Promise<Item[]> {
    return this.api.call(`/projects/${encodeURIComponent(projectId)}/items`);
  }
  saveItem(projectId: string, draft: ItemDraft, id?: string): Promise<Item> {
    return this.api.call(
      `/projects/${encodeURIComponent(projectId)}/items${id ? "/" + encodeURIComponent(id) : ""}`,
      id ? "PATCH" : "POST",
      validateItem(draft),
    );
  }
  archiveItem(id: string, archived: boolean): Promise<Item> {
    return this.api.call(`/items/${encodeURIComponent(id)}/archive`, "PATCH", {
      archived,
    });
  }
  notes(itemId: string): Promise<Note[]> {
    return this.api.call(`/items/${encodeURIComponent(itemId)}/notes`);
  }
  activity(itemId: string): Promise<Activity[]> {
    return this.api.call(`/items/${encodeURIComponent(itemId)}/activity`);
  }
  deleteActivity(itemId: string, id: string): Promise<void> {
    return this.api.call(`/items/${encodeURIComponent(itemId)}/activity/${encodeURIComponent(id)}`, "DELETE");
  }
  addNote(itemId: string, body: string): Promise<Note> {
    return this.api.call(`/items/${encodeURIComponent(itemId)}/notes`, "POST", {
      body: validateName(body, 10000),
    });
  }
}
