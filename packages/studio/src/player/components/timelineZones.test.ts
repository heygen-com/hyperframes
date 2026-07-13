import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { classifyZone, normalizeToZones } from "./timelineZones";
import { computeStackingPatches, type StackingElement } from "./timelineStackingSync";

function el(id: string, tag: string, track: number, duration = 2): TimelineElement {
  return { id, tag, start: 0, duration, track };
}

function zClip(
  id: string,
  start: number,
  duration: number,
  track: number,
  zIndex: number,
  tag = "video",
): TimelineElement {
  return { id, tag, start, duration, track, zIndex };
}

function trackOf(els: TimelineElement[], id: string): number {
  return els.find((e) => e.id === id)!.track;
}

/** Assert normalizeToZones is idempotent: re-zoning keeps every clip's lane. */
function expectZoningIdempotent(input: TimelineElement[]): void {
  const once = normalizeToZones(input);
  const twice = normalizeToZones(once);
  for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
}

/** The exact qa-clean live repro (array order = DOM order); fresh objects per call. */
function qaCleanRepro(): TimelineElement[] {
  return [
    zClip("blue-logo", 6.37, 3, 0, 3, "img"),
    zClip("ralu", 6.37, 3, 0, 0, "img"),
    zClip("black-logo", 11.92, 3, 1, 1, "img"),
    zClip("video", 0.84, 20, 3, 2, "video"),
  ];
}

describe("classifyZone", () => {
  it("audio → audio; video / image / everything else → visual", () => {
    expect(classifyZone(el("m", "audio", 3))).toBe("audio");
    expect(classifyZone(el("v", "video", 1))).toBe("visual");
    expect(classifyZone(el("i", "img", 0))).toBe("visual");
  });

  it("zone identity invariant: normalizeToZones preserves each clip's zone (mixed input)", () => {
    // normalizeToZones only remaps lanes — it must never reclassify a clip's zone.
    const input = [
      el("v", "video", 0),
      el("a1", "audio", 1),
      el("i", "img", 2),
      el("a2", "audio", 3),
    ];
    const out = normalizeToZones(input);
    for (const e of input) {
      expect(classifyZone(out.find((o) => o.id === e.id)!)).toBe(classifyZone(e));
    }
    // And the partition holds: every visual lane sits above every audio lane.
    const laneOf = (id: string) => trackOf(out, id);
    const maxVisual = Math.max(laneOf("v"), laneOf("i"));
    const minAudio = Math.min(laneOf("a1"), laneOf("a2"));
    expect(maxVisual).toBeLessThan(minAudio);
  });
});

