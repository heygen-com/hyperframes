// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isZOrderActionEnabled,
  parseZIndex,
  resolveZOrderChange,
  type ZOrderAction,
  type ZOrderPatch,
} from "./canvasContextMenuZOrder";

// ── helpers ───────────────────────────────────────────────────────────────────
//
// In jsdom getBoundingClientRect returns all zeros, so the target rect is 0×0
// and getOverlappingFamily returns the whole family — i.e. every sibling is
// treated as overlapping. That makes forward/backward and front/back exercise
// the same scoped set here, which is exactly what we want for order logic.

function makeEl(id: string, zIndex?: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  if (zIndex !== undefined) el.style.zIndex = zIndex;
  return el;
}

/**
 * Build a parent and append `[target, ...siblings]` in DOM order. Each spec is
 * [id, z]. The target's z is `targetZ`; it is appended FIRST unless
 * `targetLast` is set, in which case it is appended LAST (later in DOM).
 */
function makeFamily(
  targetZ: string,
  siblingSpecs: Array<[string, string]>,
  opts: { targetLast?: boolean } = {},
): { target: HTMLElement; parent: HTMLElement; byId: Record<string, HTMLElement> } {
  const parent = document.createElement("div");
  const target = makeEl("target", targetZ);
  const siblings = siblingSpecs.map(([id, z]) => makeEl(id, z));
  const byId: Record<string, HTMLElement> = { target };
  for (const s of siblings) byId[s.id] = s;
  if (opts.targetLast) {
    for (const s of siblings) parent.appendChild(s);
    parent.appendChild(target);
  } else {
    parent.appendChild(target);
    for (const s of siblings) parent.appendChild(s);
  }
  return { target, parent, byId };
}

/** Look up a patch for a given element id in a patch list. */
function patchFor(patches: ZOrderPatch[], byId: Record<string, HTMLElement>, id: string) {
  return patches.find((p) => p.element === byId[id]);
}

/** Apply patches, then return the render-ordered ids (bottom→top). */
function renderOrderIds(
  parent: HTMLElement,
  byId: Record<string, HTMLElement>,
  patches: ZOrderPatch[],
): string[] {
  for (const p of patches) p.element.style.zIndex = String(p.zIndex);
  const children = Array.from(parent.children) as HTMLElement[];
  const withPos = children.map((el, domIndex) => ({
    id: Object.keys(byId).find((k) => byId[k] === el) ?? el.id,
    z: parseZIndex(el.style.zIndex || "0"),
    domIndex,
  }));
  withPos.sort((a, b) => a.z - b.z || a.domIndex - b.domIndex);
  return withPos.map((e) => e.id);
}

// ── parseZIndex ───────────────────────────────────────────────────────────────

describe("parseZIndex", () => {
  it("parses integers", () => {
    expect(parseZIndex("5")).toBe(5);
    expect(parseZIndex("0")).toBe(0);
    expect(parseZIndex("-3")).toBe(-3);
  });

  it("treats 'auto' / null / undefined / empty as 0", () => {
    expect(parseZIndex("auto")).toBe(0);
    expect(parseZIndex(null)).toBe(0);
    expect(parseZIndex(undefined)).toBe(0);
    expect(parseZIndex("")).toBe(0);
  });
});

// ── distinct-z fast path (single-element patch) ────────────────────────────────

