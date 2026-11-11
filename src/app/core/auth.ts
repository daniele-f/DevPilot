import { InjectionToken, signal } from "@angular/core";
import { SupabaseClient, User } from "@supabase/supabase-js";
export const AUTH = new InjectionToken<Auth>("Supabase auth");
export class Auth {
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);
  readonly recovery = signal(false);
  readonly error = signal("");
  constructor(readonly client: SupabaseClient) {
    client.auth.onAuthStateChange((event, session) => {
      this.user.set(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") this.recovery.set(true);
      if (event === "SIGNED_OUT") this.recovery.set(false);
      this.ready.set(true);
    });
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) this.error.set(error.message);
        this.user.set(data.session?.user ?? null);
        this.ready.set(true);
      })
      .catch(() => {
        this.error.set("Could not restore your session. Please sign in again.");
        this.ready.set(true);
      });
  }
  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }
  async signUp(email: string, password: string): Promise<boolean> {
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
