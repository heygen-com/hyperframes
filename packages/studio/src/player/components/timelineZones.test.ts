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

describe("classifyZone", () => {
  it("audio → audio; video / image / everything else → visual", () => {
    expect(classifyZone(el("m", "audio", 3))).toBe("audio");
    expect(classifyZone(el("v", "video", 1))).toBe("visual");
    expect(classifyZone(el("i", "img", 0))).toBe("visual");
  });
});

describe("normalizeToZones", () => {
  it("orders visual (top) → audio (bottom) by ascending index", () => {
    const out = normalizeToZones([
      el("img", "img", 0),
      el("vid", "video", 2),
      el("mus", "audio", 5),
    ]);
    expect(trackOf(out, "img")).toBe(0); // visual
    expect(trackOf(out, "vid")).toBe(1); // visual
    expect(trackOf(out, "mus")).toBe(2); // audio (bottom)
  });

  it("keeps all visual lanes together on top, preserving authored order", () => {
    const out = normalizeToZones([el("v0", "video", 0), el("i1", "img", 1), el("v3", "video", 3)]);
    expect(trackOf(out, "v0")).toBe(0);
    expect(trackOf(out, "i1")).toBe(1);
    expect(trackOf(out, "v3")).toBe(2);
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
    const input = [el("i", "img", 0), el("v", "video", 1), el("a", "audio", 2)];
    expect(normalizeToZones(input)).toBe(input);
  });

  it("is idempotent (no drift on re-zoning)", () => {
    const input = [
      el("img", "img", 1),
      el("v", "video", 3),
      el("a1", "audio", 2),
      el("a2", "audio", 6),
    ];
    const once = normalizeToZones(input);
    const twice = normalizeToZones(once);
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
  });

  it("splits time-overlapping clips on one track onto separate lanes (no visible overlap)", () => {
    const clip = (id: string, start: number, duration: number): TimelineElement => ({
      id,
      tag: "video",
      start,
      duration,
      track: 1, // all authored on the SAME track, some overlapping in time
    });
    // a [0,5), b [2,7) overlaps a, c [6,9) fits after a.
    const out = normalizeToZones([clip("a", 0, 5), clip("b", 2, 5), clip("c", 6, 3)]);
    expect(trackOf(out, "a")).toBe(0); // lane 0
    expect(trackOf(out, "b")).toBe(1); // overlaps a → its own lane
    expect(trackOf(out, "c")).toBe(0); // sequential after a → shares lane 0

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
    const once = normalizeToZones(input);
    const twice = normalizeToZones(once);
    for (const e of once) expect(trackOf(twice, e.id)).toBe(e.track);
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

  it("keeps ascending authored track order when all tracks share z (no reorder)", () => {
    // Regression guard: equal representative-z must tie-break on the authored track
    // index, so an all-z0 composition is unchanged from the prior behavior.
    const out = normalizeToZones([
      zClip("t0", 0, 2, 0, 0),
      zClip("t1", 0, 2, 1, 0),
      zClip("t3", 0, 2, 3, 0),
    ]);
    expect(trackOf(out, "t0")).toBe(0);
    expect(trackOf(out, "t1")).toBe(1);
    expect(trackOf(out, "t3")).toBe(2);
  });
});

describe("z ↔ lane round-trip convergence (both directions agree)", () => {
  // Project a normalized TimelineElement onto the StackingElement view the
  // forward (lane→z) mapping reasons over.
  const toStacking = (els: TimelineElement[]): StackingElement[] =>
    els.map((e) => ({
      key: e.key ?? e.id,
      start: e.start,
      duration: e.duration,
      track: e.track,
      zIndex: Number.isFinite(e.zIndex) ? (e.zIndex as number) : 0,
      isAudio: classifyZone(e) === "audio",
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
});
