import { Component, DestroyRef, OnChanges, SimpleChanges, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CODEX_RUNS, CodexRequest, CodexRun } from '../core/codex-runs';
import { Item } from '../core/models';
import { message } from '../core/store';
import { TextareaFit } from './textarea-fit';

@Component({
  selector: 'dp-codex-run-panel',
  imports: [FormsModule, TextareaFit],
  template: `
    @if (client) {
      <section class="codex-run-panel" aria-labelledby="codex-work-heading">
        <header><h3 id="codex-work-heading">Codex work</h3><span role="status">{{statusLabel()}}</span></header>
        @if (active()) { <p class="codex-current-activity">{{activityLabel()}}</p> }
        @if (loaded() && !configured()) { <p class="muted">Set up local Codex using the project’s <strong>Connect AI</strong> button before starting work.</p> }
        @if (error()) { <p class="error" role="alert">{{error()}}</p> }
        @for (request of run()?.pending || []; track request.id) {
          <section class="codex-request">
            @if (request.kind === 'approval') {
              <h4>Approval needed</h4>
              <p>{{request.params.reason || 'Review this action before allowing Codex to continue.'}}</p>
              @if (request.params.command; as command) { <pre>{{command}}</pre> }
              @if (request.params.cwd; as folder) { <p class="muted">Folder: {{folder}}</p> }
              @if (request.params.grantRoot; as root) { <p>Requested write access: {{root}}</p> }
              @if (request.params.networkApprovalContext; as network) { <p>Network access: {{network.protocol}}://{{network.host}}</p> }
              @for (change of request.item?.changes || []; track change.path) {
                <details><summary>{{change.path}}</summary><pre>{{change.diff}}</pre></details>
              }
              <div class="codex-actions">
                <button type="button" class="primary" (click)="respond(request, 'accept')" [disabled]="working()">Approve once</button>
                <button type="button" class="secondary" (click)="respond(request, 'decline')" [disabled]="working()">Decline</button>
              </div>
            } @else {
              <h4>Codex needs your input</h4>
              @for (question of request.params.questions || []; track question.id) {
                <label>{{question.question}}<textarea dpTextareaFit rows="2" maxlength="10000" [(ngModel)]="answers[answerKey(request, question.id)]" [disabled]="working()"></textarea></label>
                @for (option of question.options || []; track option.label) {
                  <button type="button" class="text-button" [title]="option.description" (click)="answers[answerKey(request, question.id)] = option.label" [disabled]="working()">{{option.label}}</button>
                }
              }
              <button type="button" class="primary" (click)="respond(request)" [disabled]="working() || !canAnswer(request)">Send reply</button>
            }
          </section>
        }
        @if (active()) {
          <button type="button" class="secondary" (click)="stop()" [disabled]="working()">Stop Codex work</button>
        } @else if (!composer()) {
          @if (run()) {
            <label>Follow-up for Codex <span class="muted">optional</span><textarea dpTextareaFit rows="2" maxlength="10000" [(ngModel)]="followup" [disabled]="working()" placeholder="Answer its question or describe the next change"></textarea></label>
          }
          @if (blocked()) { <p class="muted">Save your story edits and post any unfinished note before starting Codex.</p> }
          <button type="button" class="primary" (click)="start()" [disabled]="!loaded() || working() || blocked() || !configured() || !!item().archived_at || item().status === 'done'">{{working() ? 'Starting…' : run() ? 'Continue work on this story' : 'Work on this story'}}</button>
        }
      </section>
    }
  `,
})
export class CodexRunPanel implements OnChanges {
  readonly item = input.required<Item>();
  readonly blocked = input(false);
  readonly composer = input(false);
  readonly client = inject(CODEX_RUNS, { optional: true });
  readonly run = signal<CodexRun | null>(null);
  readonly working = signal(false);
  readonly loaded = signal(false);
  readonly configured = signal(false);
  readonly error = signal('');
  readonly active = computed(() => ['starting', 'running', 'waiting'].includes(this.run()?.status ?? ''));
  readonly executing = computed(() => ['starting', 'running'].includes(this.run()?.status ?? ''));
  readonly activityLabel = computed(() => {
    const run = this.run();
    if (run?.status === 'starting') return 'Connecting Codex to this story…';
    if (run?.status === 'waiting') return run.pending.some(request => request.kind === 'approval')
      ? 'Codex is waiting for your approval below.' : 'Codex is waiting for your reply below.';
    return 'Codex is working on this story. Follow its progress in the notes above.';
  });
  readonly statusLabel = computed(() => {
    const run = this.run();
    return run ? { starting: 'Codex starting…', running: 'Codex working', waiting: 'Waiting for you', review: 'Ready for Review', needs_input: 'Waiting for you', failed: 'Codex failed', interrupted: 'Codex stopped' }[run.status] : '';
  });
  followup = '';
  answers: Record<string, string> = {};
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private mutation = 0;
  private destroyed = false;
  constructor() { inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.generation++; clearTimeout(this.timer); }); }
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.client || !changes['item'] || changes['item'].previousValue?.id === this.item().id) return;
    clearTimeout(this.timer);
    this.generation++;
    this.run.set(null); this.loaded.set(false); this.configured.set(false); this.working.set(false); this.answers = {}; this.followup = ''; this.error.set('');
    void this.load(this.generation);
  }
  private async load(generation: number): Promise<void> {
    if (!this.client || this.destroyed) return;
    if (this.working()) {
      this.timer = setTimeout(() => void this.load(generation), 2000);
      return;
    }
    const mutation = this.mutation;
    try {
      const item = this.item();
      const [run, settings] = await Promise.all([this.client.state(item.id), this.client.config(item.project_id)]);
      if (generation !== this.generation || mutation !== this.mutation || this.destroyed) return;
      if (!this.working()) this.run.set(run);
      this.configured.set(!!settings.cwd);
      this.loaded.set(true);
    } catch (e) {
      if (generation === this.generation && mutation === this.mutation && !this.destroyed) this.error.set(message(e));
    } finally {
      if (generation === this.generation && !this.destroyed) this.timer = setTimeout(() => void this.load(generation), 2000);
    }
  }
  private async act<T>(action: (item: Item) => Promise<T>, apply: (result: T) => void): Promise<void> {
    if (!this.client || this.working()) return;
    const generation = this.generation;
    const item = this.item();
    const current = () => !this.destroyed && generation === this.generation;
    this.mutation++;
    this.working.set(true); this.error.set('');
    try { const result = await action(item); if (current()) apply(result); }
    catch (e) { if (current()) this.error.set(message(e)); }
    finally { if (current()) this.working.set(false); }
  }
  async start(message = this.followup): Promise<boolean> {
    if (!this.client || this.blocked() || this.active() || this.working() || !this.loaded() || !this.configured() || this.item().archived_at || this.item().status === 'done') return false;
    let started = false;
    await this.act(item => this.client!.start(item.id, message), run => { this.run.set(run); this.followup = ''; started = true; });
    return started;
  }
  stop(): void { void this.act(item => this.client!.stop(item.id), run => this.run.set(run)); }
  answerKey(request: CodexRequest, id: string): string { return `${request.id}:${id}`; }
  canAnswer(request: CodexRequest): boolean { return (request.params.questions ?? []).every(q => !!this.answers[this.answerKey(request, q.id)]?.trim()); }
  respond(request: CodexRequest, decision?: 'accept' | 'decline'): void {
    const answers = Object.fromEntries((request.params.questions ?? []).map(q => [q.id, this.answers[this.answerKey(request, q.id)]]));
    void this.act(item => this.client!.reply(item.id, { request_id: request.id, ...(decision ? { decision } : { answers }) }), run => this.run.set(run));
  }
}
