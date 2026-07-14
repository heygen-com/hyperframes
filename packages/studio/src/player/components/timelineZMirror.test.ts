import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { resolveZMirrorLaneMove, type ZMirrorInput } from "./timelineZMirror";

function el(
  id: string,
  track: number,
  start: number,
  duration: number,
  extra: Partial<TimelineElement> = {},
): TimelineElement {
  return { id, key: id, tag: "video", start, duration, track, domId: id, ...extra };
}

function audio(id: string, track: number, start: number, duration: number): TimelineElement {
  return el(id, track, start, duration, { tag: "audio" });
}

function resolve(
  action: ZMirrorInput["action"],
  element: TimelineElement,
  elements: TimelineElement[],
  crossedKey?: string | null,
) {
  return resolveZMirrorLaneMove({ action, element, elements, crossedKey });
}

// Target on TOP lane 0; b/c fully occupy the two lanes below over t's span.
const stackBelow = () => {
  const t = el("t", 0, 0, 10);
  const b = el("b", 1, 0, 10);
  const c = el("c", 2, 0, 10);
  return { t, elements: [t, b, c] };
};

// Sparse file: authored tracks 3/5/7 displayed as lanes 0/1/2 (a free over t's span).
const sparseAuthored = () => {
  const a = el("a", 0, 20, 5, { authoredTrack: 3 });
  const b = el("b", 1, 0, 10, { authoredTrack: 5 });
  const t = el("t", 2, 0, 10, { authoredTrack: 7 });
  return { t, elements: [a, b, t] };
};

describe("resolveZMirrorLaneMove — bring-forward / send-backward", () => {
  // Stack: a on lane 0, b on lane 1, target on lane 2 — all overlapping in time.
  const stack = () => {
    const a = el("a", 0, 0, 10);
    const b = el("b", 1, 0, 10);
    const t = el("t", 2, 0, 10);
    return { a, b, t, elements: [a, b, t] };
  };

  it("bring-forward with crossedKey lands on the closest free lane above the neighbor", () => {
    // Free lane 0 exists above the crossed neighbor's lane... make lane 0 free by
    // shifting a out of the span.
    const a = el("a", 0, 20, 5); // lane 0 free over t's span
    const b = el("b", 1, 0, 10);
    const t = el("t", 2, 0, 10);
    expect(resolve("bring-forward", t, [a, b, t], "b")).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 0,
    });
  });

  it("bring-forward with crossedKey inserts above the neighbor when no lane is free", () => {
    const { t, elements } = stack();
    // Lanes 0 and 1 both occupied over t's span → new lane at the boundary
    // ABOVE the crossed neighbor (row of lane 1 in the ascending order).
    expect(resolve("bring-forward", t, elements, "b")).toEqual({ kind: "insert", insertRow: 1 });
  });

  it("bring-forward without crossedKey uses the closest overlapping neighbor above", () => {
    const { t, elements } = stack();
    // Closest overlapping neighbor above lane 2 is b (lane 1); lanes 0/1 are
    // occupied → insert above b, same as the crossedKey case.
    expect(resolve("bring-forward", t, elements)).toEqual({ kind: "insert", insertRow: 1 });
  });

  it("bring-forward with an unknown crossedKey falls back to the temporal neighbor", () => {
    const { t, elements } = stack();
    expect(resolve("bring-forward", t, elements, "nope")).toEqual({
      kind: "insert",
      insertRow: 1,
    });
  });

  it("bring-forward returns null when nothing overlaps above and no crossedKey", () => {
    const a = el("a", 0, 20, 5); // above but NOT overlapping in time
    const t = el("t", 1, 0, 10);
    expect(resolve("bring-forward", t, [a, t])).toBeNull();
  });

  it("send-backward lands on the closest free lane below the neighbor", () => {
    const t = el("t", 0, 0, 10);
    const b = el("b", 1, 0, 10);
    const c = el("c", 2, 20, 5); // lane 2 free over t's span
    expect(resolve("send-backward", t, [t, b, c], "b")).toEqual({
      kind: "move",
      displayTrack: 2,
      persistTrack: 2,
    });
  });

  it("send-backward inserts below the neighbor when no lane below is free", () => {
    const { t, elements } = stackBelow();
    // Boundary below b's lane (row 1 + 1 = 2).
    expect(resolve("send-backward", t, elements, "b")).toEqual({ kind: "insert", insertRow: 2 });
  });

  it("send-backward returns null when nothing overlaps below and no crossedKey", () => {
    const t = el("t", 0, 0, 10);
    const b = el("b", 1, 20, 5);
    expect(resolve("send-backward", t, [t, b])).toBeNull();
  });

  it("BOUNDED: never steps past the next overlapping element to a farther free lane", () => {
    // Above neighbor b (lane 2): lane 1 holds x — the NEXT temporally-overlapping
    // same-file element in the direction — and lane 0 is free. A single forward
    // step crosses ONE element, so the free lane 0 beyond x is out of reach:
    // insert immediately above b instead (row of lane 2 in the ascending order).
    const a = el("a", 0, 30, 5); // lane 0 free over t's span — but beyond the bound
    const x = el("x", 1, 5, 10); // overlaps t → the exclusive bound
    const b = el("b", 2, 0, 10);
    const t = el("t", 3, 0, 10);
    expect(resolve("bring-forward", t, [a, x, b, t], "b")).toEqual({
      kind: "insert",
      insertRow: 2,
    });
  });

  it("OPEN SPACE: with no second overlapping element, skips an occupied lane to the next free one", () => {
    // Lane 1's occupant is a FOREIGN-file clip: it occupies the lane (freeness is
    // file-agnostic) but is not in the same stacking context, so it does not
    // bound the step — the search continues to free lane 0, as before.
    const a = el("a", 0, 30, 5); // lane 0 free over t's span
    const x = el("x", 1, 5, 10, { sourceFile: "sub.html" });
    const b = el("b", 2, 0, 10);
    const t = el("t", 3, 0, 10);
    expect(resolve("bring-forward", t, [a, x, b, t], "b")).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 0,
    });
  });

  it("returns null when the closest free lane is the clip's own lane (z/track divergence)", () => {
    // Crossed neighbor sits BELOW the clip in lane space (diverged z): searching
    // up from lane 2 finds lane 1 free — the clip's own lane → already in place.
    const t = el("t", 1, 0, 10);
    const b = el("b", 2, 0, 10);
    expect(resolve("bring-forward", t, [t, b], "b")).toBeNull();
  });
});

