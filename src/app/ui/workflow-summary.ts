import { Component, computed, input } from "@angular/core";
import { Item } from "../core/models";

@Component({
  selector: "dp-workflow-summary",
  template: `
    @if (item().next_actor || item().acceptance_criteria?.length) {
      <div class="handoff-summary">
        <div class="handoff-meta">
          @if (item().next_actor) {
            <span class="next-actor" [attr.data-actor]="item().next_actor">Assigned to: {{item().next_actor === 'user' ? 'Me' : item().next_actor === 'codex' ? 'Codex' : 'Unassigned'}}</span>
          }
          @if (item().acceptance_criteria?.length) {
            <span [attr.aria-label]="'Acceptance: '+completed()+' of '+item().acceptance_criteria!.length">✓ {{completed()}} / {{item().acceptance_criteria!.length}}</span>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .handoff-summary { margin-top:10px; font-size: 13px; line-height:1.6; color:var(--muted); }
    .handoff-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
    .next-actor { border:1px solid var(--border); border-radius:4px; padding:1px 5px; color:var(--text); }
    .next-actor[data-actor="user"] { color:var(--accent); }
  `],
})
export class WorkflowSummary {
  readonly item = input.required<Item>();
  readonly completed = computed(() => this.item().acceptance_criteria?.filter(entry => entry.completed).length ?? 0);
}
