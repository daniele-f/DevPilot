import {
  Component,
  OnInit,
  input,
  output,
  signal,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, TitleCasePipe } from "@angular/common";
import { A11yModule } from "@angular/cdk/a11y";
import {
  Item,
  ItemDraft,
  Note,
  PRIORITIES,
  STATUSES,
  Status,
  TYPES,
  validateItem,
} from "../core/models";
import { REPOSITORY } from "../core/repository";
import { message } from "../core/store";
import { Icon } from "./icon";
@Component({
  selector: "dp-item-panel",
  imports: [FormsModule, DatePipe, TitleCasePipe, A11yModule, Icon],
  template: `
    <div class="sheet-backdrop" (click)="requestClose()"></div>
    <section
      class="item-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-heading"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      (keydown.escape)="requestClose()"
    >
      <header class="sheet-header">
        <span class="eyebrow" id="item-heading">{{
          item() ? "ITEM DETAILS" : "NEW ITEM"
        }}</span
        ><button
          type="button"
          class="icon-button"
          aria-label="Close item"
          (click)="requestClose()"
          [disabled]="busy()"
        >
          <dp-icon name="close" />
        </button>
      </header>
      <div class="sheet-scroll">
        <form id="item-form" (ngSubmit)="save()" class="item-form">
          <label class="sr-only" for="item-title">Title</label
          ><textarea
            id="item-title"
            name="title"
            class="title-input"
            placeholder="What are we building?"
            rows="2"
            maxlength="200"
            required
            [(ngModel)]="draft.title"
            [disabled]="busy()"
            cdkFocusInitial
          ></textarea>
          <div class="item-fields">
            <label
              >Status<select
                name="status"
                [(ngModel)]="draft.status"
                [disabled]="busy()"
              >
                @for (s of statuses; track s.id) {
                  <option [value]="s.id">{{ s.label }}</option>
                }
              </select></label
            ><label
              >Type<select
                name="type"
                [(ngModel)]="draft.type"
                [disabled]="busy()"
              >
                @for (t of types; track t) {
                  <option [value]="t">{{ t | titlecase }}</option>
                }
              </select></label
            ><label
              >Priority<select
                name="priority"
                [(ngModel)]="draft.priority"
                [disabled]="busy()"
              >
                @for (p of priorities; track p) {
                  <option [value]="p">{{ p | titlecase }}</option>
                }
              </select></label
            >
          </div>
          <label class="description-label"
            >Description <span class="muted">optional</span
            ><textarea
              name="description"
              rows="7"
              maxlength="20000"
              placeholder="A little context goes a long way. Add details, acceptance criteria, or a link…"
              [(ngModel)]="draft.description"
              [disabled]="busy()"
            ></textarea>
          </label>
          @if (error() || validationError()) {
            <p class="error" role="alert">{{ error() || validationError() }}</p>
          }
          @if (item(); as current) {
            <p class="item-timestamp">
              Created {{ current.created_at | date: "mediumDate" }} · Updated
              {{ current.updated_at | date: "mediumDate" }}
            </p>
          }
        </form>
        @if (item(); as current) {
          <section class="notes">
            <h3>
              <dp-icon name="note" /> Notes
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
            @for (note of notes(); track note.id) {
              <article class="note">
                <time>{{ note.created_at | date: "MMM d, y · HH:mm" }}</time>
                <p>{{ note.body }}</p>
              </article>
            }
            @if (!notesLoading() && !notesError() && notes().length === 0) {
              <p class="muted">
                Decisions, discoveries, loose ends. Keep them here.
              </p>
            }
            <form (ngSubmit)="addNote()">
              <label class="sr-only" for="note-body">Add a note</label
              ><textarea
                id="note-body"
                name="note"
                rows="3"
                placeholder="Add a note…"
                maxlength="10000"
                [(ngModel)]="noteBody"
                [disabled]="noteBusy()"
              ></textarea
              ><button
                class="secondary"
                [disabled]="
                  noteBusy() || notesLoading() || busy() || !noteBody.trim()
                "
              >
                {{ noteBusy() ? "Adding…" : "Add note" }}
              </button>
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
            [disabled]="busy()"
          >
            Cancel
          </button>
        }
        <button
          class="primary"
          type="submit"
          form="item-form"
          [disabled]="busy() || noteBusy()"
        >
          {{ busy() ? "Saving…" : item() ? "Save changes" : "Create item" }}
        </button>
      </footer>
    </section>
  `,
})
export class ItemPanel implements OnInit {
  readonly item = input<Item | null>(null);
  readonly initialStatus = input<Status>("ideas");
  readonly busy = input(false);
  readonly error = input("");
  readonly closed = output<void>();
  readonly saved = output<ItemDraft>();
  readonly archived = output<void>();
  readonly statuses = STATUSES;
  readonly types = TYPES;
  readonly priorities = PRIORITIES;
  readonly repo = inject(REPOSITORY);
  readonly notes = signal<Note[]>([]);
  readonly notesLoading = signal(false);
  readonly notesError = signal("");
  readonly validationError = signal("");
  readonly noteBusy = signal(false);
  draft: ItemDraft = {
    title: "",
    description: "",
    type: "idea",
    priority: "medium",
    status: "ideas",
  };
  noteBody = "";
  private initial = "";
  ngOnInit(): void {
    const item = this.item();
    this.draft = item
      ? {
          title: item.title,
          description: item.description,
          type: item.type,
          priority: item.priority,
          status: item.status,
        }
      : { ...this.draft, status: this.initialStatus() };
    this.initial = JSON.stringify(this.draft);
    if (item) void this.loadNotes();
  }
  requestClose(): void {
    if (this.busy() || this.noteBusy()) return;
    if (
      (this.initial !== JSON.stringify(this.draft) || this.noteBody.trim()) &&
      !confirm("Discard your unsaved changes?")
    )
      return;
    this.closed.emit();
  }
  save(): void {
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
    if (this.busy() || this.noteBusy()) return false;
    if (this.noteBody.trim()) {
      this.validationError.set(
        "Add your note or clear it before saving or archiving this item.",
      );
      return false;
    }
    return true;
  }
  async loadNotes(): Promise<void> {
    const item = this.item();
    if (!item) return;
    this.notesLoading.set(true);
    this.notesError.set("");
    try {
      this.notes.set(await this.repo.notes(item.id));
    } catch (e) {
      this.notesError.set(message(e));
    } finally {
      this.notesLoading.set(false);
    }
  }
  async addNote(): Promise<void> {
    const item = this.item();
    if (
      !item ||
      this.noteBusy() ||
      this.notesLoading() ||
      this.busy() ||
      !this.noteBody.trim()
    )
      return;
    this.noteBusy.set(true);
    this.notesError.set("");
    try {
      const note = await this.repo.addNote(item.id, this.noteBody);
      this.notes.update((all) => [...all, note]);
      this.noteBody = "";
    } catch (e) {
      this.notesError.set(message(e));
    } finally {
      this.noteBusy.set(false);
    }
  }
}
