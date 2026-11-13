import { Component, computed, effect, inject, signal, viewChild } from "@angular/core";
import { CODEX_RUNS, CodexOverview } from './core/codex-runs';
import { FormsModule } from "@angular/forms";
import { DatePipe, TitleCasePipe } from "@angular/common";
import { CdkDragDrop, DragDropModule } from "@angular/cdk/drag-drop";
import { A11yModule } from "@angular/cdk/a11y";
import { AUTH } from "./core/auth";
import { REPOSITORY } from "./core/repository";
import {
  Item,
  ItemDraft,
  Project,
  STATUSES,
  Status,
  visibleItems,
} from "./core/models";
import { WorkspaceStore, message } from "./core/store";
import { startLiveBoard } from "./core/live-board";
import { Icon } from "./ui/icon";
import { AuthPanel } from "./ui/auth-panel";
import { ItemPanel } from "./ui/item-panel";
import { ConnectionsPanel } from "./ui/connections-panel";
import { WorkflowSummary } from "./ui/workflow-summary";

@Component({
  selector: "app-root",
  imports: [
    FormsModule,
    DatePipe,
    TitleCasePipe,
    DragDropModule,
    A11yModule,
    Icon,
    AuthPanel,
    ItemPanel,
    ConnectionsPanel,
    WorkflowSummary,
  ],
  templateUrl: "./app.html",
})
export class App {
  private readonly codex = inject(CODEX_RUNS, { optional: true });
  private readonly itemPanel = viewChild(ItemPanel);
  readonly codexRuns = signal<CodexOverview[]>([]);
  readonly codexSyncError = signal('');
  readonly codexAttention = computed(() => this.codexRuns().filter(run => run.status === 'waiting' || run.status === 'needs_input'));
  readonly attentionRequest = signal(0);
  readonly attentionOpening = signal(false);
  readonly codexByItem = computed(() => new Map(this.codexRuns().map(run => [run.item.id, run])));
  codexWorking(id: string): boolean { return ['starting', 'running'].includes(this.codexByItem().get(id)?.status ?? ''); }
  codexWaiting(id: string): boolean { return ['waiting', 'needs_input'].includes(this.codexByItem().get(id)?.status ?? ''); }
  async openCodexAttention(run: CodexOverview): Promise<void> {
    if (this.attentionOpening() || this.store.busy()) return;
    this.attentionOpening.set(true);
    try {
      if (this.panel() && this.panel()?.item?.id !== run.item.id) {
        this.itemPanel()?.requestClose();
        if (this.panel()) return;
      }
      if (this.store.projectId() !== run.item.project_id) await this.selectProject(run.item.project_id);
      if (!this.panel()) this.openItem(this.store.items().find(item => item.id === run.item.id) ?? run.item);
      this.attentionRequest.update(value => value + 1);
    } finally { this.attentionOpening.set(false); }
  }
  readonly auth = inject(AUTH);
  private readonly repo = inject(REPOSITORY);
  private readonly accountId = computed(() => this.auth?.user()?.id ?? null);
  readonly store = new WorkspaceStore(this.repo);
  readonly statuses = STATUSES;
  readonly view = signal<"board" | "list">("board");
  readonly archived = signal(false);
  readonly search = signal("");
  readonly mobileNav = signal(false);
  readonly sidebarCollapsed = signal(false);
  readonly theme = signal<"dark" | "light">("dark");
  readonly panel = signal<{ item: Item | null; status: Status } | null>(null);
  readonly openPanelItem = computed(() => {
    const selected = this.panel()?.item;
    return selected ? this.store.items().find(card => card.id === selected.id) ?? selected : null;
  });
  readonly openPanelRemoved = computed(() => {
    const selected = this.panel()?.item;
    return Boolean(selected && !this.store.loading() && !this.store.items().some(card => card.id === selected.id));
  });
  readonly projectForm = signal<"create" | "rename" | "delete" | null>(null);
  readonly connectionProject = signal<Project | null>(null);
  readonly liveConnectionProject = computed(() => {
    const selected = this.connectionProject();
    return selected ? this.store.projects().find(project => project.id === selected.id) ?? null : null;
  });
  readonly error = signal("");
  readonly panelError = signal("");
  readonly toast = signal("");
  readonly filtered = computed(() =>
    visibleItems(this.store.items(), this.archived(), this.search()),
  );
  readonly active = computed(() =>
    this.store.items().filter((i) => !i.archived_at),
  );
  readonly done = computed(
    () => this.active().filter((i) => i.status === "done").length,
  );
  readonly progress = computed(() =>
    this.active().length
      ? Math.round((this.done() / this.active().length) * 100)
      : 0,
  );
  projectName = "";
  deleteName = "";
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    effect(onCleanup => {
      const userId = this.accountId();
      this.codexRuns.set([]);
      this.codexSyncError.set('');
      if (!userId || !this.codex?.overview) return;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout>;
      const refresh = async () => {
        try {
          const runs = await this.codex!.overview!();
          if (!stopped) { this.codexRuns.set(runs); this.codexSyncError.set(''); }
        } catch {
          if (!stopped) this.codexSyncError.set('Codex status could not be refreshed. Check the local API connection; restart DevPilot after active work finishes if needed.');
        }
        finally { if (!stopped) timer = setTimeout(() => void refresh(), 2000); }
      };
      void refresh();
      onCleanup(() => { stopped = true; clearTimeout(timer); });
    });
    try {
      const saved = localStorage.getItem("devpilot-theme");
      this.theme.set(saved === "light" ? "light" : "dark");
      this.sidebarCollapsed.set(localStorage.getItem("devpilot-sidebar-collapsed") === "true");
    } catch {}
    effect(() => {
      document.documentElement.dataset["theme"] = this.theme();
      try {
        localStorage.setItem("devpilot-theme", this.theme());
      } catch {}
    });
    effect(() => {
      try {
        localStorage.setItem("devpilot-sidebar-collapsed", String(this.sidebarCollapsed()));
      } catch {}
    });
    effect(() => {
      const id = this.accountId();
      this.panel.set(null);
      this.projectForm.set(null);
      this.connectionProject.set(null);
      this.search.set("");
      this.error.set("");
      if (id) void this.store.load(id);
      else this.store.reset();
    });
    effect((onCleanup) => {
      const userId = this.accountId();
      if (userId && this.repo.watchWorkspace) {
        onCleanup(startLiveBoard(
          reconcile => this.store.refreshWorkspace(reconcile),
          (changed, connected) => this.repo.watchWorkspace!(userId, changed, connected, event => {
            if (this.accountId() === userId) this.store.receiveNoteEvent(event);
          }),
        ));
      } else if (userId && this.store.projectId()) {
        const projectId = this.store.projectId()!;
        onCleanup(startLiveBoard(
          async () => { await this.store.refreshItems(true); this.store.noteSyncVersion.update(version => version + 1); },
          this.repo.watchItems ? (changed, connected) => this.repo.watchItems!(projectId, changed, connected) : undefined,
        ));
      }
    });
  }
  column(status: Status): Item[] {
    return this.filtered().filter((i) => i.status === status);
  }
  statusLabel(status: Status): string {
    return STATUSES.find((s) => s.id === status)?.label ?? status;
  }
  statusColor(status: Status): string {
    return STATUSES.find((s) => s.id === status)?.color ?? "";
  }
  async selectProject(id: string): Promise<void> {
    this.connectionProject.set(null);
    this.mobileNav.set(false);
    this.panel.set(null);
    this.archived.set(false);
    this.search.set("");
    this.error.set("");
    await this.store.selectProject(id);
  }
  openItem(item: Item | null = null, status: Status = "ideas"): void {
    this.panelError.set("");
    this.panel.set({ item, status });
  }
  showProjectForm(mode: "create" | "rename" | "delete"): void {
    this.error.set("");
    this.projectName =
      mode === "rename" ? (this.store.project()?.name ?? "") : "";
    this.deleteName = "";
    this.projectForm.set(mode);
  }
  async saveProject(): Promise<void> {
    this.error.set("");
    try {
      const mode = this.projectForm();
      const id = this.store.projectId();
      if (mode === "create") await this.store.createProject(this.projectName);
      else if (mode === "rename" && id)
        await this.store.renameProject(id, this.projectName);
      else if (
        mode === "delete" &&
        id &&
        this.deleteName === this.store.project()?.name
      )
        await this.store.deleteProject(id);
      else return;
      this.projectForm.set(null);
      this.notify(mode === "delete" ? "Project deleted" : "Project saved");
    } catch (e) {
      this.error.set(message(e));
    }
  }
  readonly persistCard = async (draft: ItemDraft): Promise<void> => {
    const item = this.openPanelItem();
    if (!item || this.openPanelRemoved()) throw new Error('This card is no longer available.');
    await this.store.saveItem(draft, item.id);
  };
  async saveItem(draft: ItemDraft): Promise<void> {
    this.panelError.set("");
    try {
      await this.store.saveItem(draft, this.panel()?.item?.id);
      this.panel.set(null);
      this.notify("Item saved");
    } catch (e) {
      this.panelError.set(message(e));
    }
  }
  async archiveItem(): Promise<void> {
    const item = this.openPanelItem();
    if (!item) return;
    this.panelError.set("");
    try {
      await this.store.archiveItem(item.id, !item.archived_at);
      this.panel.set(null);
      this.notify(item.archived_at ? "Item restored" : "Item archived");
    } catch (e) {
      this.panelError.set(message(e));
    }
  }
  async changeStatus(item: Item, status: Status): Promise<void> {
    if (item.status === status || this.store.busy()) return;
    this.error.set("");
    try {
      await this.store.saveItem({ ...item, status }, item.id);
      this.notify(`Moved to ${this.statusLabel(status)}`);
    } catch (e) {
      this.error.set(message(e));
    }
  }
  drop(event: CdkDragDrop<Status, Status, Item>): void {
    if (event.previousContainer !== event.container)
      void this.changeStatus(event.item.data, event.container.data);
  }
  async changeListStatus(item: Item, event: Event): Promise<void> {
    const control = event.target as HTMLSelectElement;
    const next = control.value as Status;
    control.value = item.status;
    await this.changeStatus(item, next);
    control.value =
      this.store.items().find((i) => i.id === item.id)?.status ?? item.status;
  }
  async signOut(): Promise<void> {
    try {
      await this.auth.signOut();
    } catch (e) {
      this.error.set(message(e));
    }
  }
  notify(text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(text);
    this.toastTimer = setTimeout(() => this.toast.set(""), 3500);
  }
}
