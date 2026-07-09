// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isZOrderActionEnabled, parseZIndex, resolveZOrderChange } from "./canvasContextMenuZOrder";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEl(zIndex?: string): HTMLElement {
  const el = document.createElement("div");
  if (zIndex !== undefined) el.style.zIndex = zIndex;
  return el;
}

/** Build a parent with `target` and a set of siblings, all appended in order. */
function makeFamily(
  targetZ: string,
  siblingZs: string[],
): { target: HTMLElement; siblings: HTMLElement[]; parent: HTMLElement } {
  const parent = document.createElement("div");
  const target = makeEl(targetZ);
  const siblings = siblingZs.map(makeEl);
  parent.appendChild(target);
  for (const s of siblings) parent.appendChild(s);
  return { target, siblings, parent };
}

// ── parseZIndex ───────────────────────────────────────────────────────────────

describe("parseZIndex", () => {
  it("parses integers", () => {
    expect(parseZIndex("5")).toBe(5);
    expect(parseZIndex("0")).toBe(0);
    expect(parseZIndex("-3")).toBe(-3);
  });

  it("treats 'auto' as 0", () => {
    expect(parseZIndex("auto")).toBe(0);
  });

  it("treats null / undefined as 0", () => {
    expect(parseZIndex(null)).toBe(0);
    expect(parseZIndex(undefined)).toBe(0);
    expect(parseZIndex("")).toBe(0);
  });
});

// ── resolveZOrderChange ───────────────────────────────────────────────────────

describe("resolveZOrderChange – bring-to-front / send-to-back", () => {
  it("bring-to-front returns max+1", () => {
    const { target } = makeFamily("2", ["1", "5", "3"]);
    expect(resolveZOrderChange(target, "bring-to-front")).toBe(6);
  });

  it("bring-to-front returns null when already on top", () => {
    const { target } = makeFamily("6", ["1", "5", "3"]);
    expect(resolveZOrderChange(target, "bring-to-front")).toBeNull();
  });

  it("send-to-back returns max(0, min-1)", () => {
    const { target } = makeFamily("3", ["1", "5", "2"]);
    expect(resolveZOrderChange(target, "send-to-back")).toBe(0);
  });

  it("send-to-back returns null when already at back", () => {
    const { target } = makeFamily("0", ["1", "5", "3"]);
    expect(resolveZOrderChange(target, "send-to-back")).toBeNull();
  });

  it("returns null when no siblings", () => {
    const target = makeEl("2");
    document.createElement("div").appendChild(target);
    expect(resolveZOrderChange(target, "bring-to-front")).toBeNull();
    expect(resolveZOrderChange(target, "send-to-back")).toBeNull();
  });
});

describe("resolveZOrderChange – bring-forward / send-backward (overlapping siblings)", () => {
  // In jsdom getBoundingClientRect returns all zeros → every rect "overlaps"
  // with every other rect (all are 0×0 at 0,0), so the overlapping set is all
  // siblings. This makes it a clean proxy for the overlap path.

  it("bring-forward finds min z-index strictly above target, returns it +1", () => {
    const { target } = makeFamily("2", ["1", "4", "7"]);
    // above target (z>2): 4, 7 → min = 4 → 4+1 = 5
    expect(resolveZOrderChange(target, "bring-forward")).toBe(5);
  });

  it("bring-forward returns null when already on top of all overlapping siblings", () => {
    const { target } = makeFamily("8", ["1", "4", "7"]);
    expect(resolveZOrderChange(target, "bring-forward")).toBeNull();
  });

  it("send-backward finds max z-index strictly below target, returns max(0, it-1)", () => {
    const { target } = makeFamily("5", ["1", "3", "8"]);
    // below target (z<5): 1, 3 → max = 3 → max(0, 3-1) = 2
    expect(resolveZOrderChange(target, "send-backward")).toBe(2);
  });

  it("send-backward returns null when already behind all overlapping siblings", () => {
    const { target } = makeFamily("0", ["1", "3", "8"]);
    expect(resolveZOrderChange(target, "send-backward")).toBeNull();
  });

  it("send-backward floors at 0", () => {
    const { target } = makeFamily("1", ["3", "5"]);
    // below target: none with z<1 — wait, 1 > 0. siblings are 3 and 5, both above.
    // So send-backward: below = [] → null.
    expect(resolveZOrderChange(target, "send-backward")).toBeNull();
  });

  it("send-backward with below sibling at z=0 returns 0 (already 0, floor)", () => {
    const { target } = makeFamily("2", ["0", "5"]);
    // below: z=0 → max=0 → max(0, 0-1) = max(0,-1) = 0
    expect(resolveZOrderChange(target, "send-backward")).toBe(0);
  });
});

// ── isZOrderActionEnabled ─────────────────────────────────────────────────────

describe("isZOrderActionEnabled", () => {
  it("returns true when action produces a new z-index", () => {
    const { target } = makeFamily("2", ["5"]);
    expect(isZOrderActionEnabled(target, "bring-to-front")).toBe(true);
    expect(isZOrderActionEnabled(target, "bring-forward")).toBe(true);
  });

  it("returns false when action is a no-op", () => {
    const { target } = makeFamily("6", ["1", "5"]);
    // already on top
    expect(isZOrderActionEnabled(target, "bring-to-front")).toBe(false);
    expect(isZOrderActionEnabled(target, "bring-forward")).toBe(false);
  });

  it("all actions disabled when there are no siblings", () => {
    const target = makeEl("1");
    document.createElement("div").appendChild(target);
    for (const action of [
      "bring-forward",
      "send-backward",
      "bring-to-front",
      "send-to-back",
    ] as const) {
      expect(isZOrderActionEnabled(target, action)).toBe(false);
    }
  });
});
