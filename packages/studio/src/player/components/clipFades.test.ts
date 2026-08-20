import { describe, expect, it } from "vitest";
import type { HfAutomationPoint } from "@hyperframes/core/audio-automation";
import {
  envelopeFadeSampler,
  clampClipFades,
  fadeWedgePath,
  fadeSampler,
  MIN_FADE_SECONDS,
  NO_FADES,
  readClipFades,
  writeClipFades,
} from "./clipFades";

const DURATION = 8;
const at = (points: HfAutomationPoint[]) => points.map((p) => [p.t, p.v]);

describe("readClipFades", () => {
  it("reads a head ramp from silence as a fade in", () => {
    const points: HfAutomationPoint[] = [
      { t: 0, v: 0 },
      { t: 1.5, v: 1 },
    ];
    expect(readClipFades(points, DURATION)).toEqual({ fadeIn: 1.5, fadeOut: 0 });
  });

  it("reads a tail ramp to silence as a fade out", () => {
    const points: HfAutomationPoint[] = [
      { t: 6, v: 1 },
      { t: 8, v: 0 },
    ];
    expect(readClipFades(points, DURATION)).toEqual({ fadeIn: 0, fadeOut: 2 });
  });

  it("reads both ends of a four-point envelope", () => {
    const points: HfAutomationPoint[] = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 6.5, v: 1 },
      { t: 8, v: 0 },
    ];
    expect(readClipFades(points, DURATION)).toEqual({ fadeIn: 1, fadeOut: 1.5 });
  });

  it("claims nothing from an envelope that is not a fade", () => {
    // A duck in the middle: starts and ends at full level.
    const duck: HfAutomationPoint[] = [
      { t: 0, v: 1 },
      { t: 3, v: 0.3 },
      { t: 5, v: 0.3 },
      { t: 8, v: 1 },
    ];
    expect(readClipFades(duck, DURATION)).toEqual(NO_FADES);
    // A head ramp that does not start at silence is somebody's automation.
    expect(
      readClipFades(
        [
          { t: 0, v: 0.4 },
          { t: 2, v: 1 },
        ],
        DURATION,
      ),
    ).toEqual(NO_FADES);
    // A head ramp that does not start at the clip edge, likewise.
    expect(
      readClipFades(
        [
          { t: 1, v: 0 },
          { t: 2, v: 1 },
        ],
        DURATION,
      ),
    ).toEqual(NO_FADES);
  });

  it("ignores a fade shorter than the handle can write", () => {
    const points: HfAutomationPoint[] = [
      { t: 0, v: 0 },
      { t: MIN_FADE_SECONDS / 2, v: 1 },
    ];
    expect(readClipFades(points, DURATION).fadeIn).toBe(0);
  });

  it("still reads a fade whose envelope outlived a shortening trim", () => {
    // A 2s fade-out on an 8s clip, then trimmed to 7: the tail points still say
    // 8, but the part of the fade still inside the clip is 1s of it.
    const points: HfAutomationPoint[] = [
      { t: 6, v: 1 },
      { t: 8, v: 0 },
    ];
    expect(readClipFades(points, 7).fadeOut).toBeCloseTo(1, 6);
  });

  it("reads an empty or single-point envelope as no fades", () => {
    expect(readClipFades([], DURATION)).toEqual(NO_FADES);
    expect(readClipFades([{ t: 0, v: 1 }], DURATION)).toEqual(NO_FADES);
  });
});

describe("clampClipFades", () => {
  it("keeps two fades from overlapping by sharing the clip between them", () => {
    const clamped = clampClipFades({ fadeIn: 6, fadeOut: 6 }, DURATION);
    expect(clamped.fadeIn + clamped.fadeOut).toBeCloseTo(DURATION, 6);
    expect(clamped.fadeIn).toBeCloseTo(4, 6);
  });

  it("drops a fade dragged back below the minimum", () => {
    expect(clampClipFades({ fadeIn: 0.01, fadeOut: 0 }, DURATION).fadeIn).toBe(0);
  });

  it("never exceeds the clip", () => {
    expect(clampClipFades({ fadeIn: 99, fadeOut: 0 }, DURATION).fadeIn).toBe(DURATION);
  });
});

