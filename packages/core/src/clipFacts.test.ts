import { describe, expect, it } from "vitest";
import {
  byStart,
  formatClipLine,
  isInsideSpan,
  sameInstant,
  spansOverlap,
  spansShareTime,
  type ClipFact,
} from "./clipFacts.js";

const clip = (over: Partial<ClipFact> = {}): ClipFact => ({
  id: "a",
  label: null,
  kind: "video",
  start: 1,
  duration: 2,
  end: 3,
  trackIndex: 0,
  src: null,
  sourceFile: null,
  volume: null,
  lanes: [],
  playbackRate: null,
  audioGroup: null,
  role: null,
  ...over,
});

describe("formatClipLine", () => {
  it("prints only the always-present fields for a bare clip", () => {
    expect(formatClipLine(clip())).toBe('- video "a" start=1 duration=2 end=3 track=0');
  });

  it("prints every optional field when present, rounded to milliseconds", () => {
    const line = formatClipLine(
      clip({
        src: "a.mp4",
        volume: 0.12345,
        playbackRate: 2,
        audioGroup: "vo",
        role: "bed",
        sourceFile: "s.html",
        lanes: [
          {
            target: "volume",
            points: [
              { t: 0, v: 0.2 },
              { t: 1.23456, v: 1 },
            ],
          },
        ],
      }),
    );
    expect(line).toBe(
      '- video "a" src=a.mp4 start=1 duration=2 end=3 track=0 volume=0.123 rate=2 group=vo role=bed file=s.html volume-lane=[0:0.2, 1.235:1]',
    );
  });

  it("keeps volume 0 (muted) instead of dropping it as falsy", () => {
    expect(formatClipLine(clip({ volume: 0 }))).toContain("volume=0");
  });
});

describe("byStart", () => {
  it("orders by start, then track", () => {
    const rows = [clip({ id: "c", start: 2 }), clip({ id: "b", trackIndex: 1 }), clip({ id: "a" })];
    expect(rows.sort(byStart).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("spansOverlap", () => {
  it("counts clips that only meet as apart, though the float sum of the first overshoots", () => {
    expect(19.8 + 6.4).toBeGreaterThan(26.2);
    expect(spansOverlap(19.8, 19.8 + 6.4, 26.2, 29)).toBe(false);
    expect(spansOverlap(26.2, 29, 19.8, 19.8 + 6.4)).toBe(false);
  });

  it("counts clips that share time as overlapping, down to half a microsecond", () => {
    expect(spansOverlap(0, 2, 1.9, 3)).toBe(true);
    expect(spansOverlap(1, 2, 0, 5)).toBe(true);
    expect(spansOverlap(0, 20 / 24 + 5e-7, 20 / 24, 20 / 24 + 0.25)).toBe(true);
  });

  it("counts a zero-length clip inside another, so the timeline gives it a lane of its own", () => {
    expect(spansOverlap(1, 1, 0.5, 1.5)).toBe(true);
  });
});

describe("spansShareTime", () => {
  it("never counts a zero-length span, such as pending media, as sharing time", () => {
    expect(spansShareTime(1, 1, 0.5, 1.5)).toBe(false);
    expect(spansShareTime(0.5, 1.5, 1, 1)).toBe(false);
  });

  it("agrees with spansOverlap on spans with length, float sums included", () => {
    expect(spansShareTime(19.8, 19.8 + 6.4, 26.2, 29)).toBe(false);
    expect(spansShareTime(0, 20 / 24 + 5e-7, 20 / 24, 20 / 24 + 0.25)).toBe(true);
    expect(spansShareTime(1, 2, 0, 5)).toBe(true);
  });
});

describe("isInsideSpan", () => {
  it("counts a time strictly inside, and not one on either edge within float rounding", () => {
    expect(isInsideSpan(3, 1, 5)).toBe(true);
    expect(isInsideSpan(26.2, 19.8, 19.8 + 6.4)).toBe(false);
    expect(isInsideSpan(1, 1, 5)).toBe(false);
  });
});

describe("sameInstant", () => {
  it("joins times a float rounding step apart, and nothing wider", () => {
    expect(sameInstant(19.8 + 6.4, 26.2)).toBe(true);
    expect(sameInstant(0.1 + 1.1, 1.2)).toBe(true);
    expect(sameInstant(3600.1 + 0.2, 3600.3)).toBe(true);
    expect(sameInstant(20 / 24 + 5e-7, 20 / 24)).toBe(false);
    expect(sameInstant(1.0000005, 1)).toBe(false);
    expect([sameInstant(5, Infinity), sameInstant(Infinity, Infinity)]).toEqual([false, true]);
  });
});
