import { Directive, ElementRef, DestroyRef, NgZone, afterEveryRender, inject, input, numberAttribute } from "@angular/core";

@Directive({
  selector: "textarea[dpTextareaFit]",
  host: {
    style: "resize:none;overflow:hidden;min-height:0;max-height:none",
    "(input)": "resize()",
  },
})
export class TextareaFit {
  readonly spareLines = input(1, {
    alias: "dpTextareaFit",
    transform: (value: unknown) => Math.max(0, numberAttribute(value, 1)),
  });
  private readonly element = inject<ElementRef<HTMLTextAreaElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private signature = "";

  constructor() {
    afterEveryRender(() => this.resize());
    if (typeof ResizeObserver !== "undefined") {
      const observer = this.zone.runOutsideAngular(() => {
        const observer = new ResizeObserver(() => this.resize());
        observer.observe(this.element);
        return observer;
      });
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
    this.element.ownerDocument.fonts?.ready.then(() => {
      if (!this.destroyRef.destroyed) { this.signature = ""; this.resize(); }
    });
  }

  resize(): void {
    const element = this.element;
    const view = element.ownerDocument.defaultView;
    const width = element.getBoundingClientRect().width;
    if (!view || !width) return;
    const style = view.getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    const signature = JSON.stringify([element.value, width, style.font, style.lineHeight, style.letterSpacing, style.padding, style.borderWidth, style.boxSizing, this.spareLines()]);
    if (signature === this.signature) return;
    this.signature = signature;

    // Offscreen measurement avoids collapsing the live field and moving scroll position.
    const mirror = element.cloneNode(false) as HTMLTextAreaElement;
    mirror.removeAttribute("id");
    mirror.removeAttribute("name");
    mirror.setAttribute("aria-hidden", "true");
    mirror.tabIndex = -1;
    mirror.placeholder = "";
    mirror.value = element.value;
    Object.assign(mirror.style, {
      position: "fixed", left: "-10000px", top: "0", visibility: "hidden", pointerEvents: "none",
      width: `${width}px`, height: "0", minHeight: "0", maxHeight: "none", boxSizing: "border-box",
      overflow: "hidden", resize: "none", padding: style.padding, border: style.border,
      font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
      whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak,
    });
    element.ownerDocument.body.appendChild(mirror);
    try {
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      const lines = Math.max(1, Math.round((mirror.scrollHeight - padding) / lineHeight));
      const contentHeight = (lines + this.spareLines()) * lineHeight;
      const height = contentHeight + (style.boxSizing === "border-box" ? padding + border : 0);
      element.style.height = `${Math.ceil(height)}px`;
    } finally { mirror.remove(); }
  }
}