describe("resolveZMirrorLaneMove — one-element step bound (forward/backward)", () => {
  // Three stacked back-to-back clips (lanes 0/1/2, all overlapping) plus a free
  // lane BEYOND the far element — the lane the old resolver would overshoot to.
  const threeStackedWithFarFree = () => {
    const a = el("a", 0, 0, 10);
    const b = el("b", 1, 0, 10);
    const c = el("c", 2, 0, 10);
    const d = el("d", 3, 20, 5); // lane 3 free over the span — beyond c
    return { a, b, c, d, elements: [a, b, c, d] };
  };

  it("send-backward from the top inserts between elements 1 and 2 — not past element 2", () => {
    const { a, elements } = threeStackedWithFarFree();
    // Reference = b (lane 1); next overlap below = c (lane 2) bounds the search;
    // no free lane strictly between → insert at the b/c boundary (row 2), NOT
    // the farther free lane 3.
    expect(resolve("send-backward", a, elements, "b")).toEqual({ kind: "insert", insertRow: 2 });
  });

  it("bring-forward from the bottom inserts between elements 1 and 2 (symmetric)", () => {
    const d = el("d", 0, 20, 5); // lane 0 free over the span — beyond a
    const a = el("a", 1, 0, 10);
    const b = el("b", 2, 0, 10);
    const t = el("t", 3, 0, 10);
    // Reference = b (lane 2); next overlap above = a (lane 1) bounds the search;
    // no free lane strictly between → insert at the a/b boundary (row 2), NOT
    // the farther free lane 0.
    expect(resolve("bring-forward", t, [d, a, b, t], "b")).toEqual({
      kind: "insert",
      insertRow: 2,
    });
  });

  it("takes a free lane strictly between the reference and the next overlap", () => {
    const a = el("a", 0, 0, 10); // second element — the exclusive bound
    const gap = el("gap", 1, 20, 5); // lane 1 free over the span, inside the interval
    const b = el("b", 2, 0, 10); // crossed reference
    const t = el("t", 3, 0, 10);
    expect(resolve("bring-forward", t, [a, gap, b, t], "b")).toEqual({
      kind: "move",
      displayTrack: 1,
      persistTrack: 1,
    });
  });

  it("of several free lanes in the interval, takes the one closest to the reference", () => {
    const a = el("a", 0, 0, 10); // bound
    const g1 = el("g1", 1, 20, 5); // free, farther from reference
    const g2 = el("g2", 2, 20, 5); // free, closest to reference
    const b = el("b", 3, 0, 10); // crossed reference
    const t = el("t", 4, 0, 10);
    expect(resolve("bring-forward", t, [a, g1, g2, b, t], "b")).toEqual({
      kind: "move",
      displayTrack: 2,
      persistTrack: 2,
    });
  });

  it("no second overlapping element beyond the reference → the zone edge bounds (as today)", () => {
    const { t, elements } = stackBelow();
    // Only c overlaps below the reference b... remove c's overlap: reference is
    // then the ONLY overlap below; the search runs to the zone edge and takes
    // the free lane beyond the neighbor.
    const spread = elements.map((e) => (e.id === "c" ? { ...e, start: 20 } : e));
    expect(resolve("send-backward", t, spread, "b")).toEqual({
      kind: "move",
      displayTrack: 2,
      persistTrack: 2,
    });
  });

  it("bring-to-front is NOT bounded: still moves past the whole overlap set", () => {
    const { t, elements } = (() => {
      const free = el("free", 0, 20, 5); // free lane beyond the topmost overlap
      const a = el("a", 1, 0, 10);
      const b = el("b", 2, 0, 10);
      const t = el("t", 3, 0, 10);
      return { t, elements: [free, a, b, t] };
    })();
    expect(resolve("bring-to-front", t, elements)).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 0,
    });
  });
});

