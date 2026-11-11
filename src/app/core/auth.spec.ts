import { describe, expect, it, vi } from "vitest";
import { Auth } from "./auth";
import { SupabaseClient } from "@supabase/supabase-js";
describe("email authentication lifecycle", () => {
  function setup() {
    let event!: (name: string, session: unknown) => void;
    const api = {
      onAuthStateChange: vi.fn((handler) => {
        event = handler;
      }),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    };
    const auth = new Auth({ auth: api } as unknown as SupabaseClient);
    return {
      auth,
      api,
      event: (name: string, session: unknown) => event(name, session),
    };
  }
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
