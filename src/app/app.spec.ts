import { afterEach, describe, expect, it } from "vitest";
import { provideZonelessChangeDetection, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { App } from "./app";
import { AUTH } from "./core/auth";
import { REPOSITORY, Repository } from "./core/repository";
import { Item } from "./core/models";
import { ItemPanel } from "./ui/item-panel";
import { By } from "@angular/platform-browser";
import { InteractivityChecker } from "@angular/cdk/a11y";

afterEach(() => TestBed.resetTestingModule());
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
async function setup(overrides: Partial<Repository> = {}) {
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
