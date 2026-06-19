/**
 * WS-C — getElementTimings / setElementTiming / setHold tests.
 *
 * Tests the session-layer wiring for the new typed methods.
 * happy-dom can't do GSAP seek/layout so we test DOM attribute reads and
 * dispatch behavior directly.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Duration-authored clip (data-duration preferred by handleSetTiming). */
const DURATION_AUTHORED_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <h1 data-hf-id="hf-title" data-start="0" data-duration="3">Hello</h1>
  <p  data-hf-id="hf-sub"   data-start="2" data-duration="2">World</p>
</div>
`.trim();

/** End-authored clip (data-end only, no data-duration). */
const END_AUTHORED_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <h1 data-hf-id="hf-title" data-start="1" data-end="4">Hello</h1>
</div>
`.trim();

/** Both data-duration and data-end (data-duration wins). */
const BOTH_ATTRS_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px" data-duration="10">
  <h1 data-hf-id="hf-title" data-start="0" data-duration="3" data-end="99">Hello</h1>
</div>
`.trim();

/** Has a GSAP script with addLabel. */
const GSAP_LABEL_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-box" data-start="0" data-duration="5" style="opacity:0"></div>
  <script>var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 1 }, 0);
tl.addLabel("intro", 0.5);
tl.addLabel("outro", 4.0);
window.__timelines = { t: tl };</script>
</div>
`.trim();

// ─── getElementTimings — duration-authored clips ──────────────────────────────

describe("getElementTimings — duration-authored clips", () => {
  it("reads enterAt = data-start, exitAt = data-start + data-duration", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);
    const timings = comp.getElementTimings();

    expect(timings["hf-title"]).toMatchObject({ enterAt: 0, exitAt: 3 });
    expect(timings["hf-sub"]).toMatchObject({ enterAt: 2, exitAt: 4 });
  });

  it("returns empty labels array when no GSAP script", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);
    const timings = comp.getElementTimings();
    expect(timings["hf-title"]?.labels).toEqual([]);
  });
});

// ─── getElementTimings — end-authored clips ───────────────────────────────────

describe("getElementTimings — end-authored clips", () => {
  it("falls back to data-end − data-start when no data-duration", async () => {
    const comp = await openComposition(END_AUTHORED_HTML);
    const timings = comp.getElementTimings();

    // enterAt = 1, exitAt = 4 (from data-end = 4, data-start = 1, duration = 3)
    expect(timings["hf-title"]).toMatchObject({ enterAt: 1, exitAt: 4 });
  });
});

// ─── getElementTimings — data-duration wins over data-end ────────────────────

describe("getElementTimings — data-duration wins over data-end", () => {
  it("uses data-duration when both data-duration and data-end are present", async () => {
    const comp = await openComposition(BOTH_ATTRS_HTML);
    const timings = comp.getElementTimings();

    // data-duration=3 wins; exitAt = 0+3=3, NOT from data-end=99
    expect(timings["hf-title"]).toMatchObject({ enterAt: 0, exitAt: 3 });
  });
});

// ─── getElementTimings — labels from GSAP script ─────────────────────────────

describe("getElementTimings — GSAP labels", () => {
  it("returns labels whose position falls within [enterAt, exitAt]", async () => {
    const comp = await openComposition(GSAP_LABEL_HTML);
    const timings = comp.getElementTimings();

    // hf-box: enterAt=0, exitAt=5; labels "intro"@0.5 and "outro"@4.0 are both in range
    const box = timings["hf-box"];
    expect(box?.labels).toContain("intro");
    expect(box?.labels).toContain("outro");
  });

  it("parses labels fresh — no stale cache after mutation", async () => {
    const comp = await openComposition(GSAP_LABEL_HTML);

    const before = comp.getElementTimings()["hf-box"]?.labels ?? [];
    expect(before).toContain("intro");

    // Move the element so timing changes; labels should still parse fresh
    comp.setTiming("hf-box", { start: 0, duration: 5 }); // no-op but triggers re-parse
    const after = comp.getElementTimings()["hf-box"]?.labels ?? [];
    expect(after).toContain("intro");
  });
});

