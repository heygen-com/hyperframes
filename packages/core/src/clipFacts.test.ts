import { describe, expect, it } from "vitest";
import { byStart, formatClipLine, type ClipFact } from "./clipFacts.js";

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