describe("resolveZMirrorLaneMove — bring-to-front / send-to-back", () => {
  it("bring-to-front moves above the topmost temporally-overlapping clip", () => {
    const a = el("a", 0, 20, 5); // lane 0 free over t's span
    const b = el("b", 1, 0, 10); // topmost overlap
    const c = el("c", 2, 0, 10);
    const t = el("t", 3, 0, 10);
    expect(resolve("bring-to-front", t, [a, b, c, t])).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 0,
    });
  });

  it("bring-to-front inserts above the topmost overlap when no lane is free", () => {
    const b = el("b", 0, 0, 10);
    const c = el("c", 1, 0, 10);
    const t = el("t", 2, 0, 10);
    expect(resolve("bring-to-front", t, [b, c, t])).toEqual({ kind: "insert", insertRow: 0 });
  });

  it("bring-to-front is null when already topmost among overlaps (temporal scope)", () => {
    // A clip exists on a higher lane but does NOT overlap in time — with the
    // default temporal-overlap scope the target is already at the front.
    const a = el("a", 0, 20, 5);
    const t = el("t", 1, 0, 10);
    const c = el("c", 2, 0, 10);
    expect(resolve("bring-to-front", t, [a, t, c])).toBeNull();
  });

  it("send-to-back moves below the bottommost temporally-overlapping clip", () => {
    const t = el("t", 0, 0, 10);
    const b = el("b", 1, 0, 10); // bottommost overlap
    const c = el("c", 2, 20, 5); // lane 2 free over t's span
    expect(resolve("send-to-back", t, [t, b, c])).toEqual({
      kind: "move",
      displayTrack: 2,
      persistTrack: 2,
    });
  });

  it("send-to-back inserts below the bottommost overlap when no lane is free", () => {
    const { t, elements } = stackBelow();
    expect(resolve("send-to-back", t, elements)).toEqual({ kind: "insert", insertRow: 3 });
  });

  it("send-to-back is null when already bottommost among overlaps", () => {
    const t = el("t", 1, 0, 10);
    const a = el("a", 0, 0, 10);
    expect(resolve("send-to-back", t, [a, t])).toBeNull();
  });

  it("returns null when nothing overlaps at all", () => {
    const t = el("t", 0, 0, 10);
    const a = el("a", 1, 20, 5);
    for (const action of ["bring-to-front", "send-to-back"] as const) {
      expect(resolve(action, t, [t, a])).toBeNull();
    }
  });
});

describe("resolveZMirrorLaneMove — span freeness", () => {
  it("a lane free at the clip's start but occupied later in the span is NOT free", () => {
    const t = el("t", 2, 0, 10);
    const b = el("b", 1, 0, 10); // crossed neighbor
    // Lane 0: nothing at t=0, but occupied over [6, 9) — inside t's span.
    const late = el("late", 0, 6, 3);
    expect(resolve("bring-forward", t, [late, b, t], "b")).toEqual({
      kind: "insert",
      insertRow: 1,
    });
  });

  it("half-open spans: a clip starting exactly at the moved clip's end does not occupy", () => {
    const t = el("t", 2, 0, 10);
    const b = el("b", 1, 0, 10);
    const adjacent = el("adj", 0, 10, 5); // [10, 15) touches [0, 10) but no overlap
    expect(resolve("bring-forward", t, [adjacent, b, t], "b")).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 0,
    });
  });

  it("freeness is file-agnostic: an other-file clip occupies the lane", () => {
    const t = el("t", 2, 0, 10);
    const b = el("b", 1, 0, 10);
    const foreign = el("f", 0, 0, 10, { sourceFile: "sub.html" });
    expect(resolve("bring-forward", t, [foreign, b, t], "b")).toEqual({
      kind: "insert",
      insertRow: 1,
    });
  });
});