describe("normalizeToZones", () => {
  it("orders visual (top) → audio (bottom); equal-z overlap stacks by DOM order", () => {
    // img and vid are both z=0, start=0 → they OVERLAP in time. CSS paints
    // equal-z siblings by DOM order (later paints on top), so the later-in-array
    // `vid` must own the upper lane. (Was: pinned img=0/vid=1 to authored order,
    // which contradicts the canvas — updated for per-clip DOM-order tie-break.)
    const out = normalizeToZones([
      el("img", "img", 0),
      el("vid", "video", 2),
      el("mus", "audio", 5),
    ]);
    expect(trackOf(out, "vid")).toBe(0); // later in DOM → paints on top → upper lane
    expect(trackOf(out, "img")).toBe(1); // earlier in DOM → below
    expect(trackOf(out, "mus")).toBe(2); // audio (bottom)
  });

  it("keeps all visual lanes together on top; equal-z overlap stacks by DOM order", () => {
    // All three z=0, start=0 → mutually overlapping. DOM order (later on top)
    // decides the stack: v3 (last) top, then i1, then v0. (Was: pinned to authored
    // order v0=0/i1=1/v3=2, which the canvas contradicts for overlapping equal-z.)
    const out = normalizeToZones([el("v0", "video", 0), el("i1", "img", 1), el("v3", "video", 3)]);
    expect(trackOf(out, "v3")).toBe(0);
    expect(trackOf(out, "i1")).toBe(1);
    expect(trackOf(out, "v0")).toBe(2);
  });

  it("drops audio below the visual lanes even when sharing a track index", () => {
    const out = normalizeToZones([el("v", "video", 0), el("a", "audio", 0)]);
    expect(trackOf(out, "v")).toBe(0); // visual
    expect(trackOf(out, "a")).toBe(1); // audio, below
  });

  it("groups multiple audio tracks at the bottom preserving relative order", () => {
    const out = normalizeToZones([el("v", "video", 0), el("a1", "audio", 1), el("a2", "audio", 4)]);
    expect(trackOf(out, "v")).toBe(0);
    expect(trackOf(out, "a1")).toBe(1);
    expect(trackOf(out, "a2")).toBe(2);
  });

  it("returns the same array (identity) when already zoned", () => {
    // A fixed-point layout: the two overlapping equal-z visual clips are already
    // in DOM-order-consistent lanes (later-in-array `v` on the upper lane 0), so
    // re-zoning is a no-op and the SAME array reference comes back. (Was: i=0/v=1,
    // which the new per-clip DOM-order pack would flip — so it wasn't a fixed
    // point under the corrected canvas semantics; swapped to the stable order.)
    const input = [el("v", "video", 1), el("i", "img", 0), el("a", "audio", 2)];
    expect(normalizeToZones(input)).toBe(input);
  });

  it("is idempotent (no drift on re-zoning)", () => {
    const input = [
      el("img", "img", 1),
      el("v", "video", 3),
      el("a1", "audio", 2),
      el("a2", "audio", 6),
    ];
    expectZoningIdempotent(input);
  });

  it("splits time-overlapping clips on one track onto separate lanes (no visible overlap)", () => {
    const clip = (id: string, start: number, duration: number): TimelineElement => ({
      id,
      tag: "video",
      start,
      duration,
      track: 1, // all authored on the SAME track, some overlapping in time
    });
    // a [0,5), b [2,7) overlaps a, c [6,9) fits after a. All equal-z (absent).
    // Per-clip pack (DOM-order tie-break): c is last in DOM so it places on the
    // top lane 0; b overlaps c and lands on lane 1; a overlaps b (and is earlier
    // in DOM than b, so it must paint BELOW b) → lane 2. a can NOT drop onto c's
    // lane 0 even though it doesn't overlap c, because that would place a ABOVE b
    // in lane order while a paints below b — the canvas-correct constraint the old
    // whole-track packer ignored (it shared a/c on lane 0, contradicting paint).
    const out = normalizeToZones([clip("a", 0, 5), clip("b", 2, 5), clip("c", 6, 3)]);
    expect(trackOf(out, "c")).toBe(0); // last in DOM → top lane
    expect(trackOf(out, "b")).toBe(1); // overlaps c → below it
    expect(trackOf(out, "a")).toBe(2); // paints below b (earlier DOM, equal z) → lane below b

    // No two time-overlapping clips share a lane (the real NLE invariant).
    expect(trackOf(out, "a")).not.toBe(trackOf(out, "b"));
    expect(trackOf(out, "b")).not.toBe(trackOf(out, "c"));

    // Idempotent: re-laying the split result changes nothing.
    const twice = normalizeToZones(out);
    for (const e of out) expect(trackOf(twice, e.id)).toBe(e.track);
  });
});

