type LoginStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function availableStorage(resolve: () => LoginStorage): LoginStorage {
  try {
    const storage = resolve();
    const probe = `devpilot-auth-probe-${Math.random()}`;
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    // Match Supabase's in-memory fallback when browser storage is unavailable.
    const values = new Map<string, string>();
    return {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    };
  }
}

export function createAuthStorage(
  persistent: () => LoginStorage = () => localStorage,
  temporary: () => LoginStorage = () => sessionStorage,
): AuthStorage {
  return new AuthStorage(availableStorage(persistent), availableStorage(temporary));
}

/** Supabase uses this adapter for both initial tokens and refreshed sessions. */
export class AuthStorage {
  private remember: boolean | undefined;

  constructor(
    private readonly persistent: LoginStorage,
    private readonly temporary: LoginStorage,
  ) {}

  // Override only while signing in; afterwards the token's location preserves
  // the choice across reloads and refreshes, including older persistent logins.
  setRemember(remember: boolean | undefined): void {
    this.remember = remember;
  }

  getItem(key: string): string | null {
    return this.temporary.getItem(key) ?? this.persistent.getItem(key);
  }

  setItem(key: string, value: string): void {
    const remember = this.remember ?? (this.persistent.getItem(key) !== null);
    const target = remember ? this.persistent : this.temporary;
    const other = remember ? this.temporary : this.persistent;
    other.removeItem(key);
    target.setItem(key, value);
  }

  removeItem(key: string): void {
    try {
      this.persistent.removeItem(key);
    } finally {
      this.temporary.removeItem(key);
    }
  }
}
