import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TestBed } from "@angular/core/testing";
import { afterEach, expect, it, vi } from "vitest";
import { TextareaFit } from "./textarea-fit";

@Component({
  imports: [FormsModule, TextareaFit],
  template: `<textarea dpTextareaFit [(ngModel)]="value" style="font-size:16px;line-height:20px;padding:8px;border:1px solid;box-sizing:border-box"></textarea>
  <textarea dpTextareaFit="0" [(ngModel)]="value" style="font-size:16px;line-height:20px;padding:8px;border:1px solid;box-sizing:border-box"></textarea>`,
})
class Example { value = "First\nSecond\nThird"; }

afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

it("uses one spare line by default, exact text height for checklist fields, and shrinks on edits", async () => {
  // jsdom has no layout engine; supply the measurements a browser would return.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 300, 100));
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return this instanceof HTMLTextAreaElement ? Math.max(1, this.value.split("\n").length) * 20 + 16 : 0;
  });
  await TestBed.configureTestingModule({ imports: [Example] }).compileComponents();
  const fixture = TestBed.createComponent(Example);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const textarea = fixture.nativeElement.querySelector("textarea") as HTMLTextAreaElement;
  const checklist = fixture.nativeElement.querySelectorAll("textarea")[1] as HTMLTextAreaElement;
  expect(textarea.style.height).toBe("98px"); // Four lines, 16px padding, 2px border.
  expect(checklist.style.height).toBe("78px"); // Exactly three content lines plus padding/border.
  expect(textarea.style.resize).toBe("none");
  textarea.value = "Short";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  expect(textarea.style.height).toBe("58px");
  fixture.componentInstance.value = "One\nTwo\nThree\nFour";
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(textarea.style.height).toBe("118px");
  expect(checklist.style.height).toBe("98px");
});
