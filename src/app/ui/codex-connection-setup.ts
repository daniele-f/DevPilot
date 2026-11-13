import { Component, DestroyRef, OnChanges, SimpleChanges, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CODEX_RUNS } from '../core/codex-runs';
import { Project } from '../core/models';
import { message } from '../core/store';

@Component({
  selector: 'dp-codex-connection-setup',
  imports: [FormsModule],
  template: `
    @if (client) {
      <section class="local-codex-setup" aria-labelledby="local-codex-heading">
        <h3 id="local-codex-heading">Run Codex from DevPilot</h3>
        <p>Set up Codex for <strong>{{project().name}}</strong> here. Then use <strong>Work on this story</strong> on any card in this project.</p>
        <p class="muted">Codex uses its ChatGPT sign-in on this computer and can edit files in the project folder you choose.</p>
        @if (loading()) { <p class="muted" role="status">Loading local Codex connection…</p> }
        <label for="local-codex-folder">Local project folder</label>
        <input id="local-codex-folder" type="text" [(ngModel)]="cwd" placeholder="C:\\Projects\\my-project" [disabled]="loading() || saving()" spellcheck="false" />
        <p class="muted">Enter an absolute path on the computer running DevPilot. This setting applies to the whole project.</p>
        <button type="button" class="primary" (click)="save()" [disabled]="loading() || saving() || !cwd.trim()">{{saving() ? 'Saving…' : savedFolder() ? 'Update Codex connection' : 'Save Codex connection'}}</button>
        @if (savedFolder()) { <p class="muted" role="status">Local Codex configured for this project.</p> }
        @if (error()) { <p class="error" role="alert">{{error()}}</p> }
      </section>
    }
  `,
  styles: [`
    .local-codex-setup { display: grid; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 9px; padding: 20px; margin-bottom: 24px; }
    h3 { font-size: 16px; letter-spacing: 0; margin: 0; }
    p { font-size: 14px; line-height: 1.8; margin: 0; overflow-wrap: anywhere; }
    label { font-size: 13px; }
    button { justify-self: start; }
  `],
})
export class CodexConnectionSetup implements OnChanges {
  readonly project = input.required<Project>();
  readonly client = inject(CODEX_RUNS, { optional: true });
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly savedFolder = signal('');
  readonly error = signal('');
  cwd = '';
  private generation = 0;
  private destroyed = false;
  constructor() { inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.generation++; }); }
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['project'] || changes['project'].previousValue?.id === this.project().id) return;
    const generation = ++this.generation;
    this.cwd = ''; this.savedFolder.set(''); this.saving.set(false); this.error.set('');
    if (!this.client) return;
    this.loading.set(true);
    void this.client.config(this.project().id).then(config => {
      if (this.destroyed || generation !== this.generation) return;
      this.cwd = config.cwd; this.savedFolder.set(config.cwd);
    }).catch(e => {
      if (!this.destroyed && generation === this.generation) this.error.set(message(e));
    }).finally(() => {
      if (!this.destroyed && generation === this.generation) this.loading.set(false);
    });
  }
  async save(): Promise<void> {
    if (!this.client || this.loading() || this.saving() || !this.cwd.trim()) return;
    const generation = this.generation;
    const projectId = this.project().id;
    this.saving.set(true); this.error.set('');
    try {
      const config = await this.client.configure(projectId, this.cwd);
      if (this.destroyed || generation !== this.generation) return;
      this.cwd = config.cwd; this.savedFolder.set(config.cwd);
    } catch (e) {
      if (!this.destroyed && generation === this.generation) this.error.set(message(e));
    } finally {
      if (!this.destroyed && generation === this.generation) this.saving.set(false);
    }
  }
}