// ─── setElementTiming — sparse map + batched dispatch ────────────────────────

describe("setElementTiming", () => {
  it("applies sparse timing map to multiple elements", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);

    comp.setElementTiming({
      "hf-title": { start: 1, duration: 2 },
      "hf-sub": { start: 4 },
    });

    const timings = comp.getElementTimings();
    expect(timings["hf-title"]).toMatchObject({ enterAt: 1, exitAt: 3 });
    expect(timings["hf-sub"]).toMatchObject({ enterAt: 4 });
  });

  it("emits exactly one patch event for multiple entries (batched)", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);
    const patches: unknown[] = [];
    comp.on("patch", (e) => patches.push(e));

    comp.setElementTiming({
      "hf-title": { start: 0.5 },
      "hf-sub": { start: 3.0 },
    });

    // One batch → one patch event
    expect(patches).toHaveLength(1);
  });

  it("is a no-op for empty map", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);
    const patches: unknown[] = [];
    comp.on("patch", (e) => patches.push(e));

    comp.setElementTiming({});
    expect(patches).toHaveLength(0);
  });

  it("respects data-duration vs data-end preference on write", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);

    // Before: hf-title has data-duration=3, data-start=0
    comp.setElementTiming({ "hf-title": { duration: 5 } });

    const timings = comp.getElementTimings();
    // Should read back the new duration
    expect(timings["hf-title"]).toMatchObject({ exitAt: 5 });
  });

  it("can be undone as a single step", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);

    const before = comp.getElementTimings()["hf-title"];

    comp.setElementTiming({ "hf-title": { start: 2 } });
    comp.undo();

    const after = comp.getElementTimings()["hf-title"];
    expect(after?.enterAt).toBe(before?.enterAt);
  });

  it("setElementTiming inverse restores original timing", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);
    const originalTimings = comp.getElementTimings();

    comp.setElementTiming({
      "hf-title": { start: 10, duration: 1 },
      "hf-sub": { start: 12, duration: 1 },
    });
    comp.undo();

    const restored = comp.getElementTimings();
    expect(restored["hf-title"]).toEqual(originalTimings["hf-title"]);
    expect(restored["hf-sub"]).toEqual(originalTimings["hf-sub"]);
  });
});

// ─── setHold — typed wrapper ──────────────────────────────────────────────────

describe("setHold — typed method", () => {
  it("dispatches the setHold op (regression: existing op unchanged)", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);
    const patches: unknown[] = [];
    comp.on("patch", (e) => patches.push(e));

    comp.setHold("hf-title", { start: 0.5, end: 2.5, fill: "freeze" });

    // Should emit a patch
    expect(patches).toHaveLength(1);
  });

  it("setHold writes data-hold-start / data-hold-end / data-hold-fill attrs", async () => {
    const comp = await openComposition(DURATION_AUTHORED_HTML);

    comp.setHold("hf-title", { start: 1.0, end: 2.0, fill: "loop" });

    // Verify via serialize (attrs are in the HTML output)
    const html = comp.serialize();
    expect(html).toContain('data-hold-start="1"');
    expect(html).toContain('data-hold-end="2"');
    expect(html).toContain('data-hold-fill="loop"');
  });

  it("setHold typed method equals dispatch({type:setHold})", async () => {
    // Run typed method path
    const comp1 = await openComposition(DURATION_AUTHORED_HTML);
    comp1.setHold("hf-title", { start: 0.5, end: 2.5, fill: "freeze" });
    const html1 = comp1.serialize();

    // Run raw dispatch path
    const comp2 = await openComposition(DURATION_AUTHORED_HTML);
    comp2.dispatch({
      type: "setHold",
      target: "hf-title",
      hold: { start: 0.5, end: 2.5, fill: "freeze" },
    });
    const html2 = comp2.serialize();

    expect(html1).toBe(html2);
  });
});