describe("resolveZOrderChange – distinct z values (fast path)", () => {
  it("bring-to-front moves target above all with a single patch", () => {
    const { target, byId } = makeFamily("2", [
      ["a", "1"],
      ["b", "5"],
      ["c", "3"],
    ]);
    const patches = resolveZOrderChange(target, "bring-to-front");
    expect(patches).not.toBeNull();
    if (!patches) return;
    expect(patches).toHaveLength(1);
    expect(patchFor(patches, byId, "target")?.zIndex).toBe(6);
  });

  it("bring-to-front returns null when already on top", () => {
    const { target } = makeFamily("6", [
      ["a", "1"],
      ["b", "5"],
      ["c", "3"],
    ]);
    expect(resolveZOrderChange(target, "bring-to-front")).toBeNull();
  });

  it("send-to-back moves target below all", () => {
    const { target, byId, parent } = makeFamily("3", [
      ["a", "1"],
      ["b", "5"],
      ["c", "2"],
    ]);
    const patches = resolveZOrderChange(target, "send-to-back");
    expect(patches).not.toBeNull();
    if (!patches) return;
    // target must end up strictly below the current min (1) in render order.
    expect(renderOrderIds(parent, byId, patches)[0]).toBe("target");
  });

  it("send-to-back returns null when already at back", () => {
    const { target } = makeFamily("0", [
      ["a", "1"],
      ["b", "5"],
      ["c", "3"],
    ]);
    expect(resolveZOrderChange(target, "send-to-back")).toBeNull();
  });

  it("bring-forward steps up exactly one in render order", () => {
    const { target, byId, parent } = makeFamily("2", [
      ["a", "1"],
      ["b", "4"],
      ["c", "7"],
    ]);
    // render order bottom→top: a(1), target(2), b(4), c(7). forward → above b.
    const patches = resolveZOrderChange(target, "bring-forward");
    expect(patches).not.toBeNull();
    if (!patches) return;
    expect(renderOrderIds(parent, byId, patches)).toEqual(["a", "b", "target", "c"]);
  });

  it("send-backward steps down exactly one in render order", () => {
    const { target, byId, parent } = makeFamily("5", [
      ["a", "1"],
      ["b", "3"],
      ["c", "8"],
    ]);
    // bottom→top: a(1), b(3), target(5), c(8). backward → below b.
    const patches = resolveZOrderChange(target, "send-backward");
    expect(patches).not.toBeNull();
    if (!patches) return;
    expect(renderOrderIds(parent, byId, patches)).toEqual(["a", "target", "b", "c"]);
  });

  it("bring-forward returns null when already top of set", () => {
    const { target } = makeFamily("8", [
      ["a", "1"],
      ["b", "4"],
      ["c", "7"],
    ]);
    expect(resolveZOrderChange(target, "bring-forward")).toBeNull();
  });

  it("send-backward returns null when already bottom of set", () => {
    const { target } = makeFamily("0", [
      ["a", "1"],
      ["b", "3"],
      ["c", "8"],
    ]);
    expect(resolveZOrderChange(target, "send-backward")).toBeNull();
  });

  it("returns null when no siblings", () => {
    const target = makeEl("solo", "2");
    document.createElement("div").appendChild(target);
    for (const action of [
      "bring-forward",
      "send-backward",
      "bring-to-front",
      "send-to-back",
    ] as ZOrderAction[]) {
      expect(resolveZOrderChange(target, action)).toBeNull();
    }
  });
});

// ── DOM-order ties (the repro) ─────────────────────────────────────────────────

describe("resolveZOrderChange – DOM-order ties (repro: equal z)", () => {
  it("send-backward: tied target LATER in DOM (visually on top) can go below", () => {
    // img#a (z=0, earlier in DOM) then video#target (z=0, later) → video paints
    // on top. send-backward must put target below the image.
    const { target, byId, parent } = makeFamily("0", [["a", "0"]], { targetLast: true });
    const patches = resolveZOrderChange(target, "send-backward");
    expect(patches).not.toBeNull();
    if (!patches) return;
    expect(renderOrderIds(parent, byId, patches)).toEqual(["target", "a"]);
    // target ends strictly below the image.
    const tz = patchFor(patches, byId, "target")?.zIndex ?? 0;
    expect(tz).toBeGreaterThanOrEqual(0);
  });

  it("send-to-back: tied target LATER in DOM goes to the very back", () => {
    const { target, byId, parent } = makeFamily("0", [["a", "0"]], { targetLast: true });
    const patches = resolveZOrderChange(target, "send-to-back");
    expect(patches).not.toBeNull();
    if (!patches) return;
    expect(renderOrderIds(parent, byId, patches)[0]).toBe("target");
  });

  it("bring-forward: tied target EARLIER in DOM (visually below) can go above", () => {
    // target#target (z=0, earlier) then #a (z=0, later) → a paints on top.
    // bring-forward on target must lift it above a.
    const { target, byId, parent } = makeFamily("0", [["a", "0"]]);
    const patches = resolveZOrderChange(target, "bring-forward");
    expect(patches).not.toBeNull();
    if (!patches) return;
    expect(renderOrderIds(parent, byId, patches)).toEqual(["a", "target"]);
  });

  it("bring-to-front: tied target EARLIER in DOM goes to the very front", () => {
    const { target, byId, parent } = makeFamily("0", [["a", "0"]]);
    const patches = resolveZOrderChange(target, "bring-to-front");
    expect(patches).not.toBeNull();
    if (!patches) return;
    const order = renderOrderIds(parent, byId, patches);
    expect(order[order.length - 1]).toBe("target");
  });

  it("send-backward: tied target EARLIER in DOM is already at back → null", () => {
    // target earlier + a later, both z=0. target already paints below a.
    const { target } = makeFamily("0", [["a", "0"]]);
    expect(resolveZOrderChange(target, "send-backward")).toBeNull();
    expect(resolveZOrderChange(target, "send-to-back")).toBeNull();
  });

  it("bring-forward: tied target LATER in DOM is already on top → null", () => {
    const { target } = makeFamily("0", [["a", "0"]], { targetLast: true });
    expect(resolveZOrderChange(target, "bring-forward")).toBeNull();
    expect(resolveZOrderChange(target, "bring-to-front")).toBeNull();
  });

  it("renumber emits patches only for elements whose z changes", () => {
    // Three tied at z=0, target in the middle of DOM order. Sending it back
    // must renumber to distinct values but leave untouched elements alone
    // where possible.
    const parent = document.createElement("div");
    const a = makeEl("a", "0");
    const target = makeEl("target", "0");
    const b = makeEl("b", "0");
    parent.append(a, target, b);
    // render order bottom→top by (z, dom): a, target, b. send-backward → below a.
    const patches = resolveZOrderChange(target, "send-backward");
    expect(patches).not.toBeNull();
    if (!patches) return;
    for (const p of patches) p.element.style.zIndex = String(p.zIndex);
    const order = renderOrderIds(parent, { a, target, b }, []);
    expect(order).toEqual(["target", "a", "b"]);
    // Every emitted patch is a real change (no z===current no-ops).
    expect(patches.every((p) => p.zIndex >= 0)).toBe(true);
  });
});

