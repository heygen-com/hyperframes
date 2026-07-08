import { describe, expect, it } from "vitest";
import { resolveTimelineDropPreview, runtimeKindForElement } from "./timelineDropPreview";

const baseDrop = {
  rectLeft: 0,
  rectTop: 0,
  scrollLeft: 0,
  scrollTop: 0,
  pixelsPerSecond: 100,
  duration: 60,
  trackHeight: 48,
  trackOrder: [0, 1],
};
// clientX includes GUTTER(32); clientY includes RULER_H(24).

describe("resolveTimelineDropPreview", () => {
  it("uses the drag session for kind/duration/label", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32 + 500, // t = 5s
      clientY: 24 + 10, // row 0
      session: { source: "asset", path: "a.mp3", kind: "audio", durationSec: 12.4, label: "a.mp3" },
      fileItems: [],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p).toMatchObject({
      start: 5,
      track: 0,
      isNewTrack: false,
      durationSec: 12.4,
      kind: "audio",
      label: "a.mp3",
      extraCount: 0,
    });
  });

  it("falls back to file item MIME hints for OS drags, with default durations and a count", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32,
      clientY: 24 + 60, // row 1
      session: null,
      fileItems: [
        { kind: "file", type: "video/mp4" },
        { kind: "file", type: "image/png" },
      ],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p.kind).toBe("video");
    expect(p.durationSec).toBe(5);
    expect(p.extraCount).toBe(1);
    expect(p.track).toBe(1);
  });

  it("flags a new track when dropped below the last row", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32,
      clientY: 24 + 48 * 2 + 10, // row index 2, beyond trackOrder [0,1]
      session: null,
      fileItems: [{ kind: "file", type: "audio/mpeg" }],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p.isNewTrack).toBe(true);
    expect(p.track).toBe(2); // max(trackOrder)+1
  });

  it("snaps the start to the nearest target when enabled, and not when disabled", () => {
    const targets = [{ time: 5, type: "playhead" as const }];
    const on = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32 + 503,
      clientY: 24,
      session: null,
      fileItems: [{ kind: "file", type: "image/png" }],
      snapTargets: targets,
      snapEnabled: true,
    });
    expect(on.start).toBe(5);
    expect(on.snapType).toBe("playhead");
    const off = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32 + 503,
      clientY: 24,
      session: null,
      fileItems: [{ kind: "file", type: "image/png" }],
      snapTargets: targets,
      snapEnabled: false,
    });
    expect(off.start).toBeCloseTo(5.03, 2);
    expect(off.snapTime).toBeNull();
  });

  it("reports unknown kind for unrecognized MIME with no session", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32,
      clientY: 24,
      session: null,
      fileItems: [{ kind: "file", type: "application/pdf" }],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p.kind).toBe("unknown");
  });
});

describe("kind-aware track retargeting", () => {
  const drop = {
    rectLeft: 0,
    rectTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    pixelsPerSecond: 100,
    duration: 60,
    trackHeight: 48,
    trackOrder: [0, 1],
  };
  const base = {
    drop,
    clientX: 32,
    session: null,
    fileItems: [{ kind: "file", type: "image/png" }],
    snapTargets: [],
    snapEnabled: true,
  };

  it("keeps the target track when the row already holds the same kind", () => {
    const p = resolveTimelineDropPreview({
      ...base,
      clientY: 24, // row 0
      trackKinds: new Map([[0, new Set(["image"])]]),
    });
    expect(p.track).toBe(0);
    expect(p.isNewTrack).toBe(false);
  });

  it("retargets to a fresh track when the row holds a different kind (runtime would split it)", () => {
    const p = resolveTimelineDropPreview({
      ...base,
      clientY: 24, // row 0 holds text elements
      trackKinds: new Map([
        [0, new Set(["element"])],
        [1, new Set(["video"])],
      ]),
    });
    expect(p.track).toBe(2); // max(trackOrder)+1
    expect(p.isNewTrack).toBe(true);
  });

  it("blocks map to the composition kind for matching", () => {
    const p = resolveTimelineDropPreview({
      ...base,
      fileItems: [],
      session: { source: "block", blockName: "b", kind: "block", durationSec: 3, label: "B" },
      clientY: 24,
      trackKinds: new Map([[0, new Set(["composition"])]]),
    });
    expect(p.track).toBe(0);
    expect(p.isNewTrack).toBe(false);
  });

  it("leaves unknown kinds and empty rows untouched", () => {
    const unknown = resolveTimelineDropPreview({
      ...base,
      fileItems: [{ kind: "file", type: "application/pdf" }],
      clientY: 24,
      trackKinds: new Map([[0, new Set(["video"])]]),
    });
    expect(unknown.track).toBe(0);
    const emptyRow = resolveTimelineDropPreview({
      ...base,
      clientY: 24,
      trackKinds: new Map([[0, new Set()]]),
    });
    expect(emptyRow.track).toBe(0);
  });
});

describe("runtimeKindForElement", () => {
  it("classifies elements like the runtime does", () => {
    expect(runtimeKindForElement({ tag: "video" })).toBe("video");
    expect(runtimeKindForElement({ tag: "AUDIO" })).toBe("audio");
    expect(runtimeKindForElement({ tag: "img" })).toBe("image");
    expect(runtimeKindForElement({ tag: "div" })).toBe("element");
    expect(runtimeKindForElement({ tag: "div", compositionSrc: "compositions/x.html" })).toBe(
      "composition",
    );
  });
});
