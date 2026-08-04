import { describe, expect, it } from "vitest";
import {
  applyCurve,
  fxAutomationTarget,
  isConstantLane,
  parseAutomation,
  parseAutomationTarget,
  resolveAutomation,
  resolveAutomationRange,
  sampleAutomationCurve,
  sampleAutomationLane,
  serializeAutomation,
  VOLUME_RANGE,
  type HfAutomationLane,
} from "./audioAutomation.js";
import { mintAudioFxNodeId, parseAudioFxChain, type HfAudioFxChain } from "./audioFx.js";

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

  it("clamps volume into 0..1 at parse time", () => {
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
    expect(parsed.lanes[0]!.points.map((p) => p.v)).toEqual([1, 0]);
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