describe("normalizeToZones — reverse z→lane mapping", () => {
  it("orders overlapping same-zone clips by z: higher z → higher (upper) lane", () => {
    // lo (z=1) and hi (z=9) fully overlap in time on the same authored track.
    const out = normalizeToZones([zClip("lo", 0, 10, 0, 1), zClip("hi", 0, 10, 0, 9)]);
    expect(trackOf(out, "hi")).toBe(0); // higher z → upper lane (top)
    expect(trackOf(out, "lo")).toBe(1); // lower z → below
  });

  it("orders three overlapping clips strictly by descending z", () => {
    const out = normalizeToZones([
      zClip("mid", 0, 10, 0, 5),
      zClip("top", 0, 10, 0, 8),
      zClip("bot", 0, 10, 0, 2),
    ]);
    expect(trackOf(out, "top")).toBe(0);
    expect(trackOf(out, "mid")).toBe(1);
    expect(trackOf(out, "bot")).toBe(2);
  });

  it("does NOT reorder non-overlapping (sequential) clips by z — they share a lane", () => {
    // a [0,5) z=1 then c [6,9) z=9 — no time overlap, so z is irrelevant.
    const out = normalizeToZones([zClip("a", 0, 5, 0, 1), zClip("c", 6, 3, 0, 9)]);
    expect(trackOf(out, "a")).toBe(0);
    expect(trackOf(out, "c")).toBe(0); // shares the lane regardless of higher z
  });

  it("leaves the audio zone unaffected by z", () => {
    const out = normalizeToZones([
      zClip("v", 0, 10, 0, 1),
      zClip("m1", 0, 10, 1, 99, "audio"),
      zClip("m2", 0, 10, 1, 0, "audio"),
    ]);
    // Two overlapping audio clips split onto lanes below the visual clip; their
    // relative z does not lift one above a visual clip.
    expect(trackOf(out, "v")).toBe(0);
    expect(trackOf(out, "m1")).toBeGreaterThan(trackOf(out, "v"));
    expect(trackOf(out, "m2")).toBeGreaterThan(trackOf(out, "v"));
  });

  it("treats missing / auto z as 0 (undefined z clip sinks below a positive-z overlap)", () => {
    const out = normalizeToZones([
      { id: "noz", tag: "video", start: 0, duration: 10, track: 0 }, // no zIndex
      zClip("pos", 0, 10, 0, 3),
    ]);
    expect(trackOf(out, "pos")).toBe(0); // z=3 → upper
    expect(trackOf(out, "noz")).toBe(1); // absent z ⇒ 0 → below
  });

  it("tie-breaks equal-z overlapping clips on the STABLE id, not the mutated lane", () => {
    // Equal z + full overlap: order must be deterministic (id asc) and survive
    // re-normalization — the historical oscillation bug tie-broke on the track.
    const out = normalizeToZones([zClip("b", 0, 10, 0, 5), zClip("a", 0, 10, 0, 5)]);
    expect(trackOf(out, "a")).toBe(0); // "a" < "b"
    expect(trackOf(out, "b")).toBe(1);
    const twice = normalizeToZones(out);
    for (const e of out) expect(trackOf(twice, e.id)).toBe(e.track);
  });

  it("FIXED POINT: normalizeToZones(normalizeToZones(x)) === normalizeToZones(x) with z present", () => {
    const input = [
      zClip("hi", 0, 10, 0, 9),
      zClip("lo", 0, 10, 0, 1),
      zClip("mid", 2, 6, 0, 5),
      zClip("seq", 12, 4, 0, 7),
      zClip("music", 0, 16, 1, 3, "audio"),
    ];
    expectZoningIdempotent(input);
  });

  it("reload simulation: re-deriving lanes from the SAME z values yields identical lanes", () => {
    // Simulate two independent discovery passes producing fresh element objects
    // carrying the same z — lane assignment must be stable across reloads.
    const build = (): TimelineElement[] => [
      zClip("hi", 0, 10, 0, 9),
      zClip("lo", 0, 10, 0, 1),
      zClip("mid", 3, 5, 0, 5),
    ];
    const first = normalizeToZones(build());
    const second = normalizeToZones(build());
    for (const e of first) expect(trackOf(second, e.id)).toBe(e.track);
  });
});

describe("normalizeToZones — cross-track z→lane (real qa-clean shape)", () => {
  // Derived from /tmp/hf-dnd-qa/qa-clean: a full-length video on authored track 0
  // (z=0), two logo SVGs on track 1 (z=26 and z=0), an icon on track 3 (z=5), and
  // background music on track 2. In the canvas the z=26 / z=5 icons paint ON TOP of
  // the z=0 video; the timeline must agree — the higher-z tracks sit on upper lanes.
  const realProject = (): TimelineElement[] => [
    zClip("ralu", 6.14, 3, 3, 5, "img"),
    zClip("video", 1, 20, 0, 0, "video"),
    zClip("blueLogo", 5.93, 3, 1, 26, "img"),
    zClip("blackLogo", 1, 3, 1, 0, "img"),
    zClip("music", 8.93, 8, 2, 0, "audio"),
  ];

  it("stacks a higher-z track ABOVE a lower-z track on a different authored track", () => {
    const out = normalizeToZones(realProject());
    // Track 1 (max z 26) tops the visual zone, then track 3 (z 5), then track 0 (z 0).
    expect(trackOf(out, "blueLogo")).toBe(0);
    expect(trackOf(out, "blackLogo")).toBe(0); // sequential to blueLogo → shares lane
    expect(trackOf(out, "ralu")).toBe(1);
    expect(trackOf(out, "video")).toBe(2);
    // Audio stays at the very bottom regardless of its authored track index.
    expect(trackOf(out, "music")).toBe(3);
  });

  it("the video (z=0) no longer sits above the z=26 / z=5 icons — canvas & timeline agree", () => {
    const out = normalizeToZones(realProject());
    expect(trackOf(out, "video")).toBeGreaterThan(trackOf(out, "blueLogo"));
    expect(trackOf(out, "video")).toBeGreaterThan(trackOf(out, "ralu"));
  });

  it("is idempotent on the real-project shape (no lane drift on re-discovery)", () => {
    const once = normalizeToZones(realProject());
    const twice = normalizeToZones(once);
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
  });

  it("re-derives identical lanes from fresh objects carrying the same z (reload-stable)", () => {
    const first = normalizeToZones(realProject());
    const second = normalizeToZones(realProject());
    for (const e of first) expect(trackOf(second, e.id)).toBe(e.track);
  });

  it("all-equal-z overlapping clips stack by DOM order (later on top), lanes contiguous", () => {
    // Was: "keeps ascending authored track order when all tracks share z" — that
    // pinned t0=0/t1=1/t3=2 to the authored track index. But these three all
    // start at 0 and OVERLAP, all z=0, so CSS paints them by DOM order: t3 (last)
    // on top. The per-clip pack now reflects that (t3 lane 0, then t1, then t0),
    // which is what the canvas actually shows. Lanes stay contiguous 0..2.
    const out = normalizeToZones([
      zClip("t0", 0, 2, 0, 0),
      zClip("t1", 0, 2, 1, 0),
      zClip("t3", 0, 2, 3, 0),
    ]);
    expect(trackOf(out, "t3")).toBe(0); // last in DOM → paints on top
    expect(trackOf(out, "t1")).toBe(1);
    expect(trackOf(out, "t0")).toBe(2);
  });
});

