import { describe, expect, it } from "vitest";
import { AuthStorage, createAuthStorage } from "./auth-storage";

describe("login persistence storage", () => {
  const key = "sb-project-auth-token";
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value); },
      removeItem: (name: string) => { values.delete(name); },
    };
  }
  function setup() {
    const persistent = storage();
    const temporary = storage();
    return { persistent, temporary, auth: new AuthStorage(persistent, temporary) };
  }
  it("defaults new sessions to temporary storage and restores them after reload", () => {
    const { persistent, temporary, auth } = setup();
    auth.setItem(key, "session");
    expect(persistent.getItem(key)).toBeNull();
    expect(new AuthStorage(persistent, temporary).getItem(key)).toBe("session");
    expect(new AuthStorage(persistent, storage()).getItem(key)).toBeNull();
  });
  it("keeps remembered and legacy persistent sessions persistent after refresh", () => {
    const { persistent, temporary, auth } = setup();
    auth.setRemember(true);
    auth.setItem(key, "session");
    auth.setRemember(undefined);
    const restored = new AuthStorage(persistent, temporary);
    expect(restored.getItem(key)).toBe("session");
    restored.setItem(key, "refreshed");
    expect(persistent.getItem(key)).toBe("refreshed");
    expect(temporary.getItem(key)).toBeNull();
    expect(new AuthStorage(persistent, storage()).getItem(key)).toBe("refreshed");
  });
  it("removes alternate copies when switching modes, then preserves the mode on refresh", () => {
    const { persistent, temporary, auth } = setup();
    persistent.setItem(key, "old-persistent");
    auth.setRemember(false);
    auth.setItem(key, "temporary");
    auth.setRemember(undefined);
    expect(persistent.getItem(key)).toBeNull();
    const restored = new AuthStorage(persistent, temporary);
    restored.setItem(key, "refreshed-temporary");
    expect(temporary.getItem(key)).toBe("refreshed-temporary");
    expect(persistent.getItem(key)).toBeNull();
    restored.setRemember(true);
    restored.setItem(key, "remembered");
    expect(persistent.getItem(key)).toBe("remembered");
    expect(temporary.getItem(key)).toBeNull();
  });
  it("removes both copies on logout without touching unrelated data", () => {
    const { persistent, temporary, auth } = setup();
    persistent.setItem(key, "old");
    temporary.setItem(key, "current");
    persistent.setItem("other", "keep");
    expect(auth.getItem(key)).toBe("current");
    auth.removeItem(key);
    expect(auth.getItem(key)).toBeNull();
    expect(persistent.getItem("other")).toBe("keep");
  });
  it("keeps temporary login usable when persistent storage is blocked", () => {
    const temporary = storage();
    const auth = createAuthStorage(() => { throw new Error("Storage blocked"); }, () => temporary);
    auth.setRemember(false);
    auth.setItem(key, "session");
    expect(temporary.getItem(key)).toBe("session");
    auth.removeItem(key);
    expect(auth.getItem(key)).toBeNull();
  });
  it("falls back to memory when storage getters or writes fail", () => {
    const denied = { ...storage(), setItem: () => { throw new Error("Quota exceeded"); } };
    const auth = createAuthStorage(() => denied, () => { throw new Error("Storage blocked"); });
    auth.setRemember(true);
    auth.setItem(key, "session");
    expect(auth.getItem(key)).toBe("session");
    auth.removeItem(key);
    expect(auth.getItem(key)).toBeNull();
  });
});
