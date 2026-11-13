import { InjectionToken, Signal, signal } from "@angular/core";
import { SupabaseClient, User } from "@supabase/supabase-js";
import { AuthStorage } from "./auth-storage";
export interface Account {
  id: string;
  email?: string;
}
export interface AccountAuth {
  readonly local: boolean;
  readonly user: Signal<Account | null>;
  readonly ready: Signal<boolean>;
  readonly recovery: Signal<boolean>;
  signIn(email: string, password: string, remember?: boolean): Promise<void>;
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
}
export const AUTH = new InjectionToken<AccountAuth>("DevPilot auth");
export class Auth implements AccountAuth {
  readonly local = false;
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);
  readonly recovery = signal(false);
  readonly error = signal("");
  constructor(readonly client: SupabaseClient, private readonly storage?: AuthStorage) {
    client.auth.onAuthStateChange((event, session) => {
      if (storage) {
        // Broadcast events may belong to a different tab's temporary login.
        // Read this tab's credentials outside the SDK callback's auth lock.
        setTimeout(() => {
          void this.restoreSession(event === "PASSWORD_RECOVERY" ? session?.access_token : undefined);
        }, 0);
        return;
      }
      this.user.set(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") this.recovery.set(true);
      if (event === "SIGNED_OUT") this.recovery.set(false);
      this.ready.set(true);
    });
    void this.restoreSession();
  }
  private async restoreSession(recoveryToken?: string): Promise<void> {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) this.error.set(error.message);
      this.user.set(data.session?.user ?? null);
      if (!data.session) this.recovery.set(false);
      else if (recoveryToken && data.session.access_token === recoveryToken)
        this.recovery.set(true);
    } catch {
      this.user.set(null);
      this.error.set("Could not restore your session. Please sign in again.");
    } finally {
      this.ready.set(true);
    }
  }
  async signIn(email: string, password: string, remember = false): Promise<void> {
    // Let initial recovery/refresh finish before choosing where new tokens go.
    await this.client.auth.getSession();
    this.storage?.setRemember(remember);
    try {
      const { error } = await this.client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } finally {
      this.storage?.setRemember(undefined);
    }
  }
  async signUp(email: string, password: string): Promise<boolean> {
    if (password.length < 8)
      throw new Error("Use a password of at least 8 characters.");
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin },
    });
    if (error) throw error;
    return Boolean(data.session);
  }
  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }
  async resetPassword(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin,
    });
    if (error) throw error;
  }
  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
    this.recovery.set(false);
  }
}