describe("normalizeToZones — EXACT qa-clean repro (per-clip constrained pack)", () => {
  // The live repro from /tmp/hf-dnd-qa/qa-clean/index.html:
  //   blue-logo  authored track 0, z=3, 6.37–9.37
  //   ralu image authored track 0, z=0, 6.37–9.37   (shares track 0 with blue-logo)
  //   black-logo authored track 1, z=1, 11.92–14.92
  //   video      authored track 3, z=2, 0.84–20.84
  // Canvas truth: video (z=2) covers ralu (z=0). The OLD whole-track packer
  // ordered track 0 by its MAX z (3, from blue-logo), so ralu rode above the
  // z=2 video — the timeline↔canvas contradiction. Array order below = DOM order.

  it("ACCEPTANCE: lane order top→bottom is blue-logo, video, black-logo, ralu", () => {
    const out = normalizeToZones(qaCleanRepro());
    expect(trackOf(out, "blue-logo")).toBe(0); // z=3 → top
    expect(trackOf(out, "video")).toBe(1); // z=2, overlaps blue-logo → below it
    expect(trackOf(out, "black-logo")).toBe(2); // z=1, overlaps video (11.92–14.92 ∩ 0.84–20.84)
    expect(trackOf(out, "ralu")).toBe(3); // z=0, overlaps blue-logo AND video → bottom
  });

  it("REGRESSION: a low-z clip must not ride its authored trackmate's high z above a clip that covers it", () => {
    const out = normalizeToZones(qaCleanRepro());
    // ralu (z=0) shares authored track 0 with blue-logo (z=3) but must sink BELOW
    // the video (z=2) that overlaps and paints over it — the whole-track bug.
    expect(trackOf(out, "ralu")).toBeGreaterThan(trackOf(out, "video"));
    // black-logo (z=1) below video (z=2) because they overlap in time.
    expect(trackOf(out, "black-logo")).toBeGreaterThan(trackOf(out, "video"));
  });

  it("FIXED POINT: running the NEW pack on its own output changes nothing", () => {
    const once = normalizeToZones(qaCleanRepro());
    const twice = normalizeToZones(once);
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
    // And a third pass, to be sure convergence is genuine.
    const thrice = normalizeToZones(twice);
    for (const e of twice) expect(trackOf(thrice, e.id)).toBe(e.track);
  });
});

