import { describe, expect, it } from "vitest";
import { NOISE_CONSTANTS, NOISE_FRAG } from "./noise.frag";
import { noiseByteRef, noiseOffsetRef, noiseSeedRef } from "./refs/noise";
import { getVfxDef, normalizeVfxParams } from "../vfx";

const FPS = 30;
const P = { x: 137, y: 61 };

describe("noise def", () => {
  it("is registered as a capturing kernel with the real fragment source", () => {
    const def = getVfxDef("noise")!;
    expect(def.capture).toBe("self");
    expect(def.ae).toBe("ADBE Noise");
    expect(def.frag).toBe(NOISE_FRAG);
    expect(NOISE_FRAG.startsWith("#version 300 es")).toBe(true);
  });

  it("names the three params the metallib's struct names", () => {
    // `ADBE Noise-0002` is Use Color Noise — `inUseColorNoise` in
    // `NoiseKernelValues` — not the Uniform/Gaussian popup the deep dive
    // guessed from the parameter list alone.
    expect(getVfxDef("noise")!.params.map((p) => p.key)).toEqual([
      "amount",
      "useColorNoise",
      "clipping",
    ]);
  });

  it("defaults to clipped monochrome noise at zero amount", () => {
    expect(normalizeVfxParams("noise", {})).toEqual({
      amount: 0,
      useColorNoise: false,
      clipping: true,
    });
  });
});

describe("noiseByteRef", () => {
  it("stays inside the 15 bits the two masks can produce", () => {
    const max = NOISE_CONSTANTS.highMask | NOISE_CONSTANTS.lowMask;
    for (let x = 0; x < 64; x++) {
      const byte = noiseByteRef(x, 3, 0);
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(max);
    }
  });

  it("spreads roughly uniformly over its range", () => {
    // The distribution, not After Effects parity: until the Task 4.3 seed
    // probe lands, parity is unmeasurable, but a hash that clumps would be
    // wrong under any seed.
    const buckets = new Array<number>(8).fill(0);
    let sum = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const byte = noiseByteRef(x, y, 0);
        sum += byte;
        buckets[Math.min(7, Math.floor(byte / 4096))]! += 1;
      }
    }
    expect(sum / 4096).toBeGreaterThan(14884);
    expect(sum / 4096).toBeLessThan(17884);
    for (const count of buckets) {
      expect(count).toBeGreaterThan(392);
      expect(count).toBeLessThan(632);
    }
  });

  it("decorrelates neighbouring pixels and neighbouring seeds", () => {
    expect(noiseByteRef(0, 0, 0)).not.toBe(noiseByteRef(1, 0, 0));
    expect(noiseByteRef(0, 0, 0)).not.toBe(noiseByteRef(0, 1, 0));
    expect(noiseByteRef(5, 7, 0)).not.toBe(noiseByteRef(5, 7, 1));
  });

  it("is a pure function of (a, y, seed)", () => {
    expect(noiseByteRef(21, 9, 4)).toBe(noiseByteRef(21, 9, 4));
  });
});

describe("noiseSeedRef", () => {
  it("packs the frame index into the low half, as the interim seed", () => {
    expect(noiseSeedRef(0, FPS)).toBe(0);
    expect(noiseSeedRef(1, FPS)).toBe(30);
    // Rounds to the nearest frame, the same rule `u_fps` documents.
    expect(noiseSeedRef(1 / FPS - 0.001, FPS)).toBe(1);
  });
});

describe("noiseOffsetRef", () => {
  it("adds nothing at zero amount", () => {
    expect(noiseOffsetRef(P, 0.5, FPS, { amount: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("centres the offset on zero and bounds it by half the amount", () => {
    const amount = 100;
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < 256; x++) {
      const { r } = noiseOffsetRef({ x, y: 4 }, 0, FPS, { amount });
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeLessThan(-0.4);
    expect(max).toBeGreaterThan(0.4);
    expect(min).toBeGreaterThanOrEqual(-0.5);
    // The byte's top value overshoots 1.0 slightly — 32767/32704 — which is
    // After Effects' own asymmetry, not a rounding slip here.
    expect(max).toBeLessThan(0.51);
  });

  it("scales linearly with amount", () => {
    const one = noiseOffsetRef(P, 0, FPS, { amount: 50 }).r;
    const two = noiseOffsetRef(P, 0, FPS, { amount: 100 }).r;
    expect(two).toBeCloseTo(2 * one, 12);
  });

  it("is monochrome by default and per-channel with Use Color Noise", () => {
    const mono = noiseOffsetRef(P, 0, FPS, { amount: 100 });
    const colour = noiseOffsetRef(P, 0, FPS, { amount: 100, useColorNoise: true });
    expect(mono.r).toBe(mono.g);
    expect(mono.g).toBe(mono.b);
    expect(colour.r).not.toBe(colour.g);
    expect(colour.g).not.toBe(colour.b);
  });

  it("repeats exactly at one time and changes at the next frame", () => {
    const at = (t: number): number => noiseOffsetRef(P, t, FPS, { amount: 100 }).r;
    // Seek determinism: the same t is byte-identical, twice.
    expect(at(1.25)).toBe(at(1.25));
    // Two times inside one frame are one pattern; the next frame is another.
    expect(at(1 / FPS)).toBe(at(1 / FPS + 0.01));
    expect(at(1 / FPS)).not.toBe(at(2 / FPS));
  });
});
