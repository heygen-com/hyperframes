import { describe, expect, it } from "vitest";
import {
  sampleRgb48le,
  mix16,
  clamp16,
  smoothstep,
  hash,
  vnoise,
  fbm,
  crossfade,
  flashThroughWhite,
  hdrToLinear,
  linearToHdr,
  convertTransfer,
  TRANSITIONS,
  type TransitionFn,
} from "./shaderTransitions.js";

// ── sampleRgb48le ─────────────────────────────────────────────────────────────

describe("sampleRgb48le", () => {
  it("samples center pixel of a uniform 1x1 buffer", () => {
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(10000, 0); // R
    buf.writeUInt16LE(20000, 2); // G
    buf.writeUInt16LE(30000, 4); // B
    const [r, g, b] = sampleRgb48le(buf, 0.5, 0.5, 1, 1);
    expect(r).toBe(10000);
    expect(g).toBe(20000);
    expect(b).toBe(30000);
  });

  it("clamps out-of-bounds UV below 0 to first pixel", () => {
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(5000, 0);
    buf.writeUInt16LE(6000, 2);
    buf.writeUInt16LE(7000, 4);
    const [r, g, b] = sampleRgb48le(buf, -0.5, -0.5, 1, 1);
    expect(r).toBe(5000);
    expect(g).toBe(6000);
    expect(b).toBe(7000);
  });

  it("clamps out-of-bounds UV above 1 to last pixel", () => {
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(5000, 0);
    buf.writeUInt16LE(6000, 2);
    buf.writeUInt16LE(7000, 4);
    const [r, g, b] = sampleRgb48le(buf, 1.5, 1.5, 1, 1);
    expect(r).toBe(5000);
    expect(g).toBe(6000);
    expect(b).toBe(7000);
  });

  it("bilinearly interpolates between two horizontally adjacent pixels", () => {
    // 2x1 buffer: pixel 0 = (0,0,0), pixel 1 = (65534,65534,65534)
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(0, 0);
    buf.writeUInt16LE(0, 2);
    buf.writeUInt16LE(0, 4);
    buf.writeUInt16LE(65534, 6);
    buf.writeUInt16LE(65534, 8);
    buf.writeUInt16LE(65534, 10);
    // u=0.5, w=2 → x = 0.5*(2-1) = 0.5 → equal blend of pixels 0 and 1
    const [r, g, b] = sampleRgb48le(buf, 0.5, 0, 2, 1);
    expect(r).toBe(32767);
    expect(g).toBe(32767);
    expect(b).toBe(32767);
  });

  it("samples from exact pixel 0 at u=0", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(1000, 0);
    buf.writeUInt16LE(2000, 2);
    buf.writeUInt16LE(3000, 4);
    buf.writeUInt16LE(60000, 6);
    buf.writeUInt16LE(60000, 8);
    buf.writeUInt16LE(60000, 10);
    const [r, g, b] = sampleRgb48le(buf, 0, 0, 2, 1);
    expect(r).toBe(1000);
    expect(g).toBe(2000);
    expect(b).toBe(3000);
  });

  // ── Wider coverage for the perf-migration follow-up ────────────────────────
  // These pin down sub-pixel sampling semantics so a future Uint16Array
  // implementation can swap in and verify byte-equivalent output.

  it("bilinearly interpolates between two vertically adjacent pixels", () => {
    // 1x2 buffer: row 0 = (0,0,0), row 1 = (40000,40000,40000)
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(0, 0);
    buf.writeUInt16LE(0, 2);
    buf.writeUInt16LE(0, 4);
    buf.writeUInt16LE(40000, 6);
    buf.writeUInt16LE(40000, 8);
    buf.writeUInt16LE(40000, 10);
    const [r, g, b] = sampleRgb48le(buf, 0, 0.5, 1, 2);
    expect(r).toBe(20000);
    expect(g).toBe(20000);
    expect(b).toBe(20000);
  });

  it("bilinearly interpolates the centroid of a 2x2 block", () => {
    // Layout (R channel only, others mirror):
    //   (1000)  (5000)
    //   (3000)  (7000)
    // Centroid (u=v=0.5) → average of all four = 4000
    const buf = Buffer.alloc(24);
    const corners = [1000, 5000, 3000, 7000];
    for (let i = 0; i < 4; i++) {
      const off = i * 6;
      buf.writeUInt16LE(corners[i] ?? 0, off);
      buf.writeUInt16LE(corners[i] ?? 0, off + 2);
      buf.writeUInt16LE(corners[i] ?? 0, off + 4);
    }
    const [r, g, b] = sampleRgb48le(buf, 0.5, 0.5, 2, 2);
    expect(r).toBe(4000);
    expect(g).toBe(4000);
    expect(b).toBe(4000);
  });

  it("does not bleed channels — R, G, B sampled independently", () => {
    // 2x1 buffer with distinct per-channel gradients.
    //   pixel 0: R=1000 G=20000 B=50000
    //   pixel 1: R=9000 G=30000 B=60000
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(1000, 0);
    buf.writeUInt16LE(20000, 2);
    buf.writeUInt16LE(50000, 4);
    buf.writeUInt16LE(9000, 6);
    buf.writeUInt16LE(30000, 8);
    buf.writeUInt16LE(60000, 10);
    const [r, g, b] = sampleRgb48le(buf, 0.5, 0, 2, 1);
    expect(r).toBe(5000);
    expect(g).toBe(25000);
    expect(b).toBe(55000);
  });

  it("samples last pixel exactly when u=v=1 (no overflow past the edge)", () => {
    // 2x2 buffer where (1,1) corner has a unique value the first three pixels
    // do not. If sampleRgb48le tried to read off-edge, the result would mix in
    // out-of-bounds garbage.
    const buf = Buffer.alloc(24);
    const fill = [10, 20, 30, 65000];
    for (let i = 0; i < 4; i++) {
      const off = i * 6;
      buf.writeUInt16LE(fill[i] ?? 0, off);
      buf.writeUInt16LE(fill[i] ?? 0, off + 2);
      buf.writeUInt16LE(fill[i] ?? 0, off + 4);
    }
    const [r, g, b] = sampleRgb48le(buf, 1, 1, 2, 2);
    expect(r).toBe(65000);
    expect(g).toBe(65000);
    expect(b).toBe(65000);
  });

  it("respects asymmetric off-center UV weights", () => {
    // 2x1 buffer, R-only differentiation: pixel 0 = 0, pixel 1 = 10000
    // u=0.25 → x = 0.25 * (2 - 1) = 0.25
    // weight on pixel 0 = 0.75, weight on pixel 1 = 0.25
    // expected R = round(0 * 0.75 + 10000 * 0.25) = 2500
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(0, 0);
    buf.writeUInt16LE(0, 2);
    buf.writeUInt16LE(0, 4);
    buf.writeUInt16LE(10000, 6);
    buf.writeUInt16LE(10000, 8);
    buf.writeUInt16LE(10000, 10);
    const [r, g, b] = sampleRgb48le(buf, 0.25, 0, 2, 1);
    expect(r).toBe(2500);
    expect(g).toBe(2500);
    expect(b).toBe(2500);
  });

  it("preserves max 16-bit values without clipping or rollover", () => {
    // Verify the 65535 ceiling round-trips through bilinear weights without
    // losing precision. A naïve 32-bit accumulator would still be fine here,
    // but a future packed-Uint16 implementation must be checked for overflow
    // in intermediate sums.
    const buf = Buffer.alloc(24);
    for (let i = 0; i < 4; i++) {
      const off = i * 6;
      buf.writeUInt16LE(65535, off);
      buf.writeUInt16LE(65535, off + 2);
      buf.writeUInt16LE(65535, off + 4);
    }
    const [r, g, b] = sampleRgb48le(buf, 0.5, 0.5, 2, 2);
    expect(r).toBe(65535);
    expect(g).toBe(65535);
    expect(b).toBe(65535);
  });

  it("works on a large 256x256 canvas with sub-pixel UV", () => {
    // Sanity check that buffer offset math scales — exercises the (y * w + x) * 6
    // indexing on a non-trivial stride.
    const w = 256;
    const h = 256;
    const buf = Buffer.alloc(w * h * 6);
    // Diagonal gradient in R: pixel (x, y).R = x
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = (y * w + x) * 6;
        buf.writeUInt16LE(x, off);
      }
    }
    // u = 0.5 → sx = 0.5 * (w - 1) = 127.5 → R should be ≈ 127.5 → rounds to 128
    const [r] = sampleRgb48le(buf, 0.5, 0.5, w, h);
    expect(r).toBe(128);
  });

  it("handles 1x1 source with arbitrary UV (no x1=x0 division by zero)", () => {
    // x0+1 gets clamped back to w-1=0, so x0 == x1. The weights still sum to 1
    // and the result must equal the single pixel value.
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(12345, 0);
    buf.writeUInt16LE(23456, 2);
    buf.writeUInt16LE(34567, 4);
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [0.7, 0.3],
    ] as const) {
      const [r, g, b] = sampleRgb48le(buf, u, v, 1, 1);
      expect(r).toBe(12345);
      expect(g).toBe(23456);
      expect(b).toBe(34567);
    }
  });
});

