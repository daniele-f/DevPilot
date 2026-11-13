import { Component, input } from "@angular/core";
const paths: Record<string, string> = {
  activity: "M12 8v4l3 2M4 7V3m0 4h4M4 7a9 9 0 1 1-1 8",
  plus: "M12 5v14M5 12h14",
  pencil: "m16 3 5 5M4 15 16 3a2.1 2.1 0 0 1 5 5L9 20l-6 1z",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2",
  close: "m6 6 12 12M6 18 18 6",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  minimise: "M5 12h14",
  board: "M3 4h18v16H3zM9 4v16m6-16v16",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  archive: "M3 3h18v5H3zM5 8v13h14V8M10 12h4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13z",
  menu: "M4 6h16M4 12h16M4 18h16",
  "sidebar-collapse": "M3 4h18v16H3zM9 4v16m7-11-3 3 3 3",
  "sidebar-expand": "M3 4h18v16H3zM9 4v16m4-11 3 3-3 3",
  folder: "M3 5h6l2 2h10v13H3z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  logout: "M9 4H4v16h5m5-13 5 5-5 5M8 12h12",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  check: "m5 12 4 4L19 6",
  note: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h5",
  grip: "M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01",
};
@Component({
  selector: "dp-icon",
  host: { "aria-hidden": "true" },
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="path()" /></svg>',
  styles: [
    ":host{display:inline-flex;width:18px;height:18px;flex-shrink:0}svg{width:100%;height:100%}",
  ],
})
export class Icon {
  readonly name = input.required<string>();
  path(): string {
    return paths[this.name()] ?? paths["folder"];
  }
}
