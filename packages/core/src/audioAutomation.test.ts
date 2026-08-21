import { describe, expect, it } from "vitest";
import {
  applyCurve,
  shapeProgress,
  fxAutomationTarget,
  HF_AUDIO_AUTOMATION_ATTR,
  HF_AUDIO_AUTOMATION_DATA_KEY,
  isConstantLane,
  parseAutomation,
  parseAutomationTarget,
  resolveAutomation,
  resolveAutomationRange,
  sampleAutomationCurve,
  sampleAutomationLane,
  serializeAutomation,
  steadyViaPoint,
  VOLUME_RANGE,
  type HfAutomationLane,
} from "./audioAutomation.js";
import { mintAudioFxNodeId, parseAudioFxChain, type HfAudioFxChain } from "./audioFx.js";
import { MAX_AUDIO_GAIN } from "./audioGain.js";

const chain: HfAudioFxChain = {
  version: 1,
  nodes: [
    { type: "peaking", id: "n1", enabled: true, params: { frequency: 1000, gain: 0, Q: 1 } },
    { type: "highpass", id: "n2", enabled: true, params: {} },
  ],
};

const lane = (points: HfAutomationLane["points"], target = "volume"): HfAutomationLane => ({
  target,
  points,
});

describe("the automation attribute's two spellings", () => {
  it("names the same attribute either way", () => {
    // Same split as the FX chain: written as an attribute, read as a dataset
    // key. Derived, so a rename cannot half-land.
    expect(HF_AUDIO_AUTOMATION_ATTR).toBe(`data-${HF_AUDIO_AUTOMATION_DATA_KEY}`);
  });
});

describe("targets", () => {
  it("reads volume and fx targets, and rejects anything else", () => {
    expect(parseAutomationTarget("volume")).toEqual({ kind: "volume" });
    expect(parseAutomationTarget("fx.n1.frequency")).toEqual({
      kind: "fx",
      nodeId: "n1",
      param: "frequency",
    });
    expect(parseAutomationTarget("fx.n1")).toBeNull();
    expect(parseAutomationTarget("gain")).toBeNull();
    expect(parseAutomationTarget("")).toBeNull();
  });

  it("resolves a range from the registry, not from the lane", () => {
    const r = resolveAutomationRange(fxAutomationTarget("n1", "frequency"), chain);
    expect(r).not.toBeNull();
    expect(r?.scale).toBe("log");
    expect(r?.unit).toBe("Hz");
    expect(r?.min).toBeGreaterThan(0);
    expect(resolveAutomationRange("volume", chain)).toEqual(VOLUME_RANGE);
  });

  it("has no range for a missing node, a missing param, or an enum param", () => {
    expect(resolveAutomationRange("fx.nope.frequency", chain)).toBeNull();
    expect(resolveAutomationRange("fx.n1.nonsense", chain)).toBeNull();
    // `poles` is an enum: there is no envelope between one and two poles.
    expect(resolveAutomationRange("fx.n2.poles", chain)).toBeNull();
  });
});

