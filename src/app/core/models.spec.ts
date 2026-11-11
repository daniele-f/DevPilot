import { describe, expect, it } from "vitest";
import { validateItem, validateName, visibleItems } from "./models";

describe("backlog rules", () => {
  it("normalizes titles and rejects blank or oversized titles", () => {
    expect(validateName("  Ship it  ", 200)).toBe("Ship it");
    expect(() => validateName("   ", 200)).toThrow("required");
    expect(() => validateName("x".repeat(201), 200)).toThrow("200");
  });
  it("validates all editable item fields", () => {
    expect(
      validateItem({
        title: " Idea ",
        description: "Details",
        type: "idea",
        priority: "medium",
        status: "ideas",
      }).title,
    ).toBe("Idea");
    expect(() =>
      validateItem({
        title: "Idea",
        description: "",
        type: "other" as never,
        priority: "medium",
        status: "ideas",
      }),
    ).toThrow();
    expect(() =>
      validateItem({
        title: "Idea",
        description: "x".repeat(20001),
        type: "idea",
        priority: "medium",
        status: "ideas",
      }),
    ).toThrow();
  });
  it("keeps archive separate and searches title and description", () => {
    const items = [
      {
        id: "1",
        title: "Login",
        description: "Email authentication",
        archived_at: null,
      },
      {
        id: "2",
        title: "Old idea",
        description: "",
        archived_at: "2026-01-01",
      },
    ] as never[];
    expect(visibleItems(items, false, "EMAIL").map((i) => i.id)).toEqual(["1"]);
    expect(visibleItems(items, true, "").map((i) => i.id)).toEqual(["2"]);
  });
});
