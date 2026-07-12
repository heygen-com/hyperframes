// fallow-ignore-file code-duplication
/**
 * T10 — PreviewAdapter contract (spec for R7).
 *
 * Converted from it.todo stubs. These tests FAIL until Task 3 implements
 * createPreviewAdapter in ./previewAdapter.ts.
 *
 * Position resolution: elementFromPoint is always null in jsdom. All
 * elementAtPoint tests inject a resolvePoint stub so the contract tested
 * is filtering logic (root exclusion, data-hf-id ancestor walk,
 * opacity-at-playhead), not geometry.
 *
 * CSS custom property names used below mirror the Studio constants from
 * manualEditsTypes.ts — they will be shared with the PreviewAdapter
 * implementation once the draft-marker module moves to core (Task 4).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createPreviewAdapter } from "./previewAdapter.js";

// ── DOM helpers ────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Create + append an element to body; optionally set attrs and inline styles. */
function make(
  tag: string,
  attrs: Record<string, string> = {},
  styles: Record<string, string> = {},
): HTMLElement {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) elem.setAttribute(k, v);
  for (const [k, v] of Object.entries(styles)) elem.style.setProperty(k, v);
  document.body.appendChild(elem);
  return elem;
}

function adapterWith(resolvePoint: (x: number, y: number) => Element | null) {
  return createPreviewAdapter(document, { resolvePoint });
}

// ── elementAtPoint ─────────────────────────────────────────────────────────

