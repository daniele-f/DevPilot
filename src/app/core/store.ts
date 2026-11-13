import { computed, signal } from "@angular/core";
import { Item, ItemDraft, Project } from "./models";
import { Repository } from "./repository";
import { NoteEvent } from "./note-events";

/** Owns server state. Request epochs prevent late responses crossing project/account boundaries. */
export class WorkspaceStore {
  readonly projects = signal<Project[]>([]);
  readonly items = signal<Item[]>([]);
  readonly refreshVersion = signal(0);
  readonly noteSyncVersion = signal(0);
  readonly noteEvents = signal<NoteEvent[]>([]);
  readonly projectId = signal<string | null>(null);
  readonly project = computed(
    () => this.projects().find((p) => p.id === this.projectId()) ?? null,
  );
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  private userId: string | null = null;
  private accountEpoch = 0;
  private itemEpoch = 0;
  private mutationEpoch = 0;
  private refreshEpoch = 0;
  private backgroundRefreshPending = false;
  private workspaceRefreshPending = false;
  private workspaceRefreshEpoch = 0;
  private notesReconcilePending = false;
  private noteDelivery = 0;
  constructor(private readonly repo: Repository) {}
  reset(): void {
    this.accountEpoch++;
    this.itemEpoch++;
    this.userId = null;
    this.backgroundRefreshPending = false;
    this.workspaceRefreshPending = false;
    this.notesReconcilePending = false;
    this.noteEvents.set([]);
    this.noteDelivery = 0;
    this.projects.set([]);
    this.items.set([]);
    this.projectId.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set("");
  }
  async load(userId: string): Promise<void> {
    this.reset();
    this.userId = userId;
    const epoch = this.accountEpoch;
    this.loading.set(true);
    try {
      const projects = await this.repo.projects();
      if (epoch !== this.accountEpoch) return;
      this.projects.set(projects);
      await this.selectProject(projects[0]?.id ?? null);
    } catch (error) {
      if (epoch === this.accountEpoch) this.error.set(message(error));
    } finally {
      if (epoch === this.accountEpoch) this.loading.set(false);
      if (epoch === this.accountEpoch && this.workspaceRefreshPending) void this.refreshWorkspace();
    }
  }
  async selectProject(id: string | null): Promise<void> {
    const epoch = ++this.itemEpoch;
    this.projectId.set(id);
    this.items.set([]);
    this.error.set("");
    this.loading.set(Boolean(id));
    if (!id) return;
    try {
      const items = await this.repo.items(id);
      if (epoch === this.itemEpoch) this.items.set(items);
    } catch (error) {
      if (epoch === this.itemEpoch) this.error.set(message(error));
    } finally {
      if (epoch === this.itemEpoch) {
        this.loading.set(false);
        if (this.workspaceRefreshPending) void this.refreshWorkspace();
        if (this.backgroundRefreshPending) void this.refreshItems(true);
      }
    }
  }
  async refreshItems(background = false): Promise<void> {
    const id = this.projectId();
    if (!id) return;
    if (this.busy() || this.loading()) {
      if (background) this.backgroundRefreshPending = true;
      return;
    }
    this.backgroundRefreshPending = false;
    const epoch = this.itemEpoch;
    const mutation = this.mutationEpoch;
    const refresh = ++this.refreshEpoch;
    if (!background) this.error.set("");
    try {
      const items = await this.repo.items(id);
      if (
        epoch === this.itemEpoch &&
        mutation === this.mutationEpoch &&
        refresh === this.refreshEpoch
      ) {
        this.items.set(items);
        this.refreshVersion.update(version => version + 1);
        if (!background) this.noteSyncVersion.update(version => version + 1);
      }
      else if (background && epoch === this.itemEpoch && mutation !== this.mutationEpoch)
        void this.refreshItems(true);
    } catch (error) {
      if (
        epoch === this.itemEpoch &&
        mutation === this.mutationEpoch &&
        refresh === this.refreshEpoch && !background
      )
        this.error.set(message(error));
    }
  }
  receiveNoteEvent(event: NoteEvent): void {
    if (!this.userId || this.noteEvents().some(existing => existing.id === event.id)) return;
    this.noteEvents.update(events => [...events.slice(-511), { ...event, delivery: ++this.noteDelivery }]);
  }
  async refreshWorkspace(reconcileNotes = false): Promise<void> {
    if (!this.userId) return;
    this.notesReconcilePending ||= reconcileNotes;
    if (this.busy() || this.loading()) { this.workspaceRefreshPending = true; return; }
    this.workspaceRefreshPending = false;
    const reconcile = this.notesReconcilePending;
    this.notesReconcilePending = false;
    const account = this.accountEpoch;
    const mutation = this.mutationEpoch;
    const refresh = ++this.workspaceRefreshEpoch;
    try {
      const projects = await this.repo.projects();
      if (account !== this.accountEpoch) return;
      if (refresh !== this.workspaceRefreshEpoch) {
        if (reconcile) void this.refreshWorkspace(true);
        return;
      }
      if (mutation !== this.mutationEpoch) { void this.refreshWorkspace(reconcile); return; }
      this.projects.set(projects);
      const selected = this.projectId();
      if (selected && !projects.some(project => project.id === selected)) {
        // Do not switch viewers to somebody else's selection. Keep an open
        // editor mounted for copying drafts, but invalidate its saved card.
        this.itemEpoch++;
        this.projectId.set(null);
        this.items.set([]);
        this.refreshVersion.update(version => version + 1);
      } else {
        await this.refreshItems(true);
      }
      if (account === this.accountEpoch && (reconcile || this.notesReconcilePending)) {
        this.notesReconcilePending = false;
        this.noteSyncVersion.update(version => version + 1);
      }
    } catch {
      if (account === this.accountEpoch) this.notesReconcilePending ||= reconcile;
      // Keep the last confirmed state through temporary connectivity failures.
    }
  }
  async createProject(name: string): Promise<void> {
    if (!this.userId) throw new Error("Sign in to create a project.");
    const owner = this.userId;
    const epoch = this.accountEpoch;
    await this.mutate(async () => {
      const project = await this.repo.createProject(name, owner);
      if (epoch !== this.accountEpoch) return;
      this.projects.update((all) => [...all, project]);
      await this.selectProject(project.id);
    });
  }
  async renameProject(id: string, name: string): Promise<void> {
    const epoch = this.accountEpoch;
    await this.mutate(async () => {
      const p = await this.repo.renameProject(id, name);
      if (epoch === this.accountEpoch)
        this.projects.update((all) => all.map((x) => (x.id === id ? p : x)));
    });
  }
  async deleteProject(id: string): Promise<void> {
    const epoch = this.accountEpoch;
    await this.mutate(async () => {
      await this.repo.deleteProject(id);
      if (epoch !== this.accountEpoch) return;
      this.projects.update((all) => all.filter((p) => p.id !== id));
      if (this.projectId() === id)
        await this.selectProject(this.projects()[0]?.id ?? null);
    });
  }
  async saveItem(draft: ItemDraft, id?: string): Promise<Item> {
    const projectId = this.projectId();
    if (!projectId) throw new Error("Choose a project first.");
    const epoch = this.itemEpoch;
    return this.mutate(async () => {
      const item = await this.repo.saveItem(projectId, draft, id);
      if (epoch === this.itemEpoch)
        this.items.update((all) =>
          id ? all.map((i) => (i.id === id ? item : i)) : [...all, item],
        );
      return item;
    });
  }
  async archiveItem(id: string, archived: boolean): Promise<void> {
    const epoch = this.itemEpoch;
    await this.mutate(async () => {
      const item = await this.repo.archiveItem(id, archived);
      if (epoch === this.itemEpoch)
        this.items.update((all) => all.map((i) => (i.id === id ? item : i)));
    });
  }
  private async mutate<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy())
      throw new Error("Please wait for the current change to finish.");
    this.mutationEpoch++;
    const epoch = this.accountEpoch;
    this.busy.set(true);
    try {
      return await work();
    } finally {
      if (epoch === this.accountEpoch) {
        this.busy.set(false);
        if (this.workspaceRefreshPending) void this.refreshWorkspace();
        if (this.backgroundRefreshPending) void this.refreshItems(true);
      }
    }
  }
}
export function message(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Something went wrong. Please try again.";
}