describe("fadeWedgePath", () => {
  const WIDTH = 200;
  const HEIGHT = 100;
  const wedge = (edge: "in" | "out", curve = 0) =>
    fadeWedgePath({
      edge,
      seconds: 2,
      sample: fadeSampler(curve),
      pixelsPerSecond: 25,
      width: WIDTH,
      height: HEIGHT,
    }).line;
  /** Every [x, y] the path visits, in order. */
  const points = (d: string) =>
    [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it("draws a fade in rising out of the clip's start", () => {
    const path = points(wedge("in"));
    expect(path.at(0)).toEqual([0, HEIGHT]); // silent, at the very start
    expect(path.at(-1)).toEqual([50, 0]); // full level, 2s in at 25px/s
  });

  it("draws a fade out falling INTO the clip's end, not out of it", () => {
    const path = points(wedge("out"));
    expect(path.at(0)).toEqual([WIDTH - 50, 0]); // still at full level, 2s from the end
    expect(path.at(-1)).toEqual([WIDTH, HEIGHT]); // silent, exactly on the end
  });

  it("draws an audio fade on exactly the line the picture fades along", () => {
    // The two are stored in different places and sampled through different
    // code, so this is the check that they still describe one shape: a bend of
    // -0.5 has to look the same on a music clip as on a video clip.
    for (const curve of [-1, -0.5, 0, 0.5, 1]) {
      const wedgeFor = (sample: (p: number) => number) =>
        points(
          fadeWedgePath({
            edge: "in",
            seconds: 2,
            sample,
            pixelsPerSecond: 25,
            width: WIDTH,
            height: HEIGHT,
          }).line,
        );
      const visual = wedgeFor(fadeSampler(curve));
      const audio = wedgeFor(envelopeFadeSampler(curve));
      expect(visual.length).toBeGreaterThan(5);
      expect(audio).toHaveLength(visual.length);
      for (const [index, [x, y]] of visual.entries()) {
        expect(audio[index]![0]).toBeCloseTo(x, 1);
        expect(audio[index]![1]).toBeCloseTo(y, 0);
      }
    }
  });

  it("samples a bent fade instead of drawing a straight line", () => {
    // A bend of -0.5 is p², so a quarter of the way in the level is 0.0625 and
    // the line sits well below the straight one (larger y is quieter).
    const quarter = points(wedge("in", -0.5)).find(([x]) => Math.abs(x - 12.5) < 1.1);
    expect(quarter?.[1]).toBeCloseTo((1 - 0.0625) * HEIGHT, 1);

    // Bent the other way it sits above the line by the same reasoning.
    const bulged = points(wedge("in", 0.5)).find(([x]) => Math.abs(x - 12.5) < 1.1);
    expect(bulged?.[1]).toBeCloseTo((1 - 0.5) * HEIGHT, 1);
  });

  it("draws nothing for a fade of no length", () => {
    expect(
      fadeWedgePath({
        edge: "in",
        seconds: 0,
        sample: fadeSampler(0),
        pixelsPerSecond: 25,
        width: WIDTH,
        height: HEIGHT,
      }),
    ).toEqual({ line: "", fill: "" });
  });

  it("keeps the stroked line open so the fill's closing edges are not outlined", () => {
    const { line, fill } = fadeWedgePath({
      edge: "in",
      seconds: 2,
      sample: fadeSampler(0),
      pixelsPerSecond: 25,
      width: WIDTH,
      height: HEIGHT,
    });
    // The line is the level and nothing else: no close, no corner.
    expect(line).not.toContain("Z");
    expect(points(line).at(0)).toEqual([0, HEIGHT]);
    expect(points(line).at(-1)).toEqual([50, 0]);
    // The fill is that line closed back through the clip's corner.
    expect(fill.startsWith(line)).toBe(true);
    expect(fill.endsWith("L 0 0 Z")).toBe(true);
  });
});

describe("writeClipFades", () => {
  it("writes a head ramp that reads back as the same fade", () => {
    const points = writeClipFades([], DURATION, { fadeIn: 1.5, fadeOut: 0 });
    expect(at(points)).toEqual([
      [0, 0],
      [1.5, 1],
    ]);
    expect(readClipFades(points, DURATION)).toEqual({ fadeIn: 1.5, fadeOut: 0 });
  });

  it("writes both ends in time order", () => {
    const points = writeClipFades([], DURATION, { fadeIn: 1, fadeOut: 2 });
    expect(at(points)).toEqual([
      [0, 0],
      [1, 1],
      [6, 1],
      [8, 0],
    ]);
    expect(readClipFades(points, DURATION)).toEqual({ fadeIn: 1, fadeOut: 2 });
  });

  it("carries the author's own points across a fade edit", () => {
    const authored: HfAutomationPoint[] = [
      { t: 3, v: 0.4 },
      { t: 5, v: 0.9 },
    ];
    const points = writeClipFades(authored, DURATION, { fadeIn: 1, fadeOut: 1 });
    expect(at(points)).toEqual([
      [0, 0],
      [1, 1],
      [3, 0.4],
      [5, 0.9],
      [7, 1],
      [8, 0],
    ]);
  });

  it("replaces an existing fade rather than stacking a second one on it", () => {
    const first = writeClipFades([], DURATION, { fadeIn: 2, fadeOut: 0 });
    const second = writeClipFades(first, DURATION, { fadeIn: 0.5, fadeOut: 0 });
    expect(at(second)).toEqual([
      [0, 0],
      [0.5, 1],
    ]);
  });

  it("removes the fade — and the whole envelope — when dragged back to zero", () => {
    const faded = writeClipFades([], DURATION, { fadeIn: 2, fadeOut: 1 });
    expect(writeClipFades(faded, DURATION, NO_FADES)).toEqual([]);
  });

  it("leaves the author's points behind when the fades are removed", () => {
    const authored: HfAutomationPoint[] = [{ t: 4, v: 0.5 }];
    const faded = writeClipFades(authored, DURATION, { fadeIn: 1, fadeOut: 1 });
    expect(at(writeClipFades(faded, DURATION, NO_FADES))).toEqual([[4, 0.5]]);
  });

  it("bends the segment leaving the fade's silent end", () => {
    const bent = writeClipFades([], DURATION, { fadeIn: 1, fadeOut: 1 }, { in: -0.5, out: -0.5 });
    // The envelope stores the same bend with the opposite sign; see
    // envelopeCurveForFade. Both ends carry it, each on the point it leaves.
    expect(bent[0]?.curve).toBeCloseTo(0.5, 6);
    expect(bent[2]?.curve).toBeCloseTo(0.5, 6);
    // A straight fade writes no curvature at all rather than an explicit zero.
    expect(
      writeClipFades([], DURATION, { fadeIn: 1, fadeOut: 0 }, { in: 0, out: 0 })[0]?.curve,
    ).toBeUndefined();
  });

  it("gives each ramp its own curvature, on the point it leaves", () => {
    const apart = writeClipFades([], DURATION, { fadeIn: 1, fadeOut: 1 }, { in: -0.5, out: 0.25 });
    expect(apart[0]?.curve).toBeCloseTo(0.5, 6);
    expect(apart[2]?.curve).toBeCloseTo(-0.25, 6);
  });

  it("leaves a straight ramp bare even when the other one is bent", () => {
    const half = writeClipFades([], DURATION, { fadeIn: 1, fadeOut: 1 }, { in: 0, out: -0.5 });
    expect(half[0]?.curve).toBeUndefined();
    expect(half[2]?.curve).toBeCloseTo(0.5, 6);
  });
});
