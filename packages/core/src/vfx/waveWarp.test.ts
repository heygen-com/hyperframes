import { describe, expect, it } from "vitest";
import { WAVE_WARP_FRAG } from "./waveWarp.frag";
import { waveWarpSampleRef } from "./refs/waveWarp";
import { getVfxDef, normalizeVfxParams } from "../vfx";

/** Corpus point: Sine, Direction 0, Speed 1, Pinning 1, Phase 0. */
const SINE = { waveType: 1, direction: 0, speed: 1, pinning: 1, phase: 0 };
const P = { x: 137, y: 61 };

describe("wave-warp def", () => {
  it("is registered as a self-capture kernel with the real fragment source", () => {
    const def = getVfxDef("wave-warp")!;
    expect(def.capture).toBe("self");
    expect(def.ae).toBe("ADBE Wave Warp");
    expect(def.frag).toBe(WAVE_WARP_FRAG);
    expect(WAVE_WARP_FRAG.startsWith("#version 300 es")).toBe(true);
  });

  it("normalizes an unimplemented wave type and pinning back to the v1 pair", () => {
    const p = normalizeVfxParams("wave-warp", { waveType: 3, pinning: 5 });
    expect(p["waveType"]).toBe(1);
    expect(p["pinning"]).toBe(1);
  });
});

describe("waveWarpSampleRef", () => {
  it("is the identity sample at height 0", () => {
    expect(waveWarpSampleRef(P, 1.25, { ...SINE, height: 0, width: 93.4 })).toEqual(P);
  });

  it("displaces perpendicular to the direction of travel", () => {
    // Direction 0 travels along −y, so the displacement is purely horizontal.
    const s = waveWarpSampleRef(P, 0, { ...SINE, height: 20, width: 93.4 });
    expect(s.y).toBe(P.y);
    expect(s.x).not.toBe(P.x);
  });

  it("is periodic in `width` along the direction of travel", () => {
    const opts = { ...SINE, height: 20, width: 80 };
    const a = waveWarpSampleRef(P, 0, opts);
    const b = waveWarpSampleRef({ x: P.x, y: P.y - 80 }, 0, opts);
    expect(b.x - P.x).toBeCloseTo(a.x - P.x, 10);
  });

  it("flips sign with a negative height", () => {
    const up = waveWarpSampleRef(P, 0, { ...SINE, height: 20, width: 93.4 });
    const down = waveWarpSampleRef(P, 0, { ...SINE, height: -20, width: 93.4 });
    expect(up.x - P.x).toBeCloseTo(-(down.x - P.x), 12);
  });

  it("scales the displacement linearly with height", () => {
    const one = waveWarpSampleRef(P, 0, { ...SINE, height: 10, width: 93.4 });
    const two = waveWarpSampleRef(P, 0, { ...SINE, height: 20, width: 93.4 });
    expect(two.x - P.x).toBeCloseTo(2 * (one.x - P.x), 10);
  });

  it("advances one whole wave per second at speed 1", () => {
    const opts = { ...SINE, height: 20, width: 93.4, speed: 1 };
    expect(waveWarpSampleRef(P, 1, opts).x).toBeCloseTo(waveWarpSampleRef(P, 0, opts).x, 10);
    expect(waveWarpSampleRef(P, 0.5, opts).x).not.toBeCloseTo(waveWarpSampleRef(P, 0, opts).x, 6);
  });

  it("treats phase as degrees of the same wave", () => {
    const opts = { ...SINE, height: 20, width: 93.4, speed: 0 };
    expect(waveWarpSampleRef(P, 0, { ...opts, phase: 360 }).x).toBeCloseTo(
      waveWarpSampleRef(P, 0, opts).x,
      10,
    );
  });

  it("is a pure function of its inputs", () => {
    const at = () => waveWarpSampleRef(P, 0.37, { ...SINE, height: 21, width: 93.4 });
    expect(at()).toEqual(at());
  });
});