describe("normalisation", () => {
  it("sorts points and collapses duplicate times, keeping the later value", () => {
    const parsed = parseAutomation(
      JSON.stringify({
        version: 1,
        lanes: [
          {
            target: "volume",
            points: [
              { t: 2, v: 0.2 },
              { t: 0, v: 1 },
              { t: 2, v: 0.9 },
            ],
          },
        ],
      }),
    );
    expect(parsed.lanes[0]!.points).toEqual([
      { t: 0, v: 1 },
      { t: 2, v: 0.9 },
    ]);
  });

  it("drops non-finite points rather than letting NaN reach an AudioParam", () => {
    const parsed = parseAutomation(
      JSON.stringify({
        version: 1,
        lanes: [
          {
            target: "volume",
            points: [
              { t: 0, v: 0.5 },
              { t: 1, v: null },
              { t: "x", v: 1 },
              { t: 2, v: 0.25 },
            ],
          },
        ],
      }),
    );
    expect(parsed.lanes[0]!.points).toEqual([
      { t: 0, v: 0.5 },
      { t: 2, v: 0.25 },
    ]);
  });

  it("clamps volume into the authoring gain range at parse time", () => {
    const parsed = parseAutomation(
      JSON.stringify({
        version: 1,
        lanes: [
          {
            target: "volume",
            points: [
              { t: 0, v: 4 },
              { t: 1, v: -2 },
            ],
          },
        ],
      }),
    );
    // The lane shares the fader's ceiling. Clamping it at unity discarded the
    // boost of any clip authored above 0 dB the moment it was automated.
    expect(parsed.lanes[0]!.points.map((p) => p.v)).toEqual([MAX_AUDIO_GAIN, 0]);
  });

  it("refuses malformed input instead of silently losing an envelope", () => {
    expect(() => parseAutomation("{")).toThrow(/not valid JSON/);
    expect(() => parseAutomation(JSON.stringify({ version: 9, lanes: [] }))).toThrow(
      /Unsupported automation version/,
    );
    expect(() => parseAutomation(JSON.stringify({ version: 1 }))).toThrow(/lanes/);
    expect(() =>
      parseAutomation(JSON.stringify({ version: 1, lanes: [{ target: "nope", points: [] }] })),
    ).toThrow(/unreadable target/);
  });

  it("round-trips through the attribute", () => {
    const source = {
      version: 1,
      lanes: [
        lane([
          { t: 0, v: 0.8 },
          { t: 3, v: 0.2, curve: 0.5 },
        ]),
        lane(
          [
            { t: 0, v: 200 },
            { t: 4, v: 8000 },
          ],
          "fx.n1.frequency",
        ),
      ],
    };
    expect(parseAutomation(serializeAutomation(source))).toEqual(source);
  });

  it("round-trips a via point, and keeps it as a pair", () => {
    const source = {
      version: 1,
      lanes: [
        lane([
          // A via point with no `curve` at all: the bend is entirely described by
          // where the segment goes. It has to survive on its own, or a bend
          // dragged near a breakpoint silently straightens on the next load.
          { t: 0, v: 0.8, viaX: 0.7, viaY: 0.6 },
          { t: 2, v: 0.2, curve: 0.5, viaX: 0.3, viaY: 0.44 },
          { t: 3, v: 0.5 },
        ]),
      ],
    };
    expect(parseAutomation(serializeAutomation(source))).toEqual(source);
  });

  it("drops a via point that says nothing, and clamps one off the segment", () => {
    const parsed = parseAutomation(
      JSON.stringify({
        version: 1,
        lanes: [
          {
            target: "volume",
            points: [
              // Half a via point describes no shape; taking one coordinate on its
              // own would leave the segment's shape depending on which half
              // survived a hand edit.
              { t: 0, v: 0.5, viaX: 0.4 },
              // On the diagonal: this IS the straight line, so storing it would
              // claim a bend the segment does not have.
              { t: 1, v: 0.6, viaX: 0.4, viaY: 0.4 },
              // Outside the segment entirely: pulled back to the steady region
              // rather than describing a shape no curve can draw.
              { t: 2, v: 0.7, viaX: 5, viaY: -3 },
              { t: 3, v: 1 },
            ],
          },
        ],
      }),
    );
    const points = parsed.lanes[0]!.points;
    expect(points[0]).not.toHaveProperty("viaX");
    expect(points[1]).not.toHaveProperty("viaX");
    expect(points[2]!.viaX).toBeCloseTo(0.999, 6);
    expect(points[2]!.viaY).toBeCloseTo(0.001, 6);
  });
});

describe("resolveAutomation", () => {
  it("drops lanes whose effect was deleted and clamps the rest to the registry", () => {
    const resolved = resolveAutomation(
      {
        version: 1,
        lanes: [
          lane([{ t: 0, v: 1_000_000 }], "fx.n1.frequency"),
          lane([{ t: 0, v: 0.5 }], "fx.gone.frequency"),
          lane([{ t: 0, v: 0.5 }]),
        ],
      },
      chain,
    );
    expect(resolved.lanes.map((l) => l.target)).toEqual(["fx.n1.frequency", "volume"]);
    const range = resolveAutomationRange("fx.n1.frequency", chain);
    expect(resolved.lanes[0]!.points[0]!.v).toBe(range?.max);
  });

  it("drops every fx lane when the track has no chain at all", () => {
    const resolved = resolveAutomation(
      { version: 1, lanes: [lane([{ t: 0, v: 1 }], "fx.n1.frequency"), lane([{ t: 0, v: 1 }])] },
      undefined,
    );
    expect(resolved.lanes.map((l) => l.target)).toEqual(["volume"]);
  });
});

