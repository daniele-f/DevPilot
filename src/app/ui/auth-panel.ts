import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AUTH } from "../core/auth";
import { message } from "../core/store";
import { Icon } from "./icon";
@Component({
  selector: "dp-auth",
  imports: [FormsModule, Icon],
  template: `
    <div class="auth-layout">
      <section class="auth-story">
        <div class="brand">
          <span class="brand-mark">➤</span> DevPilot<span class="version"
            >v0.1</span
          >
        </div>
        <div class="story-content">
          <span class="eyebrow">LESS OVERHEAD. MORE BUILDING.</span>
          <h1>Your next idea,<br /><em>in motion.</em></h1>
          <p>
            A clear place for the ideas, bugs, and small steps that move your
            software forward.
          </p>
          <div class="flow-preview" aria-hidden="true">
            <span>01 / CAPTURE</span>
            <div class="preview-card">
              <i class="status-dot"></i> The next great idea
              <dp-icon name="arrow" />
            </div>
            <span>02 / BUILD</span>
            <div class="preview-card offset">
              <i class="status-dot amber"></i> Make it happen
              <span class="mini-tag">In progress</span>
            </div>
            <span>03 / SHIP</span>
            <div class="preview-card">
              <i class="status-dot green"></i> Something worth shipping
              <dp-icon name="check" />
            </div>
          </div>
        </div>
        <footer>A little structure. A lot of possibility.</footer>
      </section>
      <section class="auth-form-wrap">
        <form class="auth-form" (ngSubmit)="submit()">
          <span class="eyebrow">YOUR DEVELOPMENT WORKSPACE</span>
          <h2>
            {{
              auth.recovery()
                ? "Choose a new password"
                : mode() === "signup"
                  ? "Start building."
                  : mode() === "reset"
                    ? "Reset your password"
                    : "Welcome back."
            }}
          </h2>
          <p>
            {{
              mode() === "signup"
                ? "Make room for your next project."
                : mode() === "reset"
                  ? "We’ll send you a link to get back in."
                  : "Pick up where your ideas left off."
            }}
          </p>
          @if (!auth.recovery()) {
            <label
              >Email<input
                type="email"
                name="email"
                autocomplete="email"
                [(ngModel)]="email"
                required
                placeholder="you@example.com"
                [disabled]="busy()"
            /></label>
          }
          @if (mode() !== "reset" || auth.recovery()) {
            <label
              >Password<input
                type="password"
                name="password"
                [autocomplete]="
                  mode() === 'signup' || auth.recovery()
                    ? 'new-password'
                    : 'current-password'
                "
                [(ngModel)]="password"
                required
                [minlength]="mode() === 'signup' || auth.recovery() ? 8 : 1"
                placeholder="Your password"
                [disabled]="busy()"
            /></label>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          @if (notice()) {
            <p class="notice" role="status">{{ notice() }}</p>
          }
          <button class="primary auth-submit" [disabled]="busy()">
            {{
              busy()
                ? "Please wait…"
                : auth.recovery()
                  ? "Update password"
                  : mode() === "signup"
                    ? "Create account"
                    : mode() === "reset"
                      ? "Send reset link"
                      : "Sign in"
            }}<dp-icon name="arrow" />
          </button>
          @if (!auth.recovery()) {
            <div class="auth-links">
              <button
                type="button"
                class="text-button"
                (click)="switchMode(mode() === 'signup' ? 'signin' : 'signup')"
              >
                {{
                  mode() === "signup"
                    ? "Already have an account? Sign in"
                    : "New here? Create an account"
                }}</button
              ><button
                type="button"
                class="text-button muted"
                (click)="switchMode(mode() === 'reset' ? 'signin' : 'reset')"
              >
                {{
                  mode() === "reset" ? "Back to sign in" : "Forgot password?"
                }}
              </button>
            </div>
          }
          <p class="auth-footnote">
            Your projects are private to your account.
          </p>
        </form>
      </section>
    </div>
  `,
})
export class AuthPanel {
  readonly auth = inject(AUTH);
  readonly mode = signal<"signin" | "signup" | "reset">("signin");
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  email = "";
  password = "";
  switchMode(mode: "signin" | "signup" | "reset"): void {
    this.mode.set(mode);
    this.error.set("");
    this.notice.set("");
    this.password = "";
  }
  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      if (this.auth.recovery()) await this.auth.updatePassword(this.password);
      else if (this.mode() === "signup") {
        const active = await this.auth.signUp(this.email.trim(), this.password);
        if (!active)
          this.notice.set(
            "Check your email to confirm your account, then sign in.",
          );
      } else if (this.mode() === "reset") {
        await this.auth.resetPassword(this.email.trim());
        this.notice.set("If an account exists, you’ll receive a reset link.");
      } else await this.auth.signIn(this.email.trim(), this.password);
      this.password = "";
    } catch (error) {
      this.error.set(message(error));
    } finally {
      this.busy.set(false);
    }
  }
}