// ── mix16 ─────────────────────────────────────────────────────────────────────

describe("mix16", () => {
  it("returns a at t=0", () => {
    expect(mix16(1000, 60000, 0)).toBe(1000);
  });

  it("returns b at t=1", () => {
    expect(mix16(1000, 60000, 1)).toBe(60000);
  });

  it("returns midpoint at t=0.5", () => {
    expect(mix16(0, 60000, 0.5)).toBe(30000);
  });

  it("returns rounded result for non-integer midpoints", () => {
    // 0 * 0.5 + 1 * 0.5 = 0.5 → rounds to 1
    expect(mix16(0, 1, 0.5)).toBe(1);
  });
});

// ── clamp16 ───────────────────────────────────────────────────────────────────

describe("clamp16", () => {
  it("clamps negative to 0", () => {
    expect(clamp16(-100)).toBe(0);
  });

  it("clamps overflow to 65535", () => {
    expect(clamp16(70000)).toBe(65535);
  });

  it("passes normal values through", () => {
    expect(clamp16(32768)).toBe(32768);
  });

  it("passes boundary values through", () => {
    expect(clamp16(0)).toBe(0);
    expect(clamp16(65535)).toBe(65535);
  });
});

// ── smoothstep ────────────────────────────────────────────────────────────────