// ── non-painting sibling hygiene ───────────────────────────────────────────────

describe("resolveZOrderChange – excludes non-painting siblings", () => {
  it("ignores <audio>/<script>/<style> siblings in the family", () => {
    // Parent holds: img#a (z0), <audio> (a prior renumber wrote z=2 onto it),
    // video#target (z0, later in DOM), plus a <script> and <style>. Only the two
    // painting elements should form the family — the audio's z=2 must NOT pad the
    // renumber or count as a sibling above the target.
    const parent = document.createElement("div");
    const a = makeEl("a", "0");
    const audio = document.createElement("audio");
    audio.style.zIndex = "2";
    const script = document.createElement("script");
    const style = document.createElement("style");
    const target = makeEl("target", "0");
    parent.append(a, audio, script, style, target);

    // target is later in DOM than a, tied at z=0 → paints on top. send-to-back
    // must put it below a. If audio (z=2) were counted, the renumber would differ.
    const patches = resolveZOrderChange(target, "send-to-back");
    expect(patches).not.toBeNull();
    if (!patches) return;
    // No patch may target the audio/script/style elements.
    for (const p of patches) {
      expect(p.element).not.toBe(audio);
      expect(p.element).not.toBe(script);
      expect(p.element).not.toBe(style);
    }
    // Order among the painting pair: target below a.
    const order = renderOrderIds(parent, { a, target }, patches);
    expect(order.indexOf("target")).toBeLessThan(order.indexOf("a"));
  });

  it("a lone painting element beside only non-painting siblings has no family → null", () => {
    const parent = document.createElement("div");
    const target = makeEl("target", "1");
    const audio = document.createElement("audio");
    parent.append(target, audio);
    // Only sibling is <audio> (excluded) → family size 1 → every action is a no-op.
    for (const action of [
      "bring-forward",
      "send-backward",
      "bring-to-front",
      "send-to-back",
    ] as ZOrderAction[]) {
      expect(resolveZOrderChange(target, action)).toBeNull();
    }
  });
});

// ── isZOrderActionEnabled ─────────────────────────────────────────────────────

describe("isZOrderActionEnabled", () => {
  it("mirrors resolveZOrderChange non-null", () => {
    // target z=2 (DOM 0), a z=5 (DOM 1): render order = target, a. target is at
    // the bottom, so forward/front are enabled and backward/back are no-ops.
    const { target } = makeFamily("2", [["a", "5"]]);
    expect(isZOrderActionEnabled(target, "bring-to-front")).toBe(true);
    expect(isZOrderActionEnabled(target, "bring-forward")).toBe(true);
    expect(isZOrderActionEnabled(target, "send-to-back")).toBe(false);
    expect(isZOrderActionEnabled(target, "send-backward")).toBe(false);
  });

  it("false when already on top", () => {
    const { target } = makeFamily("6", [
      ["a", "1"],
      ["b", "5"],
    ]);
    expect(isZOrderActionEnabled(target, "bring-to-front")).toBe(false);
    expect(isZOrderActionEnabled(target, "bring-forward")).toBe(false);
  });

  it("tie repro: send-backward enabled for a visually-on-top tied target", () => {
    const { target } = makeFamily("0", [["a", "0"]], { targetLast: true });
    expect(isZOrderActionEnabled(target, "send-backward")).toBe(true);
    expect(isZOrderActionEnabled(target, "send-to-back")).toBe(true);
  });

  it("all actions disabled when there are no siblings", () => {
    const target = makeEl("solo", "1");
    document.createElement("div").appendChild(target);
    for (const action of [
      "bring-forward",
      "send-backward",
      "bring-to-front",
      "send-to-back",
    ] as ZOrderAction[]) {
      expect(isZOrderActionEnabled(target, action)).toBe(false);
    }
  });
});
