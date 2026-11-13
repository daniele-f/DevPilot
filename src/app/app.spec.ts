import { CODEX_RUNS, CodexClient, CodexRun } from "./core/codex-runs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provideZonelessChangeDetection, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { App } from "./app";
import { AUTH } from "./core/auth";
import { REPOSITORY, Repository } from "./core/repository";
import { Item, ItemDraft } from "./core/models";
import { ItemPanel } from "./ui/item-panel";
import { By } from "@angular/platform-browser";
import { InteractivityChecker } from "@angular/cdk/a11y";

afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
  localStorage.removeItem("devpilot-sidebar-collapsed");
});
const item: Item = {
  id: "i1",
  project_id: "p1",
  title: "Idea",
  description: "",
  type: "idea",
  priority: "medium",
  status: "ideas",
  archived_at: null,
  created_at: "2026-11-11",
  updated_at: "2026-11-11",
};
async function setup(overrides: Partial<Repository> = {}, codex?: CodexClient) {
  const user = signal({ id: "u1", email: "test@example.invalid" });
  const repo = {
    projects: async () => [
      { id: "p1", owner_id: "u1", name: "DevPilot", created_at: "" },
    ],
    items: async () => [item],
    notes: async () => [],
    ...overrides,
  };
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: AUTH,
        useValue: { user, ready: signal(true), recovery: signal(false) },
      },
      { provide: REPOSITORY, useValue: repo },
      ...(codex ? [{ provide: CODEX_RUNS, useValue: codex }] : []),
      {
        provide: InteractivityChecker,
        useValue: { isFocusable: () => true, isTabbable: () => true },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, user, app: fixture.componentInstance };
}
describe("workspace session lifecycle", () => {
  it("refreshes notes and all untouched fields in an open card while preserving unfinished edits", async () => {
    let cards = [{ ...item }];
    let notes = [{ id: "n1", item_id: item.id, body: "Original", created_at: "", author: "user" as const }];
    let notify!: () => void;
    const { fixture, app } = await setup({
      items: async () => cards,
      notes: async () => notes,
      watchItems: (_id, changed, connected) => { notify = changed; connected(true); return () => {}; },
    });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    panel.draft.description = "My unfinished description";
    panel.noteBody = "My unfinished note";
    cards = [{ ...item, title: "Changed title", description: "Saved description", status: "testing", type: "bug", priority: "high", next_actor: "user", next_action: "Test it", acceptance_criteria: [{ text: "Verify", completed: true }] } as Item];
    notes = [{ ...notes[0], body: "Edited externally" }, { ...notes[0], id: "n2", body: "Added externally" }];
    notify();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.draft).toMatchObject({ title: "Changed title", description: "My unfinished description", status: "testing", type: "bug", priority: "high", next_actor: "user", next_action: "Test it", acceptance_criteria: [{ text: "Verify", completed: true }] });
    expect(panel.notes()).toEqual(notes);
    expect(panel.noteBody).toBe("My unfinished note");
    notes = [notes[1]];
    notify();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.notes()).toEqual(notes);
    cards = [];
    notify();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(app.store.items()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain("This card was removed");
    expect(panel.draft.description).toBe("My unfinished description");
  });
  it("shows externally created and edited stories on focus while preserving an open draft", async () => {
    let persisted = [item];
    const { fixture, app, user } = await setup({ items: async () => persisted });
    app.openItem(item);
    await fixture.whenStable();
    const editor = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    editor.draft.description = "Unsaved local draft";
    persisted = [{ ...item, title: "Updated through Codex", status: "testing" }, { ...item, id: "i2", title: "Created through Codex" }];
    window.dispatchEvent(new Event("focus"));
    await fixture.whenStable();
    expect(app.store.items()).toEqual(persisted);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Created through Codex");
    expect(fixture.nativeElement.textContent).toContain("Updated through Codex");
    expect(editor.draft.description).toBe("Unsaved local draft");
    user.set(null as never);
    await fixture.whenStable();
    window.dispatchEvent(new Event("focus"));
    await fixture.whenStable();
    expect(app.store.items()).toEqual([]);
  });
  it("opens titles as text, enters pencil editing and can finish or cancel title edits", async () => {
    const { fixture, app } = await setup({ saveItem: async (_project, draft) => ({ ...item, ...draft }) });
    app.openItem(item);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector("#item-title")).toBeNull();
    expect(fixture.nativeElement.querySelector(".item-title-text").textContent).toBe("Idea");
    fixture.nativeElement.querySelector('[aria-label="Edit title"]').click();
    await fixture.whenStable();
    const editor = fixture.nativeElement.querySelector("#item-title") as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    editor.value = "Revised idea";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector("#item-title")).toBeNull();
    expect(fixture.nativeElement.querySelector(".item-title-text").textContent).toBe("Revised idea");
    expect(app.store.items()[0].title).toBe("Revised idea");
    expect(app.panel()).not.toBeNull();
    fixture.nativeElement.querySelector('[aria-label="Edit title"]').click();
    await fixture.whenStable();
    const reopened = fixture.nativeElement.querySelector("#item-title") as HTMLTextAreaElement;
    reopened.value = "Discard me";
    reopened.dispatchEvent(new Event("input", { bubbles: true }));
    reopened.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await fixture.whenStable();
    expect(app.panel()).not.toBeNull();
    expect(fixture.nativeElement.querySelector(".item-title-text").textContent).toBe("Revised idea");
  });
  it("edits handoff and acceptance without mutating the loaded item or auto-completing it", async () => {
    const original: Item = { ...item, status: "testing", next_actor: "user", next_action: "Try it", acceptance_criteria: [{ text: "Mobile works", completed: false }] };
    let saved: unknown;
    const { fixture, app } = await setup({ items: async () => [original], saveItem: async (_project, draft) => { saved = draft; return { ...original, ...draft }; } });
    await app.store.load("u1");
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Ready for Review");
    expect(fixture.nativeElement.textContent).toContain("Assigned to: Me");
    app.openItem(original);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    expect(fixture.nativeElement.querySelector('[name="nextActor"]')).not.toBeNull();
    panel.draft.acceptance_criteria![0].completed = true;
    panel.draft.next_actor = "codex";
    expect(original.acceptance_criteria![0].completed).toBe(false);
    await panel.saveFields(["next_actor", "acceptance_criteria"]);
    await fixture.whenStable();
    expect(saved).toMatchObject({ status: "testing", next_actor: "codex", next_action: "Try it", acceptance_criteria: [{ text: "Mobile works", completed: true }] });
  });
  it("collapses and expands the sidebar while keeping named project shortcuts", async () => {
    const { fixture } = await setup();
    const toggle = fixture.nativeElement.querySelector(".sidebar-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(".app-shell").classList.contains("sidebar-collapsed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand sidebar");
    expect(fixture.nativeElement.querySelector(".project-nav button").getAttribute("aria-label")).toBe("DevPilot");
    expect(localStorage.getItem("devpilot-sidebar-collapsed")).toBe("true");
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("devpilot-sidebar-collapsed")).toBe("false");
  });
  it("restores the desktop sidebar preference without opening mobile navigation", async () => {
    localStorage.setItem("devpilot-sidebar-collapsed", "true");
    const { fixture, app } = await setup();
    expect(fixture.nativeElement.querySelector(".sidebar-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(app.mobileNav()).toBe(false);
    app.mobileNav.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(".sidebar").classList.contains("open")).toBe(true);
  });
  it("renders a persisted non-default status when the list first opens", async () => {
    const { fixture, app } = await setup({
      items: async () => [{ ...item, status: "testing" }],
    });
    app.view.set("list");
    await fixture.whenStable();
    expect(
      (
        fixture.nativeElement.querySelector(
          ".status-select select",
        ) as HTMLSelectElement
      ).value,
    ).toBe("testing");
  });
  it("shows a validation message for a whitespace-only new item", async () => {
    const { fixture, app } = await setup();
    app.openItem();
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel))
      .componentInstance as ItemPanel;
    panel.draft.title = "   ";
    panel.save();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain("required");
  });
  it("keeps an open draft when the same user receives refreshed session metadata", async () => {
    const { fixture, user, app } = await setup();
    app.openItem();
    await fixture.whenStable();
    expect(app.panel()).not.toBeNull();
    user.set({ id: "u1", email: "updated@example.invalid" });
    await fixture.whenStable();
    expect(app.panel()).not.toBeNull();
  });
  it("restores the persisted status control after a rejected list change", async () => {
    const { fixture, app } = await setup({
      saveItem: async () => {
        throw new Error("Offline");
      },
    });
    app.view.set("list");
    await fixture.whenStable();
    const select = fixture.nativeElement.querySelector(
      ".status-select select",
    ) as HTMLSelectElement;
    select.value = "testing";
    select.dispatchEvent(new Event("change"));
    await fixture.whenStable();
    expect(app.store.items()[0].status).toBe("ideas");
    expect(select.value).toBe("ideas");
    expect(fixture.nativeElement.textContent).toContain("Offline");
  });
  it("shows the author beside each note, including unattributed older notes", async () => {
    const { fixture, app } = await setup({
      notes: async () => [
        { id: "n1", item_id: item.id, body: "Assistant note", author: "codex", created_at: "2026-11-11" },
        { id: "n2", item_id: item.id, body: "My note", author: "user", created_at: "2026-11-11" },
        { id: "n3", item_id: item.id, body: "Older note", created_at: "2026-11-11" },
      ],
    });
    app.openItem(item);
    await fixture.whenStable();
    const notes = [...fixture.nativeElement.querySelectorAll(".note") ] as HTMLElement[];
    expect(notes[0].textContent).toContain("Codex");
    expect(notes[1].textContent).toContain("Me");
    expect(notes[2].textContent).toContain("Unknown");
    expect(notes[0].querySelectorAll("button").length).toBe(0);
    expect(notes[1].textContent).toContain("Edit");
    expect(notes[1].querySelector('[aria-label="Remove note"]')).not.toBeNull();
    expect(notes[2].querySelectorAll("button").length).toBe(0);
  });
  it("keeps failed note edits, saves replacements and confirms removal", async () => {
    let note = { id: "n1", item_id: item.id, body: "Original", author: "user" as const, created_at: "2026-11-11" };
    let offline = true;
    const { fixture, app } = await setup({
      notes: async () => [note],
      editNote: async (_id, body) => {
        if (offline) throw new Error("Offline");
        return note = { ...note, body };
      },
      deleteNote: async () => { if (offline) throw new Error("Offline"); },
    });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    panel.editNote(note);
    panel.editNoteBody = "Edited note";
    await panel.saveNote(note);
    await fixture.whenStable();
    expect(panel.editingNote()).toBe(note.id);
    expect(panel.editNoteBody).toBe("Edited note");
    expect(fixture.nativeElement.textContent).toContain("Offline");
    offline = false;
    await panel.saveNote(note);
    await fixture.whenStable();
    expect(panel.editingNote()).toBeNull();
    expect(fixture.nativeElement.querySelector(".note p").textContent).toBe("Edited note");
    vi.stubGlobal("confirm", () => { throw new Error("Browser confirmation must not be used"); });
    (fixture.nativeElement.querySelector('[aria-label="Remove note"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(panel.notes().length).toBe(1);
    expect(fixture.nativeElement.querySelector(".note-confirmation")).not.toBeNull();
    (fixture.nativeElement.querySelector(".note-confirmation .text-button") as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(".note-confirmation")).toBeNull();
    (fixture.nativeElement.querySelector('[aria-label="Remove note"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    offline = true;
    await panel.removeNote(note);
    expect(panel.notes().length).toBe(1);
    offline = false;
    await panel.removeNote(note);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(".note")).toBeNull();
  });
  it("posts a note with Ctrl+Enter and leaves plain Enter alone", async () => {
    const { fixture, app } = await setup({
      addNote: async (item_id, body) => ({ id: "keyboard", item_id, body, author: "user", created_at: "2026-11-11" }),
    });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    const textarea = fixture.nativeElement.querySelector("#note-body") as HTMLTextAreaElement;
    textarea.value = "Keyboard note";
    textarea.dispatchEvent(new Event("input"));
    await fixture.whenStable();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await fixture.whenStable();
    expect(panel.noteBody).toBe("Keyboard note");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(panel.noteBody).toBe("");
    expect(panel.notes()[0].body).toBe("Keyboard note");
  });
  it("preserves a pending note draft when saving the item", async () => {
    const { fixture, app } = await setup({ saveItem: async () => item });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel))
      .componentInstance as ItemPanel;
    panel.noteBody = "Do not lose this note";
    panel.save();
    await fixture.whenStable();
    expect(app.panel()).not.toBeNull();
    expect(panel.noteBody).toBe("Do not lose this note");
  });
  it("autosaves fields without saving an unconfirmed description or closing the card", async () => {
    const { fixture, app } = await setup({ saveItem: async (_project, draft) => ({ ...item, ...draft }) });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    expect(fixture.nativeElement.textContent).not.toContain("Confirm description");
    expect(fixture.nativeElement.querySelector(".item-timestamp")).toBeNull();
    expect(fixture.nativeElement.querySelector(".acceptance-section").open).toBe(false);
    panel.draft.description = "Unconfirmed description";
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Confirm description");
    panel.draft.priority = "high";
    await panel.saveFields(["priority"]);
    await fixture.whenStable();
    expect(app.panel()).not.toBeNull();
    expect(app.store.items()[0]).toMatchObject({ priority: "high", description: "" });
    expect(panel.draft.description).toBe("Unconfirmed description");
    await panel.saveFields(["description"]);
    await fixture.whenStable();
    expect(app.store.items()[0].description).toBe("Unconfirmed description");
    expect(fixture.nativeElement.querySelector('[name="nextAction"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain("Save changes");
  });
  it("keeps ordinary notes informational and preserves the draft on failure", async () => {
    const saveItem = vi.fn();
    const { fixture, app } = await setup({ addNote: async () => { throw new Error("Offline"); }, saveItem });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    panel.noteBody = "Information only";
    await panel.addNote();
    expect(panel.noteBody).toBe("Information only");
    expect(panel.notesError()).toBe("Offline");
    expect(saveItem).not.toHaveBeenCalled();
  });
  it("retains failed autosave edits and retries without posting a note", async () => {
    let attempts = 0;
    const addNote = vi.fn();
    const { fixture, app } = await setup({ addNote, saveItem: async (_project, draft) => {
      if (++attempts === 1) throw new Error("Save failed");
      return { ...item, ...draft };
    } });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    panel.draft.priority = "high";
    await panel.saveFields(["priority"]);
    expect(panel.saveError()).toBe("Save failed");
    expect(panel.draft.priority).toBe("high");
    panel.retrySave();
    await fixture.whenStable();
    expect(panel.saveError()).toBe("");
    expect(app.store.items()[0].priority).toBe("high");
    expect(addNote).not.toHaveBeenCalled();
  });
  it("uses the shared composer for work, retains failed requests, and keeps normal notes separate", async () => {
    const run: CodexRun = { id: "run1", status: "review", cwd: "C:/project", thread_id: "thread1", summary: "", pending: [] };
    let fail = true;
    const requests: string[] = [];
    const client: CodexClient = {
      config: async () => ({ cwd: "C:/project" }), configure: async () => ({ cwd: "C:/project" }),
      state: async () => run,
      start: async (id, body) => { expect(id).toBe(item.id); if (fail) throw new Error("Start failed"); requests.push(body ?? ""); return { ...run, status: "running" }; },
      reply: async () => run, stop: async () => run,
    };
    const { fixture, app } = await setup({ addNote: async (item_id, body) => ({ id: "info", item_id, body, author: "user", created_at: "" }) }, client);
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel)).componentInstance as ItemPanel;
    panel.noteBody = "Information only";
    await panel.addNote();
    expect(requests).toEqual([]);
    panel.noteBody = "Please continue";
    await panel.requestWork();
    expect(panel.noteBody).toBe("Please continue");
    expect(panel.codexPanel()?.error()).toBe("Start failed");
    fail = false;
    await panel.requestWork();
    expect(requests).toEqual(["Please continue"]);
    expect(panel.noteBody).toBe("");
    expect(panel.codexPanel()?.active()).toBe(true);
  });
  it("does not add a note while the initial notes request is pending", async () => {
    let resolve!: (notes: []) => void;
    let calls = 0;
    const { fixture, app } = await setup({
      notes: () => new Promise((r) => (resolve = r)),
      addNote: async () => {
        calls++;
        return { id: "n1", item_id: "i1", body: "Note", created_at: "" };
      },
    });
    app.openItem(item);
    await fixture.whenStable();
    const panel = fixture.debugElement.query(By.directive(ItemPanel))
      .componentInstance as ItemPanel;
    panel.noteBody = "Note";
    await panel.addNote();
    expect(calls).toBe(0);
    resolve([]);
    await fixture.whenStable();
  });
});