describe("smoothstep", () => {
  it("returns 0 when x <= edge0", () => {
    expect(smoothstep(0.2, 0.8, 0.1)).toBe(0);
    expect(smoothstep(0.2, 0.8, 0.2)).toBe(0);
  });

  it("returns 1 when x >= edge1", () => {
    expect(smoothstep(0.2, 0.8, 0.9)).toBe(1);
    expect(smoothstep(0.2, 0.8, 0.8)).toBe(1);
  });

  it("returns ~0.5 at midpoint between edge0 and edge1", () => {
    // t = (0.5 - 0.2) / (0.8 - 0.2) = 0.5; hermite(0.5) = 0.5*0.5*(3-2*0.5) = 0.5
    expect(smoothstep(0.2, 0.8, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("is monotonically increasing", () => {
    const vals = [0.3, 0.4, 0.5, 0.6, 0.7].map((x) => smoothstep(0.2, 0.8, x));
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1] ?? 0);
    }
  });
});

// ── hash ──────────────────────────────────────────────────────────────────────

describe("hash", () => {
  it("returns a value in [0, 1)", () => {
    const h = hash(1.5, 2.7);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });

  it("is deterministic for the same inputs", () => {
    expect(hash(3.14, 2.71)).toBe(hash(3.14, 2.71));
  });

  it("returns different values for different inputs", () => {
    expect(hash(0, 0)).not.toBe(hash(1, 0));
    expect(hash(0, 0)).not.toBe(hash(0, 1));
  });

  it("returns values in [0,1) for integer grid points", () => {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const h = hash(i, j);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });
});

// ── vnoise ────────────────────────────────────────────────────────────────────

describe("vnoise", () => {
  it("returns a value in [0, 1]", () => {
    const v = vnoise(1.5, 2.3);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("is deterministic for the same inputs", () => {
    expect(vnoise(3.14, 2.71)).toBe(vnoise(3.14, 2.71));
  });

  it("returns [0,1] range over a grid", () => {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const v = vnoise(i * 0.7, j * 0.7);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("produces variation across the domain (not constant)", () => {
    const values = new Set([
      vnoise(0, 0),
      vnoise(1, 0),
      vnoise(0, 1),
      vnoise(1, 1),
      vnoise(0.5, 0.5),
    ]);
    // At least 2 distinct values among 5 samples
    expect(values.size).toBeGreaterThan(1);
  });
});

// ── fbm ───────────────────────────────────────────────────────────────────────

describe("fbm", () => {
  it("is deterministic for the same inputs", () => {
    expect(fbm(1.5, 2.3)).toBe(fbm(1.5, 2.3));
  });

  it("returns consistent known values", () => {
    const v0 = fbm(0, 0);
    const v1 = fbm(1, 0);
    const v2 = fbm(0, 1);
    // All should be finite numbers (not NaN/Infinity)
    expect(Number.isFinite(v0)).toBe(true);
    expect(Number.isFinite(v1)).toBe(true);
    expect(Number.isFinite(v2)).toBe(true);
    // Should produce different values for different inputs
    expect(v0).not.toBe(v1);
    expect(v0).not.toBe(v2);
  });

  it("produces values in a reasonable range", () => {
    // fbm sums 5 octaves of vnoise (0–1) with amplitudes 0.5,0.25,0.125,0.0625,0.03125
    // max possible ≈ 0.96875; values should be positive
    const v = fbm(2.5, 3.7);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1.1);
  });
});

// ── transition helpers ────────────────────────────────────────────────────────

function makeBuffer(w: number, h: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(w * h * 6);
  for (let i = 0; i < w * h; i++) {
    buf.writeUInt16LE(r, i * 6);
    buf.writeUInt16LE(g, i * 6 + 2);
    buf.writeUInt16LE(b, i * 6 + 4);
  }
  return buf;
}

function runTransition(
  fn: TransitionFn,
  w: number,
  h: number,
  fR: number,
  fG: number,
  fB: number,
  tR: number,
  tG: number,
  tB: number,
  progress: number,
): Buffer {
  const from = makeBuffer(w, h, fR, fG, fB);
  const to = makeBuffer(w, h, tR, tG, tB);
  const out = Buffer.alloc(w * h * 6);
  fn(from, to, out, w, h, progress);
  return out;
}

// ── crossfade ─────────────────────────────────────────────────────────────────

describe("crossfade", () => {
  it("at progress=0 output equals from", () => {
    const out = runTransition(crossfade, 2, 2, 10000, 20000, 30000, 50000, 55000, 60000, 0);
    for (let i = 0; i < 4; i++) {
      expect(out.readUInt16LE(i * 6)).toBe(10000);
      expect(out.readUInt16LE(i * 6 + 2)).toBe(20000);
      expect(out.readUInt16LE(i * 6 + 4)).toBe(30000);
    }
  });

  it("at progress=1 output equals to", () => {
    const out = runTransition(crossfade, 2, 2, 10000, 20000, 30000, 50000, 55000, 60000, 1);
    for (let i = 0; i < 4; i++) {
      expect(out.readUInt16LE(i * 6)).toBe(50000);
      expect(out.readUInt16LE(i * 6 + 2)).toBe(55000);
      expect(out.readUInt16LE(i * 6 + 4)).toBe(60000);
    }
  });

  it("at progress=0.5 output is midpoint of from and to", () => {
    const out = runTransition(crossfade, 1, 1, 0, 0, 0, 60000, 60000, 60000, 0.5);
    expect(out.readUInt16LE(0)).toBe(30000);
    expect(out.readUInt16LE(2)).toBe(30000);
    expect(out.readUInt16LE(4)).toBe(30000);
  });

  it("is registered in TRANSITIONS", () => {
    expect(TRANSITIONS["crossfade"]).toBe(crossfade);
  });
});

// ── flashThroughWhite ─────────────────────────────────────────────────────────

describe("flashThroughWhite", () => {
  it("at progress=0 output approximates from", () => {
    // toWhite = smoothstep(0,0.45,0) = 0, fromWhite = 1-smoothstep(0.5,1,0) = 1,
    // blend = smoothstep(0.35,0.65,0) = 0 → output = fromC = from (untouched)
    const out = runTransition(flashThroughWhite, 1, 1, 10000, 20000, 30000, 50000, 55000, 60000, 0);
    expect(out.readUInt16LE(0)).toBe(10000);
    expect(out.readUInt16LE(2)).toBe(20000);
    expect(out.readUInt16LE(4)).toBe(30000);
  });

  it("at progress≈0.45 all channels are near white (>50000)", () => {
    // toWhite = smoothstep(0,0.45,0.45) = 1 → fromC = white
    // fromWhite = 1-smoothstep(0.5,1,0.45) = 1 → toC = white
    // both inputs to blend are white → output is white
    const out = runTransition(
      flashThroughWhite,
      1,
      1,
      10000,
      20000,
      30000,
      50000,
      55000,
      60000,
      0.45,
    );
    expect(out.readUInt16LE(0)).toBeGreaterThan(50000);
    expect(out.readUInt16LE(2)).toBeGreaterThan(50000);
    expect(out.readUInt16LE(4)).toBeGreaterThan(50000);
  });

  it("at progress=1 output approximates to", () => {
    // toWhite = smoothstep(0,0.45,1) = 1, fromWhite = 1-smoothstep(0.5,1,1) = 0,
    // blend = smoothstep(0.35,0.65,1) = 1 → output = toC = to (untouched)
    const out = runTransition(flashThroughWhite, 1, 1, 10000, 20000, 30000, 50000, 55000, 60000, 1);
    expect(out.readUInt16LE(0)).toBe(50000);
    expect(out.readUInt16LE(2)).toBe(55000);
    expect(out.readUInt16LE(4)).toBe(60000);
  });

  it("is registered in TRANSITIONS", () => {
    expect(TRANSITIONS["flash-through-white"]).toBe(flashThroughWhite);
  });
});

// ── all transitions smoke test ────────────────────────────────────────────────

const ALL_SHADERS = [
  "crossfade",
  "flash-through-white",
  "chromatic-split",
  "sdf-iris",
  "whip-pan",
  "cinematic-zoom",
  "gravitational-lens",
  "glitch",
  "ripple-waves",
  "swirl-vortex",
  "thermal-distortion",
  "domain-warp",
  "ridged-burn",
  "cross-warp-morph",
  "light-leak",
];

// Pixel offset selector for the "at progress=0, center pixel ≈ from" test.
// Most transitions use the center pixel (4*8+4). Two shaders require a
// different test pixel because their design does not produce `from` at the
// center when p=0:
//   sdf-iris:          the iris reveal shows `to` inside and `from` outside.
//                      At any p>0 the center is inside → shows `to`. We use
//                      a corner pixel (row 0, col 0) that stays outside the
//                      iris until p is large.
//   gravitational-lens: at p=0 the horizon mask is 0 at center (dist=0),
//                      producing black. A corner pixel (dist≈0.7) has
//                      horizon > 0 and shows a lensed version of `from`.
const P0_PIXEL: Record<string, number> = {
  "sdf-iris": 0 * 6, // top-left corner: always outside iris at p=0
  "gravitational-lens": (0 * 8 + 0) * 6, // top-left corner: non-zero dist
};

describe("all transitions smoke test", () => {
  for (const name of ALL_SHADERS) {
    describe(name, () => {
      it("exists in registry", () => {
        expect(TRANSITIONS[name]).toBeDefined();
      });
      it("at progress=0, center pixel ≈ from", () => {
        const from = makeBuffer(8, 8, 40000, 30000, 20000);
        const to = makeBuffer(8, 8, 10000, 10000, 10000);
        const out = Buffer.alloc(8 * 8 * 6);
        const fn = TRANSITIONS[name];
        expect(fn).toBeDefined();
        fn?.(from, to, out, 8, 8, 0);
        const o = P0_PIXEL[name] ?? (4 * 8 + 4) * 6;
        // At progress=0 the result should be the `from` pixel (R=40000).
        // The midpoint between from (40000) and to (10000) is 25000, so a
        // tighter threshold catches transitions that are halfway-blended
        // when they should be fully on the `from` side.
        expect(out.readUInt16LE(o)).toBeGreaterThan(35000);
      });
      it("at progress=1, center pixel ≈ to", () => {
        const from = makeBuffer(8, 8, 40000, 30000, 20000);
        const to = makeBuffer(8, 8, 10000, 10000, 10000);
        const out = Buffer.alloc(8 * 8 * 6);
        const fn = TRANSITIONS[name];
        expect(fn).toBeDefined();
        fn?.(from, to, out, 8, 8, 1);
        const o = (4 * 8 + 4) * 6;
        // At progress=1 the result should be the `to` pixel (R=10000).
        // Tighter than the previous halfway midpoint (25000) so that any
        // transition that is still half-blended will fail.
        expect(out.readUInt16LE(o)).toBeLessThan(15000);
      });
    });
  }
});

// ── all transitions: midpoint regressions (p=0.5) ───────────────────────────
//
// Endpoint smoke tests above lock down p=0 (≈from) and p=1 (≈to). They miss
// regressions where a shader becomes a no-op, prematurely completes, returns
// garbage, or accidentally introduces non-determinism — specifically at the
// midpoint where the transition is most visible to viewers. Four invariants
// every shader must satisfy at p=0.5:
//
//   1. Output ≠ from         catches "shader is a no-op, returns input as-is"
//   2. Output ≠ to           catches "shader prematurely completes at midpoint"
//   3. Output is non-zero    catches "shader didn't write anything to the buf"
//   4. Output is deterministic — catches accidental Math.random / Date.now /
//      uninitialized-state regressions that would surface as flaky CI.
//
// Two distinct uniform colors give buffer-equality checks distinct byte
// patterns to compare against. Even shaders that warp UVs (which would be
// no-ops on uniform input alone) produce mix16(from, to, 0.5) = (25000, 20000,
// 15000), distinct from both inputs at every pixel.
describe("all transitions: midpoint regressions (p=0.5)", () => {
  for (const name of ALL_SHADERS) {
    describe(name, () => {
      const w = 8;
      const h = 8;
      const from = makeBuffer(w, h, 40000, 30000, 20000);
      const to = makeBuffer(w, h, 10000, 10000, 10000);
      const zeros = Buffer.alloc(w * h * 6);

      it("output ≠ from (not a no-op at midpoint)", () => {
        const fn = TRANSITIONS[name];
        expect(fn).toBeDefined();
        const out = Buffer.alloc(w * h * 6);
        fn?.(from, to, out, w, h, 0.5);
        expect(out.equals(from)).toBe(false);
      });

      it("output ≠ to (not premature completion at midpoint)", () => {
        const fn = TRANSITIONS[name];
        expect(fn).toBeDefined();
        const out = Buffer.alloc(w * h * 6);
        fn?.(from, to, out, w, h, 0.5);
        expect(out.equals(to)).toBe(false);
      });

      it("output is non-zero (shader actually wrote pixels)", () => {
        const fn = TRANSITIONS[name];
        expect(fn).toBeDefined();
        const out = Buffer.alloc(w * h * 6);
        fn?.(from, to, out, w, h, 0.5);
        expect(out.equals(zeros)).toBe(false);
      });

      it("output is deterministic across repeated calls", () => {
        const fn = TRANSITIONS[name];
        expect(fn).toBeDefined();
        const out1 = Buffer.alloc(w * h * 6);
        const out2 = Buffer.alloc(w * h * 6);
        fn?.(from, to, out1, w, h, 0.5);
        fn?.(from, to, out2, w, h, 0.5);
        expect(out2.equals(out1)).toBe(true);
      });
    });
  }
});

// ── hdrToLinear / linearToHdr roundtrip ────────────────────────────────────

describe("hdrToLinear / linearToHdr", () => {
  for (const transfer of ["pq", "hlg"] as const) {
    describe(transfer, () => {
      it("roundtrip preserves mid-to-high values", () => {
        // PQ concentrates precision in the dark range — linearizing then
        // re-quantizing at 16-bit loses bits for values below ~16000.
        // HLG squares small inputs, similar effect. Test the mid-to-high
        // range where roundtrip error is bounded.
        const values = [16384, 32768, 50000, 65535];
        const buf = Buffer.alloc(values.length * 2);
        for (let i = 0; i < values.length; i++) {
          buf.writeUInt16LE(values[i] ?? 0, i * 2);
        }
        const original = Buffer.from(buf);
        hdrToLinear(buf, transfer);
        linearToHdr(buf, transfer);
        for (let i = 0; i < values.length; i++) {
          const got = buf.readUInt16LE(i * 2);
          const want = original.readUInt16LE(i * 2);
          expect(Math.abs(got - want)).toBeLessThanOrEqual(30);
        }
      });

      it("zero maps to zero", () => {
        const buf = Buffer.alloc(2);
        buf.writeUInt16LE(0, 0);
        hdrToLinear(buf, transfer);
        expect(buf.readUInt16LE(0)).toBe(0);
      });

      it("65535 maps to 65535", () => {
        const buf = Buffer.alloc(2);
        buf.writeUInt16LE(65535, 0);
        hdrToLinear(buf, transfer);
        linearToHdr(buf, transfer);
        expect(buf.readUInt16LE(0)).toBe(65535);
      });

      it("hdrToLinear produces monotonically increasing output", () => {
        const steps = [0, 1000, 5000, 10000, 20000, 40000, 65535];
        const buf = Buffer.alloc(steps.length * 2);
        for (let i = 0; i < steps.length; i++) {
          buf.writeUInt16LE(steps[i] ?? 0, i * 2);
        }
        hdrToLinear(buf, transfer);
        let prev = 0;
        for (let i = 0; i < steps.length; i++) {
          const val = buf.readUInt16LE(i * 2);
          expect(val).toBeGreaterThanOrEqual(prev);
          prev = val;
        }
      });
    });
  }
});

// ── convertTransfer (HLG↔PQ) ─────────────────────────────────────────────

describe("convertTransfer", () => {
  it("no-op when from === to", () => {
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(32768, 0);
    buf.writeUInt16LE(16384, 2);
    buf.writeUInt16LE(8192, 4);
    const original = Buffer.from(buf);
    convertTransfer(buf, "pq", "pq");
    expect(buf.equals(original)).toBe(true);
  });

  it("hlg→pq→hlg roundtrip preserves mid-high values", () => {
    const values = [16384, 32768, 50000, 65535];
    const buf = Buffer.alloc(values.length * 2);
    for (let i = 0; i < values.length; i++) {
      buf.writeUInt16LE(values[i] ?? 0, i * 2);
    }
    const original = Buffer.from(buf);
    convertTransfer(buf, "hlg", "pq");
    expect(buf.equals(original)).toBe(false);
    convertTransfer(buf, "pq", "hlg");
    for (let i = 0; i < values.length; i++) {
      const got = buf.readUInt16LE(i * 2);
      const want = original.readUInt16LE(i * 2);
      expect(Math.abs(got - want)).toBeLessThanOrEqual(30);
    }
  });

  it("hlg→pq produces different values", () => {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(32768, 0);
    const before = buf.readUInt16LE(0);
    convertTransfer(buf, "hlg", "pq");
    expect(buf.readUInt16LE(0)).not.toBe(before);
  });
});
