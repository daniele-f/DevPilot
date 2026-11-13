import { describe, expect, it, vi } from "vitest";
import { LocalApi, LocalAuth, LocalRepository } from "./local";
describe("local SQLite client", () => {
  it("calls browser fetch without binding it to the API client", async () => {
    vi.stubGlobal("fetch", function (this: unknown) {
      if (this && this !== globalThis) throw new Error("Illegal invocation");
      return Promise.resolve(new Response("null"));
    });
    try {
      await expect(new LocalApi().call("/auth/session")).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("restores a server session and signs out through the local API", async () => {
    const calls: string[] = [];
    const api = new LocalApi(async (input, options) => {
      calls.push(String(input));
      expect(options?.credentials).toBe("same-origin");
      return new Response(
        JSON.stringify(
          String(input).endsWith("logout")
            ? null
            : { id: "local-dev", email: "dev" },
        ),
      );
    });
    const auth = new LocalAuth(api);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auth.ready()).toBe(true);
    expect(auth.user()?.id).toBe("local-dev");
    await auth.signOut();
    expect(auth.user()).toBeNull();
    expect(calls).toEqual(["/api/auth/session", "/api/auth/logout"]);
  });
  it("sends the exact dev credentials to the local endpoint", async () => {
    let loginBody = "";
    const api = new LocalApi(async (input, options) => {
      if (String(input).endsWith("/login")) loginBody = String(options?.body);
      return new Response(
        JSON.stringify(
          String(input).endsWith("/session")
            ? null
            : { id: "local-dev", email: "dev" },
        ),
      );
    });
    const auth = new LocalAuth(api);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await auth.signIn("dev", "dev");
    expect(JSON.parse(loginBody)).toEqual({ username: "dev", password: "dev", remember: false });
    await auth.signIn("dev", "dev", true);
    expect(JSON.parse(loginBody)).toEqual({ username: "dev", password: "dev", remember: true });
    expect(auth.user()?.id).toBe("local-dev");
  });
  it("propagates database failures instead of presenting an unsaved project", async () => {
    const api = new LocalApi(
      async () =>
        new Response(JSON.stringify({ message: "Disk is full" }), {
          status: 500,
        }),
    );
    await expect(
      new LocalRepository(api).createProject("Unsaved", "local-dev"),
    ).rejects.toThrow("Disk is full");
  });
});
