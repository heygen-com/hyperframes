import { describe, expect, it } from "vitest";
import { FRACTAL_NOISE_FRAG, HASH_CONSTANTS } from "./fractalNoise.frag";
import { fractalNoiseHashUnit, fractalNoiseRef } from "./refs/fractalNoise";
import { getVfxDef } from "../vfx";

/** Complexity 1, contrast 100, brightness 0: the kernel is one raw octave. */
const FLAT = { complexity: 1, contrast: 100, brightness: 0, scale: 100, subScaling: 56 };

describe("fractal-noise hash", () => {
  /**
   * Four values computed from the chosen mixer BEFORE it was written into
   * either the GLSL or the CPU reference. They pin the hash: a later refactor
   * that changes the picture cannot pass this test quietly.
   */
  it.each([
    [0, 0, 0, 0.5737507424782962],
    [1, 0, 0, 0.48128097131848335],
    [0, 1, 0, 0.76671754848212],
    [-3, 7, 42, 0.4487817834597081],
  ])("hashes lattice corner (%i, %i) seed %i", (ix, iy, seed, expected) => {
    expect(fractalNoiseHashUnit(ix, iy, seed)).toBeCloseTo(expected, 15);
  });

  it("builds the GLSL from the same constants the CPU reference uses", () => {
    for (const value of Object.values(HASH_CONSTANTS)) {
      expect(FRACTAL_NOISE_FRAG).toContain(String(value));
    }
  });

  it("is the def's fragment source, not the registry placeholder", () => {
    expect(getVfxDef("fractal-noise")!.frag).toBe(FRACTAL_NOISE_FRAG);
    expect(FRACTAL_NOISE_FRAG.startsWith("#version 300 es")).toBe(true);
  });
});

describe("fractalNoiseRef", () => {
  it("returns the same value for the same inputs twice", () => {
    const at = () => fractalNoiseRef({ x: 137, y: 61 }, 1.25, { scale: 411, contrast: 562 });
    expect(at()).toBe(at());
  });

  it("differs between random seeds", () => {
    const p = { x: 137, y: 61 };
    const a = fractalNoiseRef(p, 0, { ...FLAT, randomSeed: 0 });
    const b = fractalNoiseRef(p, 0, { ...FLAT, randomSeed: 1 });
    expect(a).not.toBe(b);
  });

  it("stays inside [0, 1] at contrast 100 across the frame", () => {
    for (let y = 0; y < 180; y += 17) {
      for (let x = 0; x < 320; x += 23) {
        const v = fractalNoiseRef({ x, y }, 0, { contrast: 100, scale: 411 });
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is the bare lattice value at a lattice corner with one octave", () => {
    // scale 100 ⇒ one lattice cell per 100 device pixels, so (200, 300) is the
    // integer corner (2, 3) and no interpolation happens.
    expect(fractalNoiseRef({ x: 200, y: 300 }, 0, FLAT)).toBeCloseTo(
      fractalNoiseHashUnit(2, 3, 0),
      12,
    );
  });

  it("inverts about 1 when `invert` is set", () => {
    const p = { x: 137, y: 61 };
    const plain = fractalNoiseRef(p, 0, { ...FLAT, scale: 411 });
    const inverted = fractalNoiseRef(p, 0, { ...FLAT, scale: 411, invert: true });
    expect(plain + inverted).toBeCloseTo(1, 12);
  });

  it("raises contrast around the 0.5 midpoint and clamps at the ends", () => {
    const p = { x: 137, y: 61 };
    const plain = fractalNoiseRef(p, 0, { ...FLAT, scale: 411 });
    const punchy = fractalNoiseRef(p, 0, { ...FLAT, scale: 411, contrast: 200 });
    expect(punchy).toBeCloseTo(Math.min(1, Math.max(0, (plain - 0.5) * 2 + 0.5)), 12);
    expect(fractalNoiseRef(p, 0, { ...FLAT, scale: 411, contrast: 1000 })).toBeLessThanOrEqual(1);
  });

  it("moves the field when evolution advances", () => {
    const p = { x: 137, y: 61 };
    expect(fractalNoiseRef(p, 0, { ...FLAT, scale: 411, evolution: 0 })).not.toBe(
      fractalNoiseRef(p, 0, { ...FLAT, scale: 411, evolution: 0.25 }),
    );
  });

  it("clamps a param the caller put outside the def's range", () => {
    const p = { x: 137, y: 61 };
    expect(fractalNoiseRef(p, 0, { ...FLAT, scale: 411, contrast: 99999 })).toBe(
      fractalNoiseRef(p, 0, { ...FLAT, scale: 411, contrast: 1000 }),
    );
  });
});
