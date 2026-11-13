import { afterEach, describe, expect, it, vi } from "vitest";
import { startLiveBoard } from "./live-board";

afterEach(() => vi.useRealTimers());

describe("live board synchronization", () => {
  it("uses a slow disconnected fallback and stops on cleanup", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const stop = startLiveBoard(refresh);
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on focus, avoids overlapping requests and recovers after failure", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const stop = startLiveBoard(refresh);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    refresh.mockRejectedValueOnce(new Error("Offline"));
    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("refreshes on push events with no healthy polling and unsubscribes", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const unsubscribe = vi.fn();
    let changed!: () => void;
    let connection!: (ready: boolean) => void;
    const stop = startLiveBoard(refresh, (notify, connected) => {
      changed = notify;
      connection = connected;
      connected(true);
      return unsubscribe;
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith(true);
    changed();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(false);
    connection(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledTimes(3);
    connection(true);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(refresh).toHaveBeenLastCalledWith(true);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("coalesces events during a read and catches up after a hidden tab resumes", async () => {
    vi.useFakeTimers();
    let changed!: () => void;
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const stop = startLiveBoard(refresh, notify => { changed = notify; return () => {}; });
    changed();
    changed();
    changed();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
    release();
    await Promise.resolve();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    changed();
    await vi.advanceTimersByTimeAsync(60000);
    expect(refresh).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    release();
    visibility.mockRestore();
  });
});
