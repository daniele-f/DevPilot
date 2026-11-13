import { describe, expect, it, vi } from "vitest";
import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./repository";

describe("hosted board subscription", () => {
  it("filters to the project, refreshes on reconnect and removes the channel", () => {
    let notify!: () => void;
    let status!: (value: string) => void;
    const channel = {
      on: vi.fn((_event, _filter, callback) => { notify = callback; return channel; }),
      subscribe: vi.fn(callback => { status = callback; return channel; }),
    };
    const db = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => "ok") };
    const repo = new SupabaseRepository(db as unknown as SupabaseClient);
    const changed = vi.fn();
    const connected = vi.fn();
    const stop = repo.watchItems("p1", changed, connected);
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", {
      event: "UPDATE", schema: "public", table: "items", filter: "project_id=eq.p1",
    }, expect.any(Function));
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", {
      event: "INSERT", schema: "public", table: "items", filter: "project_id=eq.p1",
    }, expect.any(Function));
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", {
      event: "DELETE", schema: "public", table: "items",
    }, expect.any(Function));
    status("SUBSCRIBED");
    expect(connected).toHaveBeenLastCalledWith(true);
    notify();
    expect(changed).toHaveBeenCalledTimes(2);
    status("CHANNEL_ERROR");
    expect(connected).toHaveBeenLastCalledWith(false);
    stop();
    expect(db.removeChannel).toHaveBeenCalledWith(channel);
  });
});