describe("z ↔ lane round-trip convergence (both directions agree)", () => {
  // Project a normalized TimelineElement onto the StackingElement view the
  // forward (lane→z) mapping reasons over.
  const toStacking = (els: TimelineElement[]): StackingElement[] =>
    els.map((e, domIndex) => ({
      key: e.key ?? e.id,
      start: e.start,
      duration: e.duration,
      track: e.track,
      zIndex: Number.isFinite(e.zIndex) ? (e.zIndex as number) : 0,
      isAudio: classifyZone(e) === "audio",
      domIndex,
    }));

  it("lane-move → z patch → re-discovery orders lanes by that same z → identical lanes (no oscillation)", () => {
    // Two fully-overlapping visual clips. Authored: a below (z=1), b above (z=5).
    const authored: TimelineElement[] = [zClip("a", 0, 10, 0, 1), zClip("b", 0, 10, 0, 5)];
    const normalized = normalizeToZones(authored);
    // z→lane placed b (z=5) on the upper lane 0, a on lane 1.
    expect(trackOf(normalized, "b")).toBe(0);
    expect(trackOf(normalized, "a")).toBe(1);

    // USER lane-move: drag a to the TOP (lane 0) and push b down (lane 1).
    const afterMove = normalized.map((e) =>
      e.id === "a" ? { ...e, track: 0 } : e.id === "b" ? { ...e, track: 1 } : e,
    );

    // FORWARD: a lane-move writes the minimal z patch for the edited clip.
    const patches = computeStackingPatches(toStacking(afterMove), ["a"]);
    expect(patches).toEqual([{ key: "a", zIndex: 6 }]); // lifted above b (5)

    // Apply the z patch back onto the elements (what handleDomZIndexReorderCommit
    // persists; next discovery re-reads it as TimelineElement.zIndex).
    const rediscovered = afterMove.map((e) => {
      const p = patches.find((pp) => pp.key === (e.key ?? e.id));
      return p ? { ...e, zIndex: p.zIndex } : e;
    });

    // REVERSE: re-normalize from the new z. a (z=6) must now own the upper lane —
    // the same lane the user moved it to. Directions converge, they do not fight.
    const renormalized = normalizeToZones(rediscovered);
    expect(trackOf(renormalized, "a")).toBe(0);
    expect(trackOf(renormalized, "b")).toBe(1);

    // FIXED POINT: forward on the converged state produces NO further patch, and
    // reverse is idempotent — the round-trip is stable.
    expect(computeStackingPatches(toStacking(renormalized), ["a"])).toEqual([]);
    const twice = normalizeToZones(renormalized);
    for (const e of renormalized) expect(trackOf(twice, e.id)).toBe(e.track);
  });

  it("qa-clean: drag video BELOW ralu → z patch → re-pack keeps it below, no oscillation", () => {
    // EXACT repro fixture (array order = DOM order).
    const normalized = normalizeToZones(qaCleanRepro());
    // Baseline lanes: blue-logo 0, video 1, black-logo 2, ralu 3.
    expect(trackOf(normalized, "video")).toBe(1);
    expect(trackOf(normalized, "ralu")).toBe(3);

    // USER lane-move: drag video to the lane BELOW ralu (bottom). ralu is at
    // lane 3, so video goes to a lane strictly greater — model it as lane 4.
    const afterMove = normalized.map((e) => (e.id === "video" ? { ...e, track: 4 } : e));

    // FORWARD: video (z=2) must drop below ralu (z=0). No integer z ≥ 0 fits
    // strictly below 0, so the tie-aware sync cascades: video→0 and the clips that
    // must stay above it (ralu z=0, black-logo z=1, blue-logo z=3) are bumped as
    // needed so video paints below ralu with all z ≥ 0.
    const patches = computeStackingPatches(toStacking(afterMove), ["video"]);
    const patchByKey = new Map(patches.map((p) => [p.key, p.zIndex]));
    // Video was moved; it must now be strictly below ralu in paint order.
    const zAfter = (id: string): number =>
      patchByKey.get(id) ?? (afterMove.find((e) => e.id === id)!.zIndex as number);
    expect(zAfter("video")).toBeLessThan(zAfter("ralu"));
    expect(zAfter("video")).toBeGreaterThanOrEqual(0);
    expect(patchByKey.size).toBeGreaterThan(0);

    // Apply patches and re-pack: video's lane must now be BELOW ralu's.
    const rediscovered = afterMove.map((e) => {
      const z = patchByKey.get(e.id);
      return z != null ? { ...e, zIndex: z } : e;
    });
    const renormalized = normalizeToZones(rediscovered);
    expect(trackOf(renormalized, "video")).toBeGreaterThan(trackOf(renormalized, "ralu"));

    // FIXED POINT: re-running BOTH directions on the converged state is a no-op.
    expect(computeStackingPatches(toStacking(renormalized), ["video"])).toEqual([]);
    const twice = normalizeToZones(renormalized);
    for (const e of renormalized) expect(trackOf(twice, e.id)).toBe(e.track);
  });
});
