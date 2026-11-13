import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store";
import { Repository } from "./repository";
import { Item, Project } from "./models";
const project = {
  id: "p1",
  name: "DevPilot",
  owner_id: "u1",
  created_at: "",
} satisfies Project;
const idea = {
  id: "i1",
  project_id: "p1",
  title: "Initial idea",
  description: "",
  type: "idea",
  priority: "medium",
  status: "ideas",
  archived_at: null,
  created_at: "",
  updated_at: "",
} satisfies Item;
function repository(): Repository {
  let items: Item[] = [];
  return {
    projects: async () => [project],
    createProject: async (name) => ({ ...project, name }),
    renameProject: async (id, name) => ({ ...project, id, name }),
    deleteProject: async () => {},
    items: async () => items.map((i) => ({ ...i })),
    saveItem: async (projectId, draft, id) => {
      const item = { ...idea, ...draft, id: id ?? "i1", project_id: projectId };
      items = [item];
      return item;
    },
    archiveItem: async (id, archived) => {
      items = items.map((i) =>
        i.id === id ? { ...i, archived_at: archived ? "today" : null } : i,
      );
      return items[0];
    },
    notes: async () => [],
    editNote: async () => { throw new Error("Not used"); },
    deleteNote: async () => {},
    addNote: async (item_id, body) => ({
      id: "n1",
      item_id,
      body,
      created_at: "",
    }),
  };
}
describe("workspace persistence flow", () => {
  it("defers a push refresh during a save and preserves errors on background failure", async () => {
    const repo = repository();
    const store = new WorkspaceStore(repo);
    await store.load("u1");
    let finish!: (item: Item) => void;
    repo.saveItem = () => new Promise(resolve => { finish = resolve; });
    repo.items = async () => [idea, { ...idea, id: "external", title: "External create" }];
    const save = store.saveItem(idea);
    await store.refreshItems(true);
    finish(idea);
    await save;
    await Promise.resolve();
    expect(store.items()).toHaveLength(2);
    store.error.set("Existing actionable error");
    repo.items = async () => { throw new Error("Offline"); };
    await store.refreshItems(true);
    expect(store.items()).toHaveLength(2);
    expect(store.error()).toBe("Existing actionable error");
  });
  it("keeps the newest result when refresh requests finish out of order", async () => {
    const repo = repository();
    const store = new WorkspaceStore(repo);
    await store.load("u1");
    const pending: Array<(items: Item[]) => void> = [];
    repo.items = () => new Promise((resolve) => pending.push(resolve));
    const old = store.refreshItems();
    const newer = store.refreshItems();
    pending[1]([{ ...idea, title: "Newer external change" }]);
    await newer;
    pending[0]([idea]);
    await old;
    expect(store.items()[0].title).toBe("Newer external change");
  });
  it("refreshes externally edited items without discarding persisted state on failure", async () => {
    const repo = repository();
    const store = new WorkspaceStore(repo);
    await store.load("u1");
    await store.saveItem(idea);
    repo.items = async () => [{ ...idea, title: "Changed by Codex" }];
    await store.refreshItems();
    expect(store.items()[0].title).toBe("Changed by Codex");
    repo.items = async () => {
      throw new Error("Offline");
    };
    await store.refreshItems();
    expect(store.items()[0].title).toBe("Changed by Codex");
    expect(store.error()).toBe("Offline");
  });
  it("does not let a late refresh overwrite a newer item mutation", async () => {
    const repo = repository();
    const store = new WorkspaceStore(repo);
    await store.load("u1");
    await store.saveItem(idea);
    let resolve!: (items: Item[]) => void;
    repo.items = () => new Promise((r) => (resolve = r));
    const refresh = store.refreshItems();
    await store.saveItem({ ...idea, title: "Newer change" }, idea.id);
    resolve([idea]);
    await refresh;
    expect(store.items()[0].title).toBe("Newer change");
  });
  it("creates a project, adds an idea, edits it, changes status and archives it", async () => {
    const store = new WorkspaceStore(repository());
    await store.load("u1");
    await store.createProject("New project");
    await store.saveItem(idea);
    expect(store.items()[0].title).toBe("Initial idea");
    await store.saveItem(
      { ...idea, title: "Refined idea", status: "testing" },
      "i1",
    );
    expect(store.items()[0]).toMatchObject({
      title: "Refined idea",
      status: "testing",
    });
    await store.archiveItem("i1", true);
    expect(store.items()[0].archived_at).toBeTruthy();
    await store.archiveItem("i1", false);
    expect(store.items()[0].archived_at).toBeNull();
  });
  it("retains persisted state when a save is rejected", async () => {
    const repo = repository();
    const store = new WorkspaceStore(repo);
    await store.load("u1");
    await store.saveItem(idea);
    repo.saveItem = async () => {
      throw new Error("Network unavailable");
    };
    await expect(
      store.saveItem({ ...idea, title: "Unsaved" }, "i1"),
    ).rejects.toThrow("Network unavailable");
    expect(store.items()[0].title).toBe("Initial idea");
    expect(store.busy()).toBe(false);
  });
  it("ignores a late item response from the previous project", async () => {
    const repo = repository();
    let resolve!: (value: Item[]) => void;
    repo.items = async (id) =>
      id === "slow"
        ? new Promise((r) => (resolve = r))
        : [{ ...idea, project_id: id }];
    const store = new WorkspaceStore(repo);
    const slow = store.selectProject("slow");
    await store.selectProject("fast");
    resolve([{ ...idea, project_id: "slow" }]);
    await slow;
    expect(store.items()[0].project_id).toBe("fast");
  });
  it("clears private data and ignores pending work after sign out", async () => {
    const repo = repository();
    let resolve!: (value: Project[]) => void;
    repo.projects = () => new Promise((r) => (resolve = r));
    const store = new WorkspaceStore(repo);
    const loading = store.load("u1");
    store.reset();
    resolve([project]);
    await loading;
    expect(store.projects()).toEqual([]);
    expect(store.items()).toEqual([]);
  });
});
