import { Component, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, TitleCasePipe } from "@angular/common";
import { CdkDragDrop, DragDropModule } from "@angular/cdk/drag-drop";
import { A11yModule } from "@angular/cdk/a11y";
import { AUTH } from "./core/auth";
import { REPOSITORY } from "./core/repository";
import { Item, ItemDraft, STATUSES, Status, visibleItems } from "./core/models";
import { WorkspaceStore, message } from "./core/store";
import { Icon } from "./ui/icon";
import { AuthPanel } from "./ui/auth-panel";
import { ItemPanel } from "./ui/item-panel";

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
  ],
  templateUrl: "./app.html",
})
export class App {
  readonly auth = inject(AUTH);
  private readonly repo = inject(REPOSITORY);
  private readonly accountId = computed(() => this.auth?.user()?.id ?? null);
  readonly store = new WorkspaceStore(this.repo);
  readonly statuses = STATUSES;
  readonly view = signal<"board" | "list">("board");
  readonly archived = signal(false);
  readonly search = signal("");
  readonly mobileNav = signal(false);
  readonly theme = signal<"dark" | "light">("dark");
  readonly panel = signal<{ item: Item | null; status: Status } | null>(null);
  readonly projectForm = signal<"create" | "rename" | "delete" | null>(null);
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
    try {
      const saved = localStorage.getItem("devpilot-theme");
      this.theme.set(saved === "light" ? "light" : "dark");
    } catch {}
    effect(() => {
      document.documentElement.dataset["theme"] = this.theme();
      try {
        localStorage.setItem("devpilot-theme", this.theme());
      } catch {}
    });
    effect(() => {
      const id = this.accountId();
      this.panel.set(null);
      this.projectForm.set(null);
      this.search.set("");
      this.error.set("");
      if (id) void this.store.load(id);
      else this.store.reset();
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
    const item = this.panel()?.item;
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
