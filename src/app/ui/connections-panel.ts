import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { A11yModule } from "@angular/cdk/a11y";
import {
  AI_CONNECTIONS,
  AiConnection,
} from "../core/connections";
import { Project } from "../core/models";
import { message } from "../core/store";
import { Icon } from "./icon";
import { CodexConnectionSetup } from './codex-connection-setup';

@Component({
  selector: "dp-connections",
  imports: [DatePipe, A11yModule, Icon, CodexConnectionSetup],
  template: `
    <div class="sheet-backdrop" (click)="!busy() && closed.emit()"></div>
    <section
      class="item-sheet connections-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connections-heading"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      (keydown.escape)="!busy() && closed.emit()"
    >
      <header class="sheet-header">
        <span class="eyebrow" id="connections-heading">CONNECT AI</span
        ><button
          type="button"
          class="icon-button"
          aria-label="Close connections"
          (click)="closed.emit()"
          [disabled]="busy()"
        >
          <dp-icon name="close" />
        </button>
      </header>
      <div class="sheet-scroll">
        <div class="connection-intro">
          <span class="connection-logo"><dp-icon name="link" /></span>
          <h2>Bring Codex into the loop.</h2>
          <p>
            Give Codex access to <strong>{{ project().name }}</strong
            >. Choose this project when you authorize the connection.
          </p>
          <span class="connection-local-label"
            >Local development · Codex on this computer</span
          >
        </div>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <dp-codex-connection-setup [project]="project()" />
          <section class="connection-setup">
            <h3>Connect with browser authentication</h3>
            <p>Add DevPilot once in Codex, then sign in and authorize access.</p>
            <ol>
              <li>Keep DevPilot running with <code>start-dev.bat</code>.</li>
              <li>
                In Codex, open <strong>Settings → MCP servers → Add server</strong>.
                Choose Streamable HTTP, name it DevPilot, and paste the URL below.
                Leave token and header fields empty.
              </li>
              <li>
                Save the server and click <strong>Authenticate</strong>.
                In the browser, sign in, select <strong>{{ project().name }}</strong>,
                choose read-only or edit access, and authorize the connection.
              </li>
            </ol>
            <label for="codex-server-url">MCP server URL</label
            ><input
              id="codex-server-url"
              readonly
              [value]="serverUrl()"
              spellcheck="false"
            />
            <button class="primary" type="button" (click)="copyUrl()" [disabled]="!serverUrl()" cdkFocusInitial>
              <dp-icon name="check" />{{
                copied() ? "Copied" : "Copy server URL"
              }}
            </button>
            <p class="muted">
              Start a new Codex chat after connecting. Ask it to show this project's backlog.
              Refresh the connections below to see the authorized grant. Existing token
              connections keep working; remove old headers in Codex to switch to OAuth.
            </p>
          </section>
        <section class="connection-list">
          <header>
            <h3>Project connections</h3>
            <button
              type="button"
              class="icon-button"
              aria-label="Refresh connections"
              (click)="load()"
              [disabled]="loading() || busy()"
            >
              <dp-icon name="refresh" />
            </button>
          </header>
          @if (loading()) {
            <p class="muted" role="status">Loading connections…</p>
          }
          @for (connection of connections(); track connection.id) {
            <article class="connection-row">
              <div>
                <strong>{{ connection.name }}</strong
                ><span
                  >{{
                    connection.permission === "edit"
                      ? "Read and edit"
                      : "Read only"
                  }}
                  ·
                  {{
                    connection.revoked_at
                      ? "Revoked"
                      : connection.last_used_at
                        ? "Used"
                        : "Not used yet"
                  }}</span
                >
                @if (connection.last_used_at) {
                  <small
                    >Last request
                    {{ connection.last_used_at | date: "medium" }}</small
                  >
                }
              </div>
              @if (!connection.revoked_at) {
                <button
                  class="text-button revoke-button"
                  type="button"
                  (click)="revoke(connection.id)"
                  [disabled]="busy()"
                >
                  Revoke
                </button>
              }
            </article>
          }
          @if (!loading() && connections().length === 0) {
            <p class="muted">No connections yet.</p>
          }
        </section>
      </div>
      <footer class="sheet-footer">
        <span class="muted connection-footnote"
          >A connection is used only after Codex contacts it.</span
        ><button
          class="secondary"
          type="button"
          (click)="closed.emit()"
          [disabled]="busy()"
        >
          Done
        </button>
      </footer>
    </section>
  `,
  styles: [
    `
      .connection-intro {
        margin-bottom: 28px;
      }
      .connection-logo {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        background: var(--raised);
        border: 1px solid var(--border);
        border-radius: 10px;
        color: var(--accent);
        margin-bottom: 21px;
      }
      .connection-intro h2 {
        font-size: 26px;
        margin-bottom: 12px;
      }
      .connection-intro p {
        font-size: 15px;
        line-height: 1.8;
        overflow-wrap: anywhere;
      }
      .connection-intro strong {
        color: var(--text);
        font-weight: 500;
      }
      .connection-local-label {
        display: inline-block;
        margin-top: 15px;
        font-size: 13px;
        color: var(--accent);
      }
      .connection-form {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .connection-form p {
        font-size: 14px;
        line-height: 1.8;
      }
      .connection-form > .primary {
        align-self: flex-start;
      }
      .connection-list {
        border-top: 1px solid var(--border);
        margin-top: 32px;
        padding-top: 22px;
      }
      .connection-list > header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
      }
      .connection-list h3,
      .connection-setup h3 {
        font-size: 16px;
        letter-spacing: 0;
      }
      .connection-list > p {
        font-size: 15px;
      }
      .connection-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 16px 0;
        border-bottom: 1px solid var(--border);
      }
      .connection-row strong {
        font-size: 15px;
        font-weight: 550;
        overflow-wrap: anywhere;
        display: block;
      }
      .connection-row span {
        font-size: 13px;
        color: var(--muted);
        display: block;
        margin-top: 5px;
      }
      .connection-row small {
        font-size: 12px;
        color: var(--dim);
        display: block;
        margin-top: 3px;
      }
      .revoke-button {
        font-size: 14px;
        color: var(--error);
      }
      .connection-setup {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 9px;
        padding: 20px;
      }
      .connection-setup > p {
        font-size: 14px;
        line-height: 1.8;
        margin-top: 11px;
      }
      .connection-setup ol {
        font-size: 14px;
        color: var(--muted);
        padding-left: 18px;
        line-height: 1.9;
        margin: 20px 0;
      }
      .connection-setup li {
        margin-bottom: 8px;
      }
      .connection-setup label {
        font-size: 13px;
        margin-bottom: 9px;
      }
      .connection-setup textarea {
        font:
          10px/1.7 Consolas,
          monospace;
        white-space: pre;
        overflow-x: auto;
        resize: none;
      }
      .connection-setup > .primary {
        margin-top: 12px;
        font-size: 14px;
      }
      .connection-footnote {
        font-size: 13px;
        max-width: 260px;
        line-height: 1.7;
      }
      .sheet-scroll > .error {
        margin-bottom: 18px;
      }
    `,
  ],
})
export class ConnectionsPanel implements OnInit, OnChanges {
  readonly project = input.required<Project>();
  readonly refreshVersion = input(0);
  readonly closed = output<void>();
  private readonly client = inject(AI_CONNECTIONS);
  readonly connections = signal<AiConnection[]>([]);
  readonly serverUrl = signal("");
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly copied = signal(false);
  private initialized = false;
  private destroyed = false;
  private request = 0;
  constructor() { inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.request++; }); }
  ngOnInit(): void {
    this.initialized = true;
    void this.load();
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes["refreshVersion"]) void this.load(true);
  }
  async load(background = false): Promise<void> {
    const request = ++this.request;
    if (!background) { this.loading.set(true); this.error.set(""); }
    try {
      const [connections, url] = await Promise.all([
        this.client.list(this.project().id), this.client.serverUrl(),
      ]);
      if (this.destroyed || request !== this.request) return;
      this.connections.set(connections);
      this.serverUrl.set(url);
    } catch (e) {
      if (!this.destroyed && request === this.request && !background) this.error.set(message(e));
    } finally {
      if (!this.destroyed && request === this.request) this.loading.set(false);
    }
  }
  async revoke(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.client.revoke(this.project().id, id);
      await this.load();
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }
  async copyUrl(): Promise<void> {
    const value = this.serverUrl();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
    } catch {
      this.error.set(
        "Clipboard access was unavailable. Select the server URL and copy it manually.",
      );
    }
  }
}