describe("T10 — PreviewAdapter contract (spec for R7)", () => {
  describe("elementAtPoint", () => {
    it("returns null for the stage root (data-hf-root)", () => {
      const root = make("div", { "data-hf-root": "true" });
      const adapter = adapterWith(() => root);
      expect(adapter.elementAtPoint(0, 0)).toBeNull();
    });

    it("returns the nearest ancestor with data-hf-id", () => {
      const parent = make("div", { "data-hf-id": "hf-abcd" });
      const child = document.createElement("span");
      parent.appendChild(child);
      const adapter = adapterWith(() => child);
      expect(adapter.elementAtPoint(0, 0)).toBe(parent);
    });

    it("returns null when the hit element has no data-hf-id ancestor", () => {
      const orphan = make("div");
      const adapter = adapterWith(() => orphan);
      expect(adapter.elementAtPoint(0, 0)).toBeNull();
    });

    it("skips elements whose currently-computed opacity is 0 (atTime is a caller-seek hint, not evaluated by the adapter)", () => {
      const elem = make("div", { "data-hf-id": "hf-zzzz" }, { opacity: "0" });
      const adapter = adapterWith(() => elem);
      expect(adapter.elementAtPoint(0, 0, { atTime: 1.0 })).toBeNull();
    });

    it("returns null for nested data-hf-root without data-hf-id (treated same as outer stage root)", () => {
      const outerRoot = make("div", { "data-hf-root": "true" });
      const innerRoot = document.createElement("div");
      innerRoot.setAttribute("data-hf-root", "true");
      // no data-hf-id — no explicit id means no draggable target
      outerRoot.appendChild(innerRoot);
      const adapter = adapterWith(() => innerRoot);
      expect(adapter.elementAtPoint(0, 0)).toBeNull();
    });
  });

  // ── applyDraft / revertDraft ───────────────────────────────────────────

  describe("applyDraft / revertDraft", () => {
    it("applyDraft writes --hf-studio-* CSS props and sets the gesture marker", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 20 });
      expect(target.style.getPropertyValue("--hf-studio-offset-x")).not.toBe("");
      expect(target.hasAttribute("data-hf-studio-manual-edit-gesture")).toBe(true);
    });

    it("applyDraft accepts a move payload (dx/dy) and writes the translate draft", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 30, dy: 15 });
      expect(target.style.getPropertyValue("--hf-studio-offset-x")).toBe("30px");
      expect(target.style.getPropertyValue("--hf-studio-offset-y")).toBe("15px");
    });

    it("applyDraft accepts a resize payload (w/h) and writes the size draft", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "resize", hfId: "hf-aaaa", w: 200, h: 100 });
      expect(target.style.getPropertyValue("--hf-studio-width")).toBe("200px");
      expect(target.style.getPropertyValue("--hf-studio-height")).toBe("100px");
    });

    it("revertDraft removes draft props and clears the gesture marker", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 20 });
      adapter.revertDraft();
      expect(target.style.getPropertyValue("--hf-studio-offset-x")).toBe("");
      expect(target.style.getPropertyValue("--hf-studio-offset-y")).toBe("");
      expect(target.hasAttribute("data-hf-studio-manual-edit-gesture")).toBe(false);
    });

    it("revertDraft restores original translate when an original was recorded", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      target.style.setProperty("translate", "50px 0px");
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 0 });
      adapter.revertDraft();
      expect(target.style.getPropertyValue("translate")).toBe("50px 0px");
    });
  });

  // ── edge cases ─────────────────────────────────────────────────────────

  describe("applyDraft edge cases (R7 implementation contract)", () => {
    it("second applyDraft before revert/commit overwrites first draft — does not accumulate (dx/dy)", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 20 });
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 5, dy: 15 });
      expect(target.style.getPropertyValue("--hf-studio-offset-x")).toBe("5px");
      expect(target.style.getPropertyValue("--hf-studio-offset-y")).toBe("15px");
    });

    it("resize → move switch clears width/height props — no cross-type prop leak", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "resize", hfId: "hf-aaaa", w: 200, h: 100 });
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 5 });
      // move props set
      expect(target.style.getPropertyValue("--hf-studio-offset-x")).toBe("10px");
      expect(target.style.getPropertyValue("--hf-studio-offset-y")).toBe("5px");
      // resize props cleared by the auto-revert before re-apply
      expect(target.style.getPropertyValue("--hf-studio-width")).toBe("");
      expect(target.style.getPropertyValue("--hf-studio-height")).toBe("");
    });

    it("revertDraft after commitPreview is a no-op — does not restore stale translate", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      target.style.setProperty("translate", "50px 0px");
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 0 });
      adapter.commitPreview();
      // simulate caller applying translate after commit
      target.style.setProperty("translate", "10px 0px");
      adapter.revertDraft(); // no gesture in flight — should be no-op
      expect(target.style.getPropertyValue("translate")).toBe("10px 0px");
    });

    it("revertDraft is safe to call when no gesture is in progress (idempotent / no-op on empty marker)", () => {
      const adapter = adapterWith(() => null);
      expect(() => adapter.revertDraft()).not.toThrow();
      expect(() => adapter.revertDraft()).not.toThrow();
    });

    it("elementAtPoint filtering is stable when inline opacity changes mid-drag — computed style re-evaluated per call", () => {
      const elem = make("div", { "data-hf-id": "hf-zzzz" });
      const adapter = adapterWith(() => elem);
      expect(adapter.elementAtPoint(0, 0)).toBe(elem);
      // simulates GSAP seeking to a time where the element is hidden
      elem.style.setProperty("opacity", "0");
      expect(adapter.elementAtPoint(0, 0)).toBeNull();
    });

    it("stage-root exclusion applies only to the outermost data-hf-root; nested sub-composition roots count as targets", () => {
      const outerRoot = make("div", { "data-hf-root": "true" });
      const innerRoot = document.createElement("div");
      innerRoot.setAttribute("data-hf-root", "true");
      innerRoot.setAttribute("data-hf-id", "hf-sub1");
      outerRoot.appendChild(innerRoot);

      const adapterOuter = adapterWith(() => outerRoot);
      expect(adapterOuter.elementAtPoint(0, 0)).toBeNull();

      const adapterInner = adapterWith(() => innerRoot);
      expect(adapterInner.elementAtPoint(0, 0)).toBe(innerRoot);
    });
  });

  // ── commitPreview ──────────────────────────────────────────────────────

  describe("commitPreview", () => {
    it("returns null when no gesture marker is present", () => {
      const adapter = adapterWith(() => null);
      expect(adapter.commitPreview()).toBeNull();
    });

    it("derives a moveElement patch from draft markers on commit", () => {
      make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 30, dy: 15 });
      const patch = adapter.commitPreview();
      expect(patch).toEqual({ type: "moveElement", hfId: "hf-aaaa", dx: 30, dy: 15 });
    });

    it("derives a resize patch from draft markers on commit", () => {
      make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "resize", hfId: "hf-aaaa", w: 200, h: 100 });
      const patch = adapter.commitPreview();
      expect(patch).toEqual({ type: "resize", hfId: "hf-aaaa", width: 200, height: 100 });
    });

    it("clears the gesture marker after commit", () => {
      const target = make("div", { "data-hf-id": "hf-aaaa" });
      const adapter = adapterWith(() => null);
      adapter.applyDraft({ type: "move", hfId: "hf-aaaa", dx: 10, dy: 0 });
      adapter.commitPreview();
      expect(target.hasAttribute("data-hf-studio-manual-edit-gesture")).toBe(false);
    });
  });

  // ── getElementTimings ──────────────────────────────────────────────────

  describe("getElementTimings", () => {
    it("reads authored absolute times from data-start / data-end", () => {
      make("div", { "data-hf-id": "hf-t1", "data-start": "0.5", "data-end": "2.0" });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(timings["hf-t1"]).toEqual({ start: 0.5, end: 2.0 });
    });

    it("ignores elements without data-hf-id", () => {
      make("div", { "data-start": "0.5", "data-end": "2.0" }); // no data-hf-id
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(Object.keys(timings)).toHaveLength(0);
    });

    it("returns a defined timing entry when data-hf-id is present but data-start / data-end are missing", () => {
      make("div", { "data-hf-id": "hf-notimed" });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(timings["hf-notimed"]).toBeDefined();
      expect(timings["hf-notimed"].start).toBeUndefined();
      expect(timings["hf-notimed"].end).toBeUndefined();
    });

    it("resolves data-duration into end when there is no data-end (never worked before)", () => {
      make("div", { "data-hf-id": "hf-t1", "data-start": "1", "data-duration": "3" });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(timings["hf-t1"]).toEqual({ start: 1, end: 4 });
    });

    it("resolves a relative data-start reference ('ref + offset') instead of returning undefined", () => {
      make("div", { "data-hf-id": "hf-intro", "data-start": "1", "data-duration": "3" });
      make("div", { "data-hf-id": "hf-outro", "data-start": "hf-intro + 2", "data-duration": "1" });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      // hf-intro ends at 4 (1 + 3); hf-outro starts 2s after that = 6.
      expect(timings["hf-outro"]).toEqual({ start: 6, end: 7 });
    });

    it("resolves a bare reference (no offset) to the referenced element's end", () => {
      make("div", { "data-hf-id": "hf-intro", "data-start": "1", "data-end": "4" });
      make("div", {
        "data-hf-id": "hf-right-after",
        "data-start": "hf-intro",
        "data-duration": "1",
      });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(timings["hf-right-after"]).toEqual({ start: 4, end: 5 });
    });

    it("returns undefined start (not NaN) when the reference target doesn't exist", () => {
      make("div", {
        "data-hf-id": "hf-orphan",
        "data-start": "hf-nonexistent + 5",
        "data-duration": "2",
      });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(timings["hf-orphan"].start).toBeUndefined();
    });

    it("returns undefined start when the reference target exists but its own timing is unresolvable", () => {
      make("div", { "data-hf-id": "hf-untimed" }); // no data-end, no data-duration
      make("div", {
        "data-hf-id": "hf-outro",
        "data-start": "hf-untimed + 2",
        "data-duration": "1",
      });
      const adapter = adapterWith(() => null);
      const timings = adapter.getElementTimings();
      expect(timings["hf-outro"].start).toBeUndefined();
    });

    it("terminates (not an infinite loop) on a mutual A <-> B reference cycle", () => {
      make("div", { "data-hf-id": "hf-a", "data-start": "hf-b", "data-duration": "2" });
      make("div", { "data-hf-id": "hf-b", "data-start": "hf-a", "data-duration": "3" });
      const adapter = adapterWith(() => null);
      // Unlike the SDK's static resolver (which fails safe to 0 and lets real
      // durations propagate outward into arbitrary-but-finite numbers), this
      // simpler resolver has no 0-fallback — an unresolvable `sv` poisons
      // `resolveEnd` (it requires a finite start to add duration), so the whole
      // cycle correctly reports "no defined timing" rather than a fabricated
      // number. The guard's job is just termination; this call must return
      // synchronously instead of hanging.
      const timings = adapter.getElementTimings();
      expect(timings["hf-a"].start).toBeUndefined();
      expect(timings["hf-b"].start).toBeUndefined();
    });
  });
});