describe("resolveZMirrorLaneMove — zone boundary (audio untouched)", () => {
  // Visual lanes 0-1, audio lanes 2-3.
  const zoned = () => {
    const t = el("t", 0, 0, 10);
    const b = el("b", 1, 0, 10);
    const m = audio("music", 2, 0, 30);
    const vo = audio("vo", 3, 0, 30);
    return { t, b, m, vo, elements: [t, b, m, vo] };
  };

  it("send-backward never lands on an audio lane — inserts at the zone boundary", () => {
    const { t, elements } = zoned();
    // Lane 2 (audio) is out of bounds even though "below"; boundary row 2 sits
    // between the bottom visual lane and the first audio lane — a visual insert.
    expect(resolve("send-backward", t, elements, "b")).toEqual({ kind: "insert", insertRow: 2 });
  });

  it("send-to-back stops at the visual zone edge", () => {
    const { t, elements } = zoned();
    expect(resolve("send-to-back", t, elements)).toEqual({ kind: "insert", insertRow: 2 });
  });

  it("audio clips never mirror (returns null)", () => {
    const { m, elements } = zoned();
    for (const action of [
      "bring-to-front",
      "bring-forward",
      "send-backward",
      "send-to-back",
    ] as const) {
      expect(resolve(action, m, elements)).toBeNull();
    }
  });

  it("audio clips do not count as overlap references for visual clips", () => {
    // Only audio below the target → send-backward has no visual neighbor → null.
    const t = el("t", 0, 0, 10);
    const m = audio("music", 1, 0, 30);
    expect(resolve("send-backward", t, [t, m])).toBeNull();
    expect(resolve("send-to-back", t, [t, m])).toBeNull();
  });
});

describe("resolveZMirrorLaneMove — authored (persist) space", () => {
  it("persistTrack takes the target lane occupant's authoredTrack, not the display lane", () => {
    // Occupant of the free-over-span target lane 0 (authored 3) anchors the persist value.
    const { t, elements } = sparseAuthored();
    expect(resolve("bring-forward", t, elements, "b")).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 3,
    });
  });

  it("falls back to nearest-same-file lane offset when the target lane has no same-file occupant", () => {
    // The moved clip is an expanded sub-comp child; the target lane's only
    // occupant belongs to the host file, so the persist value offsets from the
    // nearest same-file lane instead (authored 4 at lane 1 → lane 0 = 3).
    const host = el("h", 0, 20, 5); // host-file clip on the target lane (not overlapping)
    const sib = el("s", 1, 0, 10, { sourceFile: "sub.html", authoredTrack: 4 });
    const t = el("t", 2, 0, 10, { sourceFile: "sub.html", authoredTrack: 5 });
    expect(resolve("bring-forward", t, [host, sib, t], "s")).toEqual({
      kind: "move",
      displayTrack: 0,
      persistTrack: 3,
    });
  });
});

describe("resolveZMirrorLaneMove — stacking-context (source file) scoping", () => {
  it("other-file clips are not overlap references (extremes computed per file)", () => {
    // A host clip overlaps above the sub-comp child, but the child's own file
    // has nothing above it → bring-to-front is null (already at ITS front).
    const host = el("h", 0, 0, 10);
    const t = el("t", 1, 0, 10, { sourceFile: "sub.html" });
    expect(resolve("bring-to-front", t, [host, t])).toBeNull();
  });

  it("same-file overlaps in an expanded sub-comp resolve within the child's lanes", () => {
    const host = el("h", 0, 0, 10);
    const sib = el("s", 1, 0, 10, { sourceFile: "sub.html", authoredTrack: 0 });
    const t = el("t", 2, 0, 10, { sourceFile: "sub.html", authoredTrack: 1 });
    // Topmost same-file overlap is sib (lane 1); lane 0 is occupied by the host
    // over the span (freeness is file-agnostic) → insert above sib's lane.
    expect(resolve("bring-to-front", t, [host, sib, t])).toEqual({
      kind: "insert",
      insertRow: 1,
    });
  });
});

describe("resolveZMirrorLaneMove — degenerate inputs and determinism", () => {
  it("zero-duration element returns null", () => {
    const t = el("t", 1, 0, 0);
    const a = el("a", 0, 0, 10);
    expect(resolve("bring-to-front", t, [a, t])).toBeNull();
  });

  it("single-clip timeline returns null for every action", () => {
    const t = el("t", 0, 0, 10);
    for (const action of [
      "bring-to-front",
      "bring-forward",
      "send-backward",
      "send-to-back",
    ] as const) {
      expect(resolve(action, t, [t])).toBeNull();
    }
  });

  it("identical inputs produce identical outputs (deterministic, input untouched)", () => {
    const first = sparseAuthored();
    const snapshot = structuredClone(first.elements);
    const r1 = resolve("bring-forward", first.t, first.elements, "b");
    const r2 = resolve("bring-forward", first.t, first.elements, "b");
    const fresh = sparseAuthored();
    const r3 = resolve("bring-forward", fresh.t, fresh.elements, "b");
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
    expect(first.elements).toEqual(snapshot); // pure — never mutates its input
  });
});