describe("sampling", () => {
  const ramp = lane([
    { t: 1, v: 0 },
    { t: 3, v: 1 },
  ]);

  it("holds the end values outside the points", () => {
    expect(sampleAutomationLane(ramp, 0)).toBe(0);
    expect(sampleAutomationLane(ramp, 1)).toBe(0);
    expect(sampleAutomationLane(ramp, 3)).toBe(1);
    expect(sampleAutomationLane(ramp, 99)).toBe(1);
  });

  it("interpolates linearly between them", () => {
    expect(sampleAutomationLane(ramp, 2)).toBeCloseTo(0.5, 10);
    expect(sampleAutomationLane(ramp, 1.5)).toBeCloseTo(0.25, 10);
  });

  it("interpolates a log-scaled parameter in log space", () => {
    const sweep = lane(
      [
        { t: 0, v: 200 },
        { t: 4, v: 8000 },
      ],
      "fx.n1.frequency",
    );
    // Halfway through the sweep is the geometric mean, not the arithmetic one:
    // an even-sounding sweep, which is what a log knob already promises.
    expect(sampleAutomationLane(sweep, 2, "log")).toBeCloseTo(Math.sqrt(200 * 8000), 6);
    expect(sampleAutomationLane(sweep, 2, "linear")).toBeCloseTo(4100, 6);
  });

  it("bends a segment with curve, staying pinned at both ends", () => {
    const bent = lane([
      { t: 0, v: 0, curve: 1 },
      { t: 1, v: 1 },
    ]);
    expect(sampleAutomationLane(bent, 0)).toBe(0);
    expect(sampleAutomationLane(bent, 1)).toBe(1);
    // Positive curve holds low and rises late.
    expect(sampleAutomationLane(bent, 0.5)).toBeLessThan(0.5);
    const eased = lane([
      { t: 0, v: 0, curve: -1 },
      { t: 1, v: 1 },
    ]);
    expect(sampleAutomationLane(eased, 0.5)).toBeGreaterThan(0.5);
    expect(applyCurve(0.5, 0)).toBe(0.5);
  });

  it("leaves a legacy curve-only point sampling exactly as it always did", () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(shapeProgress(x, { curve: 0.5 })).toBe(Math.pow(x, Math.pow(2, 1)));
    }
    expect(shapeProgress(0.5, {})).toBe(0.5);
  });

  it("passes exactly through any via point, however deep or off-centre", () => {
    // The contract the drag depends on: the pointer's position IS the shape. No
    // depth cap and no position cap — an earlier version held bends to a maximum
    // slope, which capped how far the line could be pulled and, worse, could clamp a
    // bend onto the straight line and flatten it mid-drag.
    for (const [vx, vy] of [
      [0.5, 0.7],
      [0.5, 0.95],
      [0.2, 0.8],
      [0.1, 0.9],
      [0.05, 0.95],
      [0.9, 0.15],
      [0.3, 0.05],
      [0.95, 0.55],
    ] as const) {
      expect(shapeProgress(vx, { viaX: vx, viaY: vy })).toBeCloseTo(vy, 6);
    }
  });

  it("puts the curve's furthest point from straight exactly at the via point", () => {
    // "The cursor is the apex": not near it, at it. The conic passes through the via
    // point at its own midparameter, and its two halves are symmetric in parameter,
    // so the deepest departure from the straight line lands there by construction.
    for (const [vx, vy] of [
      [0.1, 0.9],
      [0.2, 0.8],
      [0.5, 0.95],
      [0.8, 0.3],
      [0.9, 0.15],
      [0.95, 0.55],
    ] as const) {
      let deepest = 0;
      let at = 0;
      for (let k = 1; k < 1000; k++) {
        const x = k / 1000;
        const gap = Math.abs(shapeProgress(x, { viaX: vx, viaY: vy }) - x);
        if (gap > deepest) {
          deepest = gap;
          at = x;
        }
      }
      expect(at).toBeCloseTo(vx, 2);
      expect(deepest).toBeCloseTo(Math.abs(vy - vx), 2);
    }
  });

  it("reaches a bend far deeper than a plain quadratic could", () => {
    // A plain quadratic needs its control point at 2Q - M, which leaves the segment
    // once the via point is past the middle half — so it cannot pass through a deep
    // point at all. The conic's weight is what buys the reach.
    expect(shapeProgress(0.1, { viaX: 0.1, viaY: 0.9 })).toBeCloseTo(0.9, 6);
    expect(shapeProgress(0.05, { viaX: 0.05, viaY: 0.95 })).toBeCloseTo(0.95, 6);
  });

  it("never returns NaN for a via point dragged past the segment edge", () => {
    // A via point pulled out to (5, -3) clamps to (0.999, 0.001) — exactly on the
    // steady region's edge, where `edge - viaX` is 0 and the conic's weight used
    // to divide out to Infinity, then NaN a few steps later. NaN reaching
    // setValueCurveAtTime silences the node for the rest of the render.
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const y = shapeProgress(x, { viaX: 5, viaY: -3 });
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("never flattens a bend that is pulled harder", () => {
    // The regression. Holding a bend's depth inside the steady region by clamping
    // its coordinates one at a time snapped the curve flat mid-drag: near the ends
    // of a segment almost every legal value sits on ONE side of the straight line,
    // so a bend pulled the other way got clamped onto the line itself and vanished.
    // Pulling further has to keep bending the way the pointer asked, always.
    for (const viaX of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const viaY of [0.9, 0.6, 0.45, 0.3, 0.05, -0.5, 1.5]) {
        if (Math.abs(viaY - viaX) < 0.02) continue;
        const via = steadyViaPoint(viaX, viaY);
        expect(via).not.toBeNull();
        if (!via) continue;
        // Same side of the straight line as the pointer asked for.
        expect(Math.sign(via.viaY - via.viaX)).toBe(Math.sign(viaY - viaX));
        // And a bend worth seeing, not a hair off straight.
        expect(Math.abs(via.viaY - via.viaX)).toBeGreaterThan(0.01);
      }
    }
  });

  it("stays a steady curve through the via point, with no corner to see", () => {
    // A shape built from two curves meeting AT the via point can only be as smooth
    // as that join, and keeping such a join monotone forces its tangent down to a
    // fraction of the slope the curve arrives with — which reads as a sharp corner
    // exactly where the pointer is. One conic arc has no join: slope is continuous
    // by construction, so the ratio across the via point stays near 1 even for the
    // extreme bends where a spliced curve kinked hardest.
    const slopeAt = (x: number, viaX: number, viaY: number): number => {
      const h = 1e-4;
      return (
        (shapeProgress(x + h, { viaX, viaY }) - shapeProgress(x - h, { viaX, viaY })) / (2 * h)
      );
    };
    for (const [viaX, viaY] of [
      [0.1, 0.9],
      [0.9, 0.1],
      [0.15, 0.6],
      [0.8, 0.95],
      [0.5, 0.95],
      [0.5, 0.05],
    ] as const) {
      const before = slopeAt(viaX - 0.02, viaX, viaY);
      const after = slopeAt(viaX + 0.02, viaX, viaY);
      expect(before).toBeGreaterThan(0);
      expect(after).toBeGreaterThan(0);
      // Within a factor of 2.2 across a 4% window either side — that much is real
      // curvature on a tight bend. Two cubics spliced at the via point measured
      // 27.6 on the first of these, and 2.4-3.6 on the gentler ones.
      const ratio = before > after ? before / after : after / before;
      expect(ratio).toBeLessThan(2.2);
    }
  });

  it("never changes slope abruptly anywhere along the segment", () => {
    // The same property swept rather than probed at the via point, so a corner
    // introduced anywhere else would fail too.
    for (const [viaX, viaY] of [
      [0.2, 0.8],
      [0.85, 0.35],
      [0.5, 0.9],
      [0.1, 0.9],
      [0.9, 0.08],
    ] as const) {
      let previous: number | null = null;
      for (let k = 2; k < 98; k++) {
        const x = k / 100;
        const h = 1e-3;
        const slope =
          (shapeProgress(x + h, { viaX, viaY }) - shapeProgress(x - h, { viaX, viaY })) / (2 * h);
        if (previous !== null) {
          const ratio = slope > previous ? slope / previous : previous / slope;
          // 1% of the segment at a time: a steady curve changes slope gradually.
          // The spliced version measured 2.2 here, and 14.5 with the via point
          // dragged into a corner.
          expect(ratio).toBeLessThan(1.7);
        }
        previous = slope;
      }
    }
  });

  it("keeps the segment pinned at both breakpoints", () => {
    for (const [vx, vy] of [
      [0.2, 0.7],
      [0.85, 0.3],
    ] as const) {
      expect(shapeProgress(0, { viaX: vx, viaY: vy })).toBeCloseTo(0, 9);
      expect(shapeProgress(1, { viaX: vx, viaY: vy })).toBeCloseTo(1, 9);
    }
  });

  it("stays monotone for every via point, so a render never sags mid-segment", () => {
    // Not cosmetic: a segment is baked into setValueCurveAtTime, and progress
    // that dipped backwards is a rising fader audibly dropping. This is the
    // property the Fritsch-Carlson tangent limit is there to guarantee, so it is
    // swept rather than spot-checked.
    for (let ix = 1; ix < 20; ix++) {
      for (let iy = 1; iy < 20; iy++) {
        const viaX = ix / 20;
        const viaY = iy / 20;
        let previous = -Infinity;
        for (let k = 0; k <= 60; k++) {
          const y = shapeProgress(k / 60, { viaX, viaY });
          expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = y;
        }
      }
    }
  });

  it("puts the bend where the via point is, not always on the same side", () => {
    // The complaint this replaced: every upward bend a single exponent could draw
    // deviated most in the first fifth of the segment. Now the peak deviation
    // tracks the via point across the whole span.
    const apexOf = (viaX: number, viaY: number): number => {
      let best = 0;
      let at = 0;
      for (let k = 1; k < 100; k++) {
        const x = k / 100;
        const gap = Math.abs(shapeProgress(x, { viaX, viaY }) - x);
        if (gap > best) {
          best = gap;
          at = x;
        }
      }
      return at;
    };
    // Near, not exactly at: the deviation is smooth through the knot, so its peak
    // can sit slightly inside. What matters is that it tracks the via point
    // across the whole segment instead of parking in the first fifth.
    for (const viaX of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      expect(Math.abs(apexOf(viaX, viaX + 0.06) - viaX)).toBeLessThan(0.12);
    }
    expect(apexOf(0.3, 0.36)).toBeLessThan(apexOf(0.7, 0.76));
  });

  it("bends either way from the same via progress", () => {
    const at = (viaY: number) =>
      sampleAutomationLane(
        lane([
          { t: 0, v: 0, viaX: 0.7, viaY },
          { t: 1, v: 1 },
        ]),
        0.7,
      );
    expect(at(0.56)).toBeCloseTo(0.56, 6);
    expect(at(0.73)).toBeCloseTo(0.73, 6);
  });

  it("walks a dense lane by bisection, not by scanning", () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ t: i, v: i % 2 }));
    const dense = lane(points);
    expect(sampleAutomationLane(dense, 100)).toBe(0);
    expect(sampleAutomationLane(dense, 101)).toBe(1);
    expect(sampleAutomationLane(dense, 100.5)).toBeCloseTo(0.5, 10);
  });

  it("caps a pathological lane so the scheduler cannot be hung", () => {
    const parsed = parseAutomation(
      JSON.stringify({
        version: 1,
        lanes: [
          { target: "volume", points: Array.from({ length: 5000 }, (_, i) => ({ t: i, v: 0.5 })) },
        ],
      }),
    );
    expect(parsed.lanes[0]!.points.length).toBe(512);
  });

  it("samples a curve at both endpoints", () => {
    const curve = sampleAutomationCurve(ramp, 1, 3, 5);
    expect(curve.length).toBe(5);
    expect(curve[0]).toBe(0);
    expect(curve[4]).toBe(1);
    expect(curve[2]).toBeCloseTo(0.5, 6);
  });

  it("spots a lane not worth scheduling", () => {
    expect(isConstantLane(lane([{ t: 0, v: 0.5 }]))).toBe(true);
    expect(
      isConstantLane(
        lane([
          { t: 0, v: 0.5 },
          { t: 2, v: 0.5 },
        ]),
      ),
    ).toBe(true);
    expect(isConstantLane(ramp)).toBe(false);
  });
});

describe("chain node ids", () => {
  it("mints the first free id and survives a round trip", () => {
    expect(mintAudioFxNodeId({ version: 1, nodes: [] })).toBe("n1");
    expect(mintAudioFxNodeId(chain)).toBe("n3");
    const gap: HfAudioFxChain = { version: 1, nodes: [{ type: "peaking", id: "n2" }] };
    expect(mintAudioFxNodeId(gap)).toBe("n1");
  });

  it("keeps ids through parse so lanes stay pointed at the same effect", () => {
    const json = JSON.stringify({
      version: 1,
      nodes: [{ type: "peaking", id: "n7", params: {} }],
    });
    expect(parseAudioFxChain(json).nodes[0]!.id).toBe("n7");
  });
});
