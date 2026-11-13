import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  DestroyRef,
  input,
  output,
  signal,
  computed,
  inject,
  afterNextRender,
  Injector,
  viewChild,
  effect,
  ElementRef,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, TitleCasePipe } from "@angular/common";
import { A11yModule } from "@angular/cdk/a11y";
import { TextareaFit } from "./textarea-fit";
import { NoteContent } from "./note-content";
import {
  Item,
  Activity,
  ItemDraft,
  Note,
  PRIORITIES,
  STATUSES,
  Status,
  TYPES,
  validateItem,
  validateName,
} from "../core/models";
import { REPOSITORY } from "../core/repository";
import { NoteEvent, applyNoteEvent } from "../core/note-events";
import { message } from "../core/store";
import { Icon } from "./icon";
import { storyTimeline, activityAuthor, activityAction } from "../core/activity";
import { CodexRunPanel } from './codex-run-panel';
@Component({
  selector: "dp-item-panel",
  imports: [FormsModule, DatePipe, TitleCasePipe, A11yModule, TextareaFit, Icon, NoteContent, CodexRunPanel],
  template: `
    <div class="sheet-backdrop" (click)="requestClose()"></div>
    <section
      class="item-sheet"
      [class.item-sheet-fullscreen]="fullscreen()"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="item() ? draft.title : 'New item'"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      (keydown.escape)="requestClose()"
    >
      <header class="sheet-header">
        <div class="card-header-content"><div class="card-heading">
        @if (!item()) { <span class="eyebrow">NEW ITEM</span> }
        @if (item()?.card_number; as number) {
          <button type="button" class="card-number-copy" (click)="copyCardNumber()"
            [attr.aria-label]="'Copy DP #'+number+' and title to clipboard'" title="Copy card ID and title">DP #{{number}}</button>
          <span class="muted card-copy-status" role="status">{{numberCopied() ? 'Copied' : ''}}</span>
        }
        @if (codexPanel(); as panel) {
          @if (panel.run()) {
            <span class="codex-work-indicator" role="status" [class.codex-work-waiting]="panel.run()?.status === 'waiting' || panel.run()?.status === 'needs_input'">
              @if (panel.executing()) { <span class="codex-work-spinner" aria-hidden="true"></span> }
              {{panel.statusLabel()}}
            </span>
          }
        }</div>
        <div class="card-header-title" [class.card-header-title-visible]="headerTitleVisible()" aria-hidden="true">
          <div><span>{{draft.title}}</span></div>
        </div></div><div class="sheet-header-actions">
        <button
          type="button"
          class="icon-button desktop-only"
          [attr.aria-label]="fullscreen() ? 'Minimise item to side panel' : 'Expand item to fullscreen'"
          [attr.title]="fullscreen() ? 'Minimise to side panel' : 'Expand to fullscreen'"
          [attr.aria-pressed]="fullscreen()"
          (click)="fullscreen.set(!fullscreen())"
        >
          <dp-icon [name]="fullscreen() ? 'minimise' : 'expand'" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Close item"
          (click)="requestClose()"
          [disabled]="busy() || saving() || !!codexPanel()?.working()"
        >
          <dp-icon name="close" />
        </button>
        </div>
      </header>
      <div class="sheet-scroll" #scrollArea>
        @if (copyError()) { <p class="error" role="alert">{{copyError()}}</p> }
        @if (removed()) {
          <p class="error" role="status">This card was removed elsewhere. Your unfinished edits are kept here so you can copy them.</p>
        }
        @if (conflicts().length) {
          <p class="muted" role="status">This card changed elsewhere. Your unfinished edits to {{conflicts().join(', ')}} are kept.</p>
        }
        <form id="item-form" (ngSubmit)="save()" class="item-form">
          <div class="item-title-row" #titleRow>
          @if (!item() || editingTitle()) {
          <label class="sr-only" for="item-title">Title</label><textarea dpTextareaFit
            id="item-title"
            name="title"
            class="title-input"
            placeholder="What are we building?"
            rows="2"
            maxlength="200"
            required
            [(ngModel)]="draft.title"
            [disabled]="busy() || saving() || !!codexPanel()?.working()"
            (keydown.enter)="finishTitleEditing($event)"
            (keydown.escape)="cancelTitleEditing($event)"
            cdkFocusInitial
          ></textarea>
          @if (item()) {
            <button type="button" class="icon-button" aria-label="Finish editing title" title="Finish editing title" (click)="finishTitleEditing()" [disabled]="busy() || saving() || !!codexPanel()?.working()"><dp-icon name="check" /></button>
          }
          } @else {
            <h2 class="item-title-text">{{draft.title}}</h2>
            <button id="edit-item-title" type="button" class="icon-button" aria-label="Edit title" title="Edit title" (click)="beginTitleEditing()" [disabled]="busy() || saving() || !!codexPanel()?.working()" cdkFocusInitial><dp-icon name="pencil" /></button>
          }
          </div>
          <div class="item-fields">
            <label
              >Status<select
                name="status"
                [(ngModel)]="draft.status" (ngModelChange)="saveFields(['status'])"
                [disabled]="busy() || saving() || !!codexPanel()?.working()"
              >
                @for (s of statuses; track s.id) {
                  <option [value]="s.id">{{ s.label }}</option>
                }
              </select></label
            ><label
              >Type<select
                name="type"
                [(ngModel)]="draft.type" (ngModelChange)="saveFields(['type'])"
                [disabled]="busy() || saving() || !!codexPanel()?.working()"
              >
                @for (t of types; track t) {
                  <option [value]="t">{{ t | titlecase }}</option>
                }
              </select></label
            ><label
              >Priority<select
                name="priority"
                [(ngModel)]="draft.priority" (ngModelChange)="saveFields(['priority'])"
                [disabled]="busy() || saving() || !!codexPanel()?.working()"
              >
                @for (p of priorities; track p) {
                  <option [value]="p">{{ p | titlecase }}</option>
                }
              </select></label
            >
          </div>
          <label class="description-label"
            >Description <span class="muted">optional</span
            ><textarea dpTextareaFit
              name="description"
              rows="7"
              maxlength="20000"
              placeholder="A little context goes a long way. Add details or a link…"
              [(ngModel)]="draft.description"
              [disabled]="busy() || saving() || !!codexPanel()?.working()"
            ></textarea>
          </label>
          @if (item()) {
            @if (draft.description !== item()?.description) {
              <button type="button" class="secondary" (click)="saveFields(['description'])" [disabled]="busy() || saving()"><dp-icon name="check" /> Confirm description</button>
            }
            @if (saveError()) { <p class="error" role="alert">{{saveError()}}</p><button type="button" class="text-button" (click)="retrySave()">Retry saving</button> }
          }
          <section class="workflow-fields" aria-labelledby="handoff-heading">
            <h3 id="handoff-heading">Assigned to</h3>
            <label><span class="sr-only">Assigned to</span><select name="nextActor" [(ngModel)]="draft.next_actor" (ngModelChange)="saveFields(['next_actor'])" [disabled]="busy() || saving() || !!codexPanel()?.working()">
              <option [ngValue]="null">Unassigned</option>
              <option value="user">Me</option><option value="codex">Codex</option>
            </select></label>
          </section>
          <details class="acceptance-section">
            <summary>Acceptance checklist <span class="muted">{{completedCriteria()}} / {{draft.acceptance_criteria?.length || 0}}</span></summary>
            <p class="muted acceptance-help">Done means you have tested and approved the result. Checking these items does not move the story to Done.</p>
            @for (entry of draft.acceptance_criteria; track $index; let i = $index) {
              <div class="acceptance-row">
                <input type="checkbox" [name]="'criterionChecked'+i" [(ngModel)]="entry.completed" (ngModelChange)="saveFields(['acceptance_criteria'])" [attr.aria-label]="'Accept: '+(entry.text || 'criterion '+(i+1))" [disabled]="busy() || saving() || !!codexPanel()?.working()" />
                <div class="criterion-editor"><textarea dpTextareaFit="0" [name]="'criterionText'+i" [(ngModel)]="entry.text" (blur)="saveFields(['acceptance_criteria'])" maxlength="500" [attr.aria-label]="'Acceptance criterion '+(i+1)" placeholder="An observable result to verify" [disabled]="busy() || saving() || !!codexPanel()?.working()"></textarea></div>
                <button type="button" class="icon-button" [attr.aria-label]="'Remove acceptance criterion '+(i+1)" (click)="removeCriterion(i)" [disabled]="busy() || saving() || !!codexPanel()?.working()"><dp-icon name="close" /></button>
              </div>
            }
            <button type="button" class="text-button add-criterion" (click)="addCriterion()" [disabled]="busy() || (draft.acceptance_criteria?.length || 0)>=50"><dp-icon name="plus" /> Add criterion</button>
          </details>
          @if (error() || validationError()) {
            <p class="error" role="alert">{{ error() || validationError() }}</p>
          }
        </form>
        @if (item(); as current) {
          <section class="notes">
            <h3>
              <dp-icon name="note" /> Notes & activity
              <span class="count">{{ notes().length }}</span>
            </h3>
            @if (notesLoading()) {
              <p class="muted" role="status">Loading notes…</p>
            }
            @if (notesError()) {
              <p class="error" role="alert">{{ notesError() }}</p>
              <button class="text-button" type="button" (click)="loadNotes()">
                Retry loading notes
              </button>
            }
            @if (activityError()) {
              <p class="error" role="alert">{{ activityError() }}</p>
              <button type="button" class="text-button" (click)="loadActivity()">Retry loading activity</button>
            }
            @for (entry of timeline(); track entry.id) {
              @if (entry.kind === 'activity') {
                <div class="story-activity">
                  <dp-icon name="activity" />
                  <div class="story-activity-content">
                    <span><span [class.note-author-me]="entry.activity.actor === 'user'" [class.note-author-codex]="entry.activity.actor === 'codex'">{{ activityAuthor(entry.activity) }}</span> {{ activityAction(entry.activity) }}</span>
                    <time [attr.datetime]="entry.created_at">{{ entry.created_at | date: "MMM d, y · HH:mm" }}</time>
                    @if (entry.activity.kind === 'note_deleted') {
                      <span class="story-activity-private">Only visible to me</span>
                    }
                  </div>
                  @if (entry.activity.kind === 'note_deleted' && entry.activity.actor === 'user') {
                    <button class="icon-button story-activity-remove" type="button"
                      aria-label="Remove history entry" title="Remove history entry"
                      (click)="removeActivity(entry.activity)" [disabled]="activityRemoving() !== null || busy() || noteBusy()">
                      <dp-icon name="close" />
                    </button>
                  }
                </div>
              } @else {
              @let note = entry.note;
              <article class="note">
                <div class="note-meta">
                  <span class="note-author" [class.note-author-me]="note.author === 'user'" [class.note-author-codex]="note.author === 'codex'">{{ note.author === 'codex' ? 'Codex' : note.author === 'user' ? 'Me' : 'Unknown' }}</span>
                  <time [attr.datetime]="note.created_at">{{ note.created_at | date: "MMM d, y · HH:mm" }}@if (note.edited_at) { - <span [attr.title]="'Edited on ' + (note.edited_at | date: 'MMM d, y · HH:mm')">Edited</span> }</time>
                  @if (note.author === 'user' && editingNote() !== note.id) {
                    <div class="note-hover-actions">
                      <button class="icon-button note-edit" type="button" aria-label="Edit note" title="Edit note" (click)="editNote(note)" [disabled]="noteBusy() || busy() || editingNote() !== null"><dp-icon name="pencil" /></button>
                      <button class="icon-button note-remove" type="button" aria-label="Remove note" title="Remove note" (click)="removingNote.set(note.id)" [disabled]="noteBusy() || busy() || editingNote() !== null"><dp-icon name="close" /></button>
                    </div>
                  }
                </div>
                @if (editingNote() === note.id) {
                  <form (ngSubmit)="saveNote(note)">
                    <label class="sr-only" [for]="'edit-note-' + note.id">Edit your note</label>
                    <textarea (keydown.control.enter)="$event.preventDefault(); saveNote(note)" dpTextareaFit [id]="'edit-note-' + note.id" name="editNote" rows="3" maxlength="10000" [(ngModel)]="editNoteBody" [disabled]="noteBusy() || !!codexPanel()?.working()"></textarea>
                    <div class="note-actions">
                      <button class="secondary" [disabled]="noteBusy() || busy() || removed() || editedNoteRemoved() || !editNoteBody.trim()">{{ noteBusy() ? 'Saving…' : 'Save' }}</button>
                      <button class="text-button" type="button" (click)="cancelNoteEdit()" [disabled]="noteBusy() || !!codexPanel()?.working()">Cancel</button>
                    </div>
                  </form>
                  @if (editedNoteRemoved()) {
                    <p class="error" role="status">This note was removed elsewhere. Copy your unfinished edit or cancel it.</p>
                  }
                } @else {
                  <dp-note-content [body]="note.body" />

                }
                @if (removingNote() === note.id) {
                  <div class="note-confirmation" role="group" aria-label="Confirm note removal" (keydown.escape)="$event.stopPropagation(); removingNote.set(null)">
                    <span>Remove this note? This cannot be undone.</span>
                    <div class="note-actions">
                      <button class="secondary" type="button" (click)="removeNote(note)" [disabled]="noteBusy() || busy()">{{ noteBusy() ? 'Removing…' : 'Remove note' }}</button>
                      <button class="text-button" type="button" (click)="removingNote.set(null)" [disabled]="noteBusy() || !!codexPanel()?.working()">Cancel</button>
                    </div>
                  </div>
                }
              </article>
              }
            }
            @if (!notesLoading() && !notesError() && timeline().length === 0) {
              <p class="muted">
                Decisions, discoveries, loose ends. Keep them here.
              </p>
            }
            <dp-codex-run-panel [item]="current" [blocked]="codexBlocked()" [composer]="true" />
            <form (ngSubmit)="addNote()">
              <label class="sr-only" for="note-body">Add a note</label
              ><div class="note-composer"><textarea dpTextareaFit
                (keydown.control.enter)="$event.preventDefault(); addNote()"
                aria-describedby="note-shortcut"
                id="note-body"
                name="note"
                rows="3"
                placeholder="Add a note…"
                maxlength="10000"
                [(ngModel)]="noteBody"
                [disabled]="noteBusy() || !!codexPanel()?.working()"
              ></textarea><span id="note-shortcut" class="note-shortcut">Ctrl + Enter to add a note</span></div><button
                class="secondary"
                [disabled]="
                  noteBusy() || !!codexPanel()?.working() || notesLoading() || busy() || !noteBody.trim()
                "
              >
                {{ noteBusy() ? "Adding…" : "Add note" }}
              </button>
              @if (codexPanel(); as panel) {
                @if (panel.client) {
                  <button type="button" class="primary" (click)="requestWork()"
                    [disabled]="codexBlocked() || !panel.loaded() || !panel.configured() || panel.active() || panel.working() || !!current.archived_at || current.status === 'done'">
                    {{panel.working() ? 'Starting?' : panel.run() ? 'Continue work on this story' : 'Work on this story'}}
                  </button>
                }
              }
            </form>
          </section>
        }
      </div>
      <footer class="sheet-footer">
        @if (item(); as current) {
          <button
            type="button"
            class="text-button muted"
            (click)="archive()"
            [disabled]="busy() || noteBusy()"
          >
            <dp-icon name="archive" />
            {{ current.archived_at ? "Restore item" : "Archive item" }}
          </button>
        } @else {
          <button
            type="button"
            class="secondary"
            (click)="requestClose()"
            [disabled]="busy() || saving() || !!codexPanel()?.working()"
          >
            Cancel
          </button>
        }
        @if (!item()) { <button
          class="primary"
          type="submit"
          form="item-form"
          [disabled]="busy() || noteBusy()"
        >
          {{ busy() ? "Saving…" : "Create item" }}
        </button> }
      </footer>
    </section>
  `,
})
export class ItemPanel implements OnInit, OnChanges {
  readonly attentionRequest = input(0);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private focusedAttention = '';
  readonly codexPanel = viewChild(CodexRunPanel);
  readonly fullscreen = signal(false);
  readonly item = input<Item | null>(null);
  readonly removed = input(false);
  readonly refreshVersion = input(0);
  readonly noteEvents = input<NoteEvent[]>([]);
  readonly conflicts = signal<string[]>([]);
  readonly editedNoteRemoved = signal(false);
  readonly initialStatus = input<Status>("ideas");
  readonly busy = input(false);
  readonly error = input("");
  readonly closed = output<void>();
  readonly saved = output<ItemDraft>();
  readonly persist = input<((draft: ItemDraft) => Promise<unknown>) | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal('');
  private retryFields: Array<keyof ItemDraft> = [];
  async saveFields(fields: Array<keyof ItemDraft>): Promise<void> {
    const item = this.item();
    const persist = this.persist();
    if (!item || !persist || this.removed() || this.busy() || this.saving()) return;
    if (this.saveError()) fields = [...new Set([...this.retryFields, ...fields])];
    const value: ItemDraft = { ...item };
    for (const key of fields) Object.assign(value, { [key]: this.draft[key] });
    this.retryFields = fields;
    this.saveError.set('');
    this.saving.set(true);
    try { await persist(validateItem(value)); }
    catch (error) { this.saveError.set(message(error)); }
    finally { this.saving.set(false); }
  }
  retrySave(): void { void this.saveFields(this.retryFields); }
  async requestWork(): Promise<void> {
    const panel = this.codexPanel();
    if (!panel || this.codexBlocked()) return;
    if (await panel.start(this.noteBody)) { this.noteBody = ''; void this.loadNotes(true); }
  }
  readonly archived = output<void>();
  readonly statuses = STATUSES;
  readonly types = TYPES;
  readonly priorities = PRIORITIES;
  readonly repo = inject(REPOSITORY);
  private readonly injector = inject(Injector);
  readonly editingTitle = signal(false);
  readonly headerTitleVisible = signal(false);
  readonly scrollArea = viewChild<ElementRef<HTMLElement>>('scrollArea');
  readonly titleRow = viewChild<ElementRef<HTMLElement>>('titleRow');
  readonly numberCopied = signal(false);
  readonly copyError = signal("");
  private copyTimer: ReturnType<typeof setTimeout> | undefined;
  private titleBeforeEdit = "";
  readonly notes = signal<Note[]>([]);
  readonly activity = signal<Activity[]>([]);
  readonly activityError = signal("");
  readonly activityRemoving = signal<string | null>(null);
  readonly timeline = computed(() => storyTimeline(this.notes(), this.activity()));
  readonly activityAuthor = activityAuthor;
  readonly activityAction = activityAction;
  private activityRequest = 0;
  readonly notesLoading = signal(false);
  readonly notesError = signal("");
  readonly validationError = signal("");
  readonly noteBusy = signal(false);
  readonly editingNote = signal<string | null>(null);
  readonly removingNote = signal<string | null>(null);
  editNoteBody = "";
  draft: ItemDraft = {
    title: "",
    description: "",
    type: "idea",
    priority: "medium",
    status: "ideas",
    next_actor: null,
    next_action: "",
    acceptance_criteria: [],
  };
  noteBody = "";
  private initial = "";
  private initialized = false;
  private destroyed = false;
  private noteRequest = 0;
  private noteMutation = 0;
  private pendingNotesRefresh = false;
  private seenNoteEvents = new Set<string>();
  private notesFetchActive = false;
  private bufferedNoteEvents: NoteEvent[] = [];
  private noteEventSerial = 0;
  private noteVersions = new Map<string, number>();
  private lastNoteDelivery = 0;
  codexBlocked(): boolean {
    return this.busy() || this.saving() || this.noteBusy() || this.removed() || this.editingNote() !== null || this.initial !== JSON.stringify(this.draft);
  }
  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const root = this.scrollArea()?.nativeElement;
      const title = this.titleRow()?.nativeElement;
      if (!root || !title || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(([entry]) => {
        // Reveal only once the complete title has passed above the scroll area.
        this.headerTitleVisible.set(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0));
      }, { root, threshold: 0 });
      observer.observe(title);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    effect(() => {
      const request = this.attentionRequest();
      const itemId = this.item()?.id;
      const run = this.codexPanel()?.run();
      const key = `${itemId}:${request}`;
      if (!request || !run || key === this.focusedAttention) return;
      this.focusedAttention = key;
      afterNextRender(() => {
        if (this.destroyed || this.item()?.id !== itemId || this.attentionRequest() !== request) return;
        const host = this.element.nativeElement;
        const target = host.querySelector<HTMLElement>('.codex-request')
          ?? host.querySelector<HTMLElement>('.codex-run-panel');
        if (target) {
          target.setAttribute('tabindex', '-1');
          target.scrollIntoView({ block: 'center' });
          target.focus({ preventScroll: true });
        }
      }, { injector: this.injector });
    });
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.noteRequest++; clearTimeout(this.copyTimer); });
  }
  async copyCardNumber(): Promise<void> {
    const item = this.item();
    const number = item?.card_number;
    if (!item || number == null) return;
    const value = `DP #${number} - ${item.title}`;
    this.copyError.set("");
    this.numberCopied.set(false);
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      // The local phone URL uses HTTP, where the modern clipboard API may be
      // unavailable. Keep a user-initiated fallback and restore editor focus.
      const focused = document.activeElement as HTMLElement | null;
      const selection = focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement
        ? [focused.selectionStart, focused.selectionEnd] as const : null;
      const field = document.createElement("textarea");
      field.value = value;
      field.readOnly = true;
      field.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(field);
      try {
        field.select();
        copied = document.execCommand("copy");
      } catch {} finally {
        field.remove();
        focused?.focus({ preventScroll: true });
        if (selection && (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement)) {
          try { focused.setSelectionRange(selection[0], selection[1]); } catch {}
        }
      }
    }
    if (this.destroyed) return;
    if (copied) {
      this.numberCopied.set(true);
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => this.numberCopied.set(false), 2000);
    } else {
      this.copyError.set("Could not copy the card number. Select the number and copy it manually.");
    }
  }
  ngOnInit(): void {
    const item = this.item();
    this.draft = item
      ? {
          title: item.title,
          description: item.description,
          type: item.type,
          priority: item.priority,
          status: item.status,
          next_actor: item.next_actor ?? null,
          next_action: item.next_action ?? "",
          acceptance_criteria: (item.acceptance_criteria ?? []).map(entry => ({ ...entry })),
        }
      : { ...this.draft, status: this.initialStatus() };
    this.initial = JSON.stringify(this.draft);
    this.initialized = true;
    this.seenNoteEvents = new Set(this.noteEvents().map(event => event.id));
    this.lastNoteDelivery = this.noteEvents().at(-1)?.delivery ?? 0;
    if (item) { void this.loadNotes(); void this.loadActivity(); }
  }
  ngOnChanges(changes: SimpleChanges): void {
    const item = this.item();
    if (!this.initialized || !item || this.removed()) return;
    if (changes["item"] || changes["refreshVersion"] || changes["noteEvents"]) void this.loadActivity();
    if (changes["noteEvents"]) {
      const firstDelivery = this.noteEvents()[0]?.delivery ?? 0;
      if (firstDelivery > this.lastNoteDelivery + 1) void this.loadNotes(true);
      for (const event of this.noteEvents()) {
        if (this.seenNoteEvents.has(event.id)) continue;
        this.seenNoteEvents.add(event.id);
        if (event.item_id && event.item_id !== item.id) continue;
        this.noteVersions.set(event.note_id, ++this.noteEventSerial);
        if (this.notesFetchActive) this.bufferedNoteEvents.push(event);
        this.acceptNotes(applyNoteEvent(this.savedNotes(), event, item.id));
      }
      this.lastNoteDelivery = this.noteEvents().at(-1)?.delivery ?? this.lastNoteDelivery;
      this.seenNoteEvents = new Set(this.noteEvents().map(event => event.id));
    }
    if (!changes["item"]) {
      if (changes["refreshVersion"]) void this.loadNotes(true);
      return;
    }
    const previous = JSON.parse(this.initial) as ItemDraft;
    const incoming: ItemDraft = {
      title: item.title, description: item.description, type: item.type,
      priority: item.priority, status: item.status, next_actor: item.next_actor ?? null,
      next_action: item.next_action ?? "",
      acceptance_criteria: (item.acceptance_criteria ?? []).map(entry => ({ ...entry })),
    };
    const merged = { ...incoming };
    const conflicts: string[] = [];
    for (const key of Object.keys(incoming) as Array<keyof ItemDraft>) {
      const label = key.replaceAll("_", " ");
      const dirty = JSON.stringify(this.draft[key]) !== JSON.stringify(previous[key]) || (key === "title" && this.editingTitle());
      if (dirty) {
        Object.assign(merged, { [key]: this.draft[key] });
        if (JSON.stringify(this.draft[key]) !== JSON.stringify(incoming[key]) &&
            (JSON.stringify(previous[key]) !== JSON.stringify(incoming[key]) || this.conflicts().includes(label))) conflicts.push(label);
      }
    }
    this.draft = merged;
    this.initial = JSON.stringify(incoming);
    this.conflicts.set(conflicts);
    if (this.editingTitle()) this.titleBeforeEdit = incoming.title;
    if (changes["refreshVersion"]) void this.loadNotes(true);
  }
  private acceptNotes(notes: Note[]): void {
    const editing = this.notes().find(note => note.id === this.editingNote());
    const deleted = Boolean(editing && !notes.some(note => note.id === editing.id));
    this.editedNoteRemoved.set(deleted);
    this.notes.set(deleted ? [...notes, editing!] : notes);
  }
  private savedNotes(): Note[] {
    return this.editedNoteRemoved() ? this.notes().filter(note => note.id !== this.editingNote()) : this.notes();
  }
  private acknowledgeNote(note: Note, startedAt: number): void {
    if ((this.noteVersions.get(note.id) ?? 0) > startedAt) return;
    this.acceptNotes(applyNoteEvent(this.savedNotes(), {id: "ack", operation: "update", note_id: note.id, item_id: note.item_id, note}, note.item_id));
  }
  beginTitleEditing(): void {
    if (this.busy()) return;
    this.titleBeforeEdit = this.draft.title;
    this.editingTitle.set(true);
    afterNextRender(() => {
      const editor = document.getElementById("item-title") as HTMLTextAreaElement | null;
      editor?.focus();
      editor?.select();
    }, { injector: this.injector });
  }
  finishTitleEditing(event?: Event): void {
    if (!this.item()) return;
    event?.preventDefault();
    if (this.busy()) return;
    try {
      this.draft.title = validateName(this.draft.title, 200);
      this.validationError.set("");
      this.endTitleEditing();
      void this.saveFields(["title"]);
    } catch (e) { this.validationError.set(message(e)); }
  }
  cancelTitleEditing(event: Event): void {
    if (!this.item()) return;
    event.stopPropagation();
    event.preventDefault();
    if (this.busy()) return;
    this.draft.title = this.titleBeforeEdit;
    this.validationError.set("");
    this.endTitleEditing();
  }
  private endTitleEditing(): void {
    this.editingTitle.set(false);
    afterNextRender(() => document.getElementById("edit-item-title")?.focus(), { injector: this.injector });
  }
  requestClose(): void {
    if (this.busy() || this.saving() || this.noteBusy() || this.codexPanel()?.working()) return;
    if (
      (this.initial !== JSON.stringify(this.draft) || this.noteBody.trim() || this.editingNote() !== null) &&
      !confirm("Discard your unsaved changes?")
    )
      return;
    this.closed.emit();
  }
  addCriterion(): void {
    if (this.busy() || (this.draft.acceptance_criteria?.length ?? 0) >= 50) return;
    this.draft.acceptance_criteria = [...(this.draft.acceptance_criteria ?? []), { text: "", completed: false }];
  }
  removeCriterion(index: number): void {
    if (!this.busy()) { this.draft.acceptance_criteria = this.draft.acceptance_criteria?.filter((_, i) => i !== index); void this.saveFields(["acceptance_criteria"]); }
  }
  completedCriteria(): number {
    return this.draft.acceptance_criteria?.filter(entry => entry.completed).length ?? 0;
  }
  save(): void {
    if (this.item()) return;
    this.validationError.set("");
    if (!this.canFinish()) return;
    try {
      this.saved.emit(validateItem(this.draft));
    } catch (e) {
      this.validationError.set(message(e));
      document.getElementById("item-title")?.focus();
    }
  }
  archive(): void {
    if (this.codexPanel()?.working() || this.saving()) return;
    this.validationError.set("");
    if (!this.canFinish()) return;
    if (
      this.initial !== JSON.stringify(this.draft) &&
      !confirm("Discard your unsaved edits and change archive status?")
    )
      return;
    this.archived.emit();
  }
  private canFinish(): boolean {
    if (this.removed()) return false;
    if (this.busy() || this.noteBusy()) return false;
    if (this.editingNote() !== null) {
      this.validationError.set("Save or cancel your note edit before saving or archiving this item.");
      return false;
    }
    if (this.noteBody.trim()) {
      this.validationError.set(
        "Add your note or clear it before saving or archiving this item.",
      );
      return false;
    }
    return true;
  }
  async removeActivity(event: Activity): Promise<void> {
    const item = this.item();
    if (!item || this.removed() || event.kind !== 'note_deleted' || event.actor !== 'user' ||
        this.activityRemoving() || this.busy() || this.noteBusy() || !this.repo.deleteActivity) return;
    this.activityRemoving.set(event.id);
    this.activityRequest++;
    this.activityError.set("");
    let removed = false;
    try {
      await this.repo.deleteActivity(item.id, event.id);
      if (this.destroyed) return;
      this.activity.update(events => events.filter(entry => entry.id !== event.id));
      removed = true;
    } catch (error) {
      if (!this.destroyed) this.activityError.set(message(error));
    } finally {
      this.activityRemoving.set(null);
      if (removed) void this.loadActivity();
    }
  }
  async loadActivity(): Promise<void> {
    const item = this.item();
    if (!item || this.removed() || this.destroyed || this.activityRemoving() || !this.repo.activity) return;
    const request = ++this.activityRequest;
    try {
      const activity = await this.repo.activity(item.id);
      if (this.destroyed || request !== this.activityRequest) return;
      this.activity.set(activity);
      this.activityError.set("");
    } catch (error) {
      if (!this.destroyed && request === this.activityRequest) this.activityError.set(message(error));
    }
  }
  async loadNotes(background = false): Promise<void> {
    const item = this.item();
    if (!item || this.removed() || this.destroyed) return;
    if (background && this.noteBusy()) { this.pendingNotesRefresh = true; return; }
    this.pendingNotesRefresh = false;
    const request = ++this.noteRequest;
    const mutation = this.noteMutation;
    this.notesFetchActive = true;
    this.bufferedNoteEvents = [];
    if (!background) { this.notesLoading.set(true); this.notesError.set(""); }
    try {
      let notes = await this.repo.notes(item.id);
      if (this.destroyed || request !== this.noteRequest) return;
      if (mutation !== this.noteMutation) { this.pendingNotesRefresh = true; return; }
      for (const event of this.bufferedNoteEvents) notes = applyNoteEvent(notes, event, item.id);
      this.acceptNotes(notes);
    } catch (e) {
      if (!this.destroyed && request === this.noteRequest && mutation === this.noteMutation) this.notesError.set(message(e));
    } finally {
      if (!this.destroyed && request === this.noteRequest) {
        this.notesFetchActive = false;
        this.bufferedNoteEvents = [];
        this.notesLoading.set(false);
        if (this.pendingNotesRefresh && !this.noteBusy()) void this.loadNotes(true);
      }
    }
  }
  async addNote(): Promise<void> {
    const item = this.item();
    if (
      !item || this.removed() ||
      this.noteBusy() || this.codexPanel()?.working() ||
      this.notesLoading() ||
      this.busy() ||
      !this.noteBody.trim()
    )
      return;
    this.noteBusy.set(true);
    this.noteMutation++;
    const startedAt = this.noteEventSerial;
    this.notesError.set("");
    try {
      const note = await this.repo.addNote(item.id, this.noteBody);
      this.acknowledgeNote(note, startedAt);
      this.noteBody = "";
    } catch (e) {
      this.notesError.set(message(e));
    } finally {
      this.noteBusy.set(false);
      if (this.pendingNotesRefresh) void this.loadNotes(true);
    }
  }
  editNote(note: Note): void {
    if (note.author !== "user" || this.noteBusy() || this.busy() || this.editingNote()) return;
    this.removingNote.set(null);
    this.editNoteBody = note.body;
    this.editingNote.set(note.id);
    this.editedNoteRemoved.set(false);
  }
  cancelNoteEdit(): void {
    if (this.editedNoteRemoved()) this.notes.update(notes => notes.filter(note => note.id !== this.editingNote()));
    this.editingNote.set(null);
    this.editedNoteRemoved.set(false);
  }
  async saveNote(note: Note): Promise<void> {
    if (this.removed() || this.editedNoteRemoved() || note.author !== "user" || this.editingNote() !== note.id || this.noteBusy() || this.busy() || !this.editNoteBody.trim()) return;
    this.noteBusy.set(true);
    this.noteMutation++;
    const startedAt = this.noteEventSerial;
    this.notesError.set("");
    try {
      const saved = await this.repo.editNote(note.id, this.editNoteBody);
      this.acknowledgeNote(saved, startedAt);
      if (!this.editedNoteRemoved()) this.editingNote.set(null);
    } catch (e) {
      this.notesError.set(message(e));
    } finally { this.noteBusy.set(false); void this.loadActivity(); if (this.pendingNotesRefresh) void this.loadNotes(true); }
  }
  async removeNote(note: Note): Promise<void> {
    if (this.removed() || note.author !== "user" || this.noteBusy() || this.busy() || this.editingNote() || this.removingNote() !== note.id) return;
    this.noteBusy.set(true);
    this.noteMutation++;
    this.notesError.set("");
    try {
      await this.repo.deleteNote(note.id);
      this.notes.update(all => all.filter(entry => entry.id !== note.id));
      this.removingNote.set(null);
    } catch (e) {
      this.notesError.set(message(e));
    } finally { this.noteBusy.set(false); void this.loadActivity(); if (this.pendingNotesRefresh) void this.loadNotes(true); }
  }
}
