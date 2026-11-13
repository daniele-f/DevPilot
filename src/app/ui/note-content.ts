import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'dp-note-content',
  template: `@for (part of parts(); track $index) {
    @if (part.src) {
      <figure><a [href]="part.src" target="_blank" rel="noopener"><img [src]="part.src" [alt]="part.text" loading="lazy" /></a><figcaption>{{ part.text }}</figcaption></figure>
    } @else { <p>{{ part.text }}</p> }
  }`,
  styles: `:host { display: block; } p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; } figure { margin: 12px 0; } img { display: block; max-width: 100%; height: auto; border-radius: 8px; } figcaption { color: var(--muted); font-size: 12px; margin-top: 6px; }`,
})
export class NoteContent {
  readonly body = input.required<string>();
  readonly parts = computed(() => {
    const parts: { text: string; src?: string }[] = [];
    const body = this.body();
    const pattern = /!\[([^\]\r\n]{1,100})\]\((\/api\/note-images\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\)/g;
    let cursor = 0;
    for (const match of body.matchAll(pattern)) {
      if (match.index > cursor) parts.push({ text: body.slice(cursor, match.index) });
      parts.push({ text: match[1], src: match[2] });
      cursor = match.index + match[0].length;
    }
    if (cursor < body.length) parts.push({ text: body.slice(cursor) });
    return parts;
  });
}
