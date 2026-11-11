import { signal } from "@angular/core";
import { Account, AccountAuth } from "./auth";
import { Repository } from "./repository";
import {
  Item,
  ItemDraft,
  Note,
  Project,
  validateItem,
  validateName,
} from "./models";

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
      throw new Error(data.message ?? "Local database request failed.");
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
  async signIn(username: string, password: string): Promise<void> {
    const user = await this.api.call<Account>("/auth/login", "POST", {
      username: username.trim(),
      password,
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
  addNote(itemId: string, body: string): Promise<Note> {
    return this.api.call(`/items/${encodeURIComponent(itemId)}/notes`, "POST", {
      body: validateName(body, 10000),
    });
  }
}
