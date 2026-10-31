import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifiedCuts, confirmsCut, cutsIn, findCuts, SIG_H, SIG_W, signatures } from "./cuts.js";

/** Frame changes: `base` everywhere, with the given changes at their frames. */
const changes = (n: number, base: number, at: Record<number, number>) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? 0 : (at[i] ?? base)));

describe("cutsIn", () => {
  it("finds a hard cut and a two-frame whip as one cut", () => {
    expect(cutsIn(changes(60, 1, { 20: 40, 40: 30, 41: 25 }))).toEqual([
      { frame: 20, frames: 1, change: 40 },
      { frame: 40, frames: 2, change: 30 },
    ]);
  });

  it("finds a soft same-angle punch-in that nothing near it rivals", () => {
    // dan 9.743 s: 11.3 grey levels against neighbours of about 1.
    expect(cutsIn(changes(60, 1, { 30: 11.3 }))).toEqual([
      { frame: 30, frames: 1, change: 11.3, soft: true },
    ]);
  });

  it("leaves a smaller change among moving frames or a stepped animation alone", () => {
    // Hands moving: neighbours up to 5, so 11 is not alone.
    expect(cutsIn(changes(60, 1, { 25: 5, 30: 11 }))).toEqual([]);
    // A 15 fps animation in a 30 fps file changes every other frame by about as much.
    const stepped = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0 : 10.5));
    expect(cutsIn(stepped)).toEqual([]);
    expect(cutsIn(changes(60, 1, { 30: 9 }))).toEqual([]);
  });
});

describe("confirmsCut", () => {
  it("matches a soft cut with a clear change within a frame on the other side", () => {
    const cut = { frame: 30, frames: 1, change: 11.3, soft: true as const };
    expect(confirmsCut(changes(60, 1, { 31: 7 }), cut)).toBe(true);
    expect(confirmsCut(changes(60, 1, { 32: 7 }), cut)).toBe(false);
    expect(confirmsCut(changes(60, 1, { 30: 4 }), cut)).toBe(false);
    expect(confirmsCut(changes(60, 2, { 30: 7 }), cut)).toBe(false);
  });
});

describe("findCuts", () => {
  it("reads changes from grey frames", () => {
    const frame = (v: number) => new Uint8Array(SIG_W * SIG_H).fill(v);
    const frames = [
      ...Array.from({ length: 20 }, () => frame(100)),
      ...Array.from({ length: 20 }, () => frame(140)),
    ];
    expect(findCuts(frames)).toEqual([{ frame: 20, frames: 1, change: 40 }]);
  });
});

describe("findCuts on moving pictures", () => {
  const frame = (v: number) => new Uint8Array(SIG_W * SIG_H).fill(v);
  const still = (v: number, n: number) => Array.from({ length: n }, () => frame(v));

  it("leaves a fast move drawn on twos alone: every other frame changes by 20", () => {
    expect(cutsIn(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0 : 20)))).toEqual([]);
  });

  it("still finds a cut in an animation drawn on twos", () => {
    const d: number[] = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0 : 6));
    d[30] = 60;
    expect(cutsIn(d)).toEqual([{ frame: 30, frames: 1, change: 60 }]);
  });

  it("keeps a quick insert shot as two cuts, not two flashes", () => {
    const frames = [...still(100, 20), ...still(30, 8), ...still(100, 20)];
    expect(findCuts(frames).map((c) => c.frame)).toEqual([20, 28]);
  });

  it("calls a light flash a flash and the cut after it a cut", () => {
    const frames = [...still(100, 20), ...still(250, 2), ...still(100, 20), ...still(30, 20)];
    expect(classifiedCuts(frames).map((c) => [c.frame, c.kind])).toEqual([
      [20, "flash"],
      [22, "flash"],
      [42, undefined],
    ]);
    expect(findCuts(frames).map((c) => c.frame)).toEqual([42]);
  });
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!ffmpeg)("a clip with a pan, a flash, a dissolve and one hard cut", () => {
  it("has exactly one cut", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-cuts-"));
    try {
      const out = join(dir, "clip.mp4");
      const src = (kind: string, secs: number) => `${kind}=size=160x90:rate=24:duration=${secs}`;
      // Shot one: a fast pan with a white flash at 2 s. Shot two: a dissolve from one picture to another.
      execFileSync("ffmpeg", [
        ...["-v", "error", "-y"],
        ...["-f", "lavfi", "-i", src("testsrc2", 4)],
        ...["-f", "lavfi", "-i", src("smptebars", 2)],
        ...["-f", "lavfi", "-i", src("rgbtestsrc", 2)],
        ...[
          "-filter_complex",
          [
            "[0]scroll=horizontal=0.015,eq=brightness='if(between(t,2,2.1),1,0)':eval=frame,format=yuv420p[a]",
            "[1]format=yuv420p[b]",
            "[2]format=yuv420p[c]",
            "[b][c]xfade=transition=fade:duration=1:offset=1[bc]",
            "[a][bc]concat=n=2:v=1[v]",
          ].join(";"),
        ],
        ...["-map", "[v]", "-c:v", "libx264", "-crf", "12", out],
      ]);
      const frames = signatures(["-i", out]).frames;
      expect(findCuts(frames).map((c) => c.frame)).toEqual([96]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
