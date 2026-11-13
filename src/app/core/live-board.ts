/** Push invalidation with a disconnected fallback, without touching editor drafts. */
export function startLiveBoard(
  refresh: (reconcile?: boolean) => Promise<void>,
  subscribe?: (changed: () => void, connected: (ready: boolean) => void) => () => void,
): () => void {
  let stopped = false;
  let pending = false;
  let dirty = false;
  let reconcilePending = false;
  let connected = false;
  const tick = async (reconcile = false) => {
    reconcilePending ||= reconcile;
    if (stopped || document.visibilityState === "hidden") return;
    if (pending) { dirty = true; return; }
    pending = true;
    const reconcileNow = reconcilePending;
    reconcilePending = false;
    try {
      await refresh(reconcileNow);
    } catch {
      // A temporary connection failure must not stop subsequent synchronization.
    } finally {
      pending = false;
      if (dirty && !stopped) { dirty = false; void tick(); }
    }
  };
  const resume = () => void tick(true);
  const unsubscribe = subscribe?.(() => void tick(), ready => {
    const reconnected = ready && !connected;
    connected = ready;
    if (reconnected) void tick(true);
  });
  const timer = setInterval(() => { if (!connected) void tick(true); }, 30000);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    stopped = true;
    unsubscribe?.();
    clearInterval(timer);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
