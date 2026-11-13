import { describe, expect, it, vi } from "vitest";
import { Auth } from "./auth";
import { SupabaseClient } from "@supabase/supabase-js";
import { AuthStorage } from "./auth-storage";
describe("email authentication lifecycle", () => {
  function setup(storage?: AuthStorage) {
    let event!: (name: string, session: unknown) => void;
    const api = {
      onAuthStateChange: vi.fn((handler) => {
        event = handler;
      }),
      getSession: vi.fn(async () => ({ data: { session: null as { user: { id: string }; access_token: string } | null }, error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    };
    const auth = new Auth({ auth: api } as unknown as SupabaseClient, storage);
    return {
      auth,
      api,
      event: (name: string, session: unknown) => event(name, session),
    };
  }
  it("selects remember mode before sign-in and clears the override on success or failure", async () => {
    const storage = { setRemember: vi.fn() } as unknown as AuthStorage;
    const { auth, api } = setup(storage);
    api.signInWithPassword.mockImplementation(async () => {
      expect(storage.setRemember).toHaveBeenLastCalledWith(true);
      return { error: null };
    });
    await auth.signIn("user@example.com", "password", true);
    expect(storage.setRemember).toHaveBeenLastCalledWith(undefined);
    api.signInWithPassword.mockImplementation(async () => {
      expect(storage.setRemember).toHaveBeenLastCalledWith(false);
      throw new Error("Invalid credentials");
    });
    await expect(auth.signIn("user@example.com", "wrong")).rejects.toThrow("Invalid credentials");
    expect(storage.setRemember).toHaveBeenLastCalledWith(undefined);
  });
  it("ignores another tab's login when this tab has no stored credentials", async () => {
    vi.useFakeTimers();
    try {
      const storage = { setRemember: vi.fn() } as unknown as AuthStorage;
      const { auth, event } = setup(storage);
      await Promise.resolve();
      event("SIGNED_IN", { user: { id: "another-tab" }, access_token: "other-token" });
      await vi.runAllTimersAsync();
      expect(auth.user()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses its own session on cross-tab events and only opens its own recovery flow", async () => {
    vi.useFakeTimers();
    try {
      const storage = { setRemember: vi.fn() } as unknown as AuthStorage;
      const { auth, api, event } = setup(storage);
      api.getSession.mockResolvedValue({ data: { session: { user: { id: "this-tab" }, access_token: "own-token" } }, error: null });
      event("PASSWORD_RECOVERY", { user: { id: "another-tab" }, access_token: "other-token" });
      await vi.runAllTimersAsync();
      expect(auth.user()?.id).toBe("this-tab");
      expect(auth.recovery()).toBe(false);
      event("PASSWORD_RECOVERY", { user: { id: "this-tab" }, access_token: "own-token" });
      await vi.runAllTimersAsync();
      expect(auth.recovery()).toBe(true);
      api.getSession.mockResolvedValue({ data: { session: null }, error: null });
      event("SIGNED_OUT", null);
      await vi.runAllTimersAsync();
      expect(auth.user()).toBeNull();
      expect(auth.recovery()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("opens recovery form for a recovery session and clears it after password update", async () => {
    const { auth, event, api } = setup();
    await Promise.resolve();
    event("PASSWORD_RECOVERY", { user: { id: "u1" } });
    expect(auth.recovery()).toBe(true);
    expect(auth.user()?.id).toBe("u1");
    await auth.updatePassword("A new password");
    expect(api.updateUser).toHaveBeenCalledWith({ password: "A new password" });
    expect(auth.recovery()).toBe(false);
  });
  it("keeps unconfirmed signups signed out", async () => {
    const { auth } = setup();
    expect(
      await auth.signUp("qa@example.invalid", "Strong test password"),
    ).toBe(false);
    expect(auth.user()).toBeNull();
  });
  it("continues to reject short passwords for new accounts", async () => {
    const { auth, api } = setup();
    await expect(auth.signUp("someone@example.com", "dev")).rejects.toThrow(
      "8 characters",
    );
    expect(api.signUp).not.toHaveBeenCalled();
  });
  it("removes user state on sign out event", async () => {
    const { auth, event } = setup();
    await Promise.resolve();
    event("SIGNED_IN", { user: { id: "u1" } });
    event("SIGNED_OUT", null);
    expect(auth.user()).toBeNull();
    expect(auth.recovery()).toBe(false);
  });
});
