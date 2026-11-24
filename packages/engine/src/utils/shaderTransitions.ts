/**
 * Shader Transition Math Utilities
 *
 * Sampling helpers and math primitives for rgb48le shader transitions.
 * Functions are ported from GLSL to operate on 16-bit little-endian pixel
 * buffers (6 bytes per pixel: R, G, B each stored as UInt16LE).
 */

// ── PQ linearization ─────────────────────────────────────────────────────────
// Shader transitions were ported from sRGB GLSL where pixel values distribute
// linearly across the visible range. In PQ space, dark content clusters near
// zero, causing UV-warping shaders to produce black artifacts. Converting to
// linear light before the shader and back to PQ after gives correct results.

const PQ_M1 = 0.1593017578125;
const PQ_M2 = 78.84375;
const PQ_C1 = 0.8359375;
const PQ_C2 = 18.8515625;
const PQ_C3 = 18.6875;

/** PQ EOTF: decode PQ signal (0-1) → linear light (0-1, normalized to 10000 nits). */
function pqEotf(signal: number): number {
  const sp = Math.pow(Math.max(0, signal), 1 / PQ_M2);
  const num = Math.max(sp - PQ_C1, 0);
  const den = PQ_C2 - PQ_C3 * sp;
  return den > 0 ? Math.pow(num / den, 1 / PQ_M1) : 0;
}

/** PQ OETF: encode linear light (0-1) → PQ signal (0-1). */
function pqOetf(linear: number): number {
  const lp = Math.pow(Math.max(0, linear), PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * lp) / (1 + PQ_C3 * lp), PQ_M2);
}

/** HLG OETF inverse: decode HLG signal (0-1) → linear scene light (0-1). */
function hlgEotf(signal: number): number {
  const a = 0.17883277;
  const b = 1 - 4 * a;
  const c = 0.5 - a * Math.log(4 * a);
  if (signal <= 0.5) {
    return (signal * signal) / 3;
  }
  return (Math.exp((signal - c) / a) + b) / 12;
}

/** HLG OETF: encode linear scene light (0-1) → HLG signal (0-1). */
function hlgOetf(linear: number): number {
  const a = 0.17883277;
  const b = 1 - 4 * a;
  const c = 0.5 - a * Math.log(4 * a);
  if (linear <= 1 / 12) {
    return Math.sqrt(3 * linear);
  }
  return a * Math.log(12 * linear - b) + c;
}

// ── Precomputed LUTs for fast HDR↔linear conversion ─────────────────────────
// 65536-entry lookup tables eliminate per-pixel Math.pow calls. Built once on
// first use, then reused for all subsequent conversions. At 4K (8.3M pixels ×
// 3 channels × 3 buffers), this turns ~75M Math.pow calls per transition frame
// into 75M array lookups — ~100× faster.

function buildLut(fn: (v: number) => number): Uint16Array {
  const lut = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) {
    lut[i] = Math.round(fn(i / 65535) * 65535);
  }
  return lut;
}

let pqToLinearLut: Uint16Array | null = null;
let linearToPqLut: Uint16Array | null = null;
let hlgToLinearLut: Uint16Array | null = null;
let linearToHlgLut: Uint16Array | null = null;

function getPqToLinearLut(): Uint16Array {
  if (!pqToLinearLut) pqToLinearLut = buildLut(pqEotf);
  return pqToLinearLut;
}
function getLinearToPqLut(): Uint16Array {
  if (!linearToPqLut) linearToPqLut = buildLut(pqOetf);
  return linearToPqLut;
}
function getHlgToLinearLut(): Uint16Array {
  if (!hlgToLinearLut) hlgToLinearLut = buildLut(hlgEotf);
  return hlgToLinearLut;
}
function getLinearToHlgLut(): Uint16Array {
  if (!linearToHlgLut) linearToHlgLut = buildLut(hlgOetf);
  return linearToHlgLut;
}

/**
 * Convert an rgb48le buffer from HDR signal space to linear light, in-place.
 * Uses precomputed 65536-entry LUT for O(1) per-sample conversion.
 * @param transfer "pq" or "hlg"
 */
export function hdrToLinear(buf: Buffer, transfer: "pq" | "hlg"): void {
  const lut = transfer === "pq" ? getPqToLinearLut() : getHlgToLinearLut();
  const len = buf.length / 2;
  for (let i = 0; i < len; i++) {
    const off = i * 2;
    buf.writeUInt16LE(lut[buf.readUInt16LE(off)] ?? 0, off);
  }
}

/**
 * Convert an rgb48le buffer from linear light back to HDR signal space, in-place.
 * Uses precomputed 65536-entry LUT for O(1) per-sample conversion.
 * @param transfer "pq" or "hlg"
 */
export function linearToHdr(buf: Buffer, transfer: "pq" | "hlg"): void {
  const lut = transfer === "pq" ? getLinearToPqLut() : getLinearToHlgLut();
  const len = buf.length / 2;
  for (let i = 0; i < len; i++) {
    const off = i * 2;
    buf.writeUInt16LE(lut[buf.readUInt16LE(off)] ?? 0, off);
  }
}

// ── Cross-transfer conversion (HLG↔PQ) ──────────────────────────────────────
// HLG is scene-referred, PQ is display-referred. Converting between them
// requires the OOTF (Optical-Optical Transfer Function) which maps scene
// light to display light. Per BT.2100, the HLG OOTF for a reference
// display at Lw nits is: Y_display = Lw * Y_scene^gamma, where
// gamma = 1.2 * 1.111^(log2(Lw/1000)). At 1000 nits: gamma = 1.2.
//
// The per-channel approximation (applying gamma per-channel rather than
// on luminance Y) introduces slight color shifts but avoids a full
// colorimetric conversion with BT.2020 luma coefficients.

const HLG_OOTF_LW = 1000; // reference display peak luminance (nits)
const HLG_OOTF_GAMMA = 1.2 * Math.pow(1.111, Math.log2(HLG_OOTF_LW / 1000));

/** HLG scene light → PQ display light (per-channel, normalized to 10000 nits) */
function hlgSceneToPqDisplay(sceneLinear: number): number {
  const displayNits = HLG_OOTF_LW * Math.pow(Math.max(0, sceneLinear), HLG_OOTF_GAMMA);
  return displayNits / 10000; // PQ is normalized to 10000 nits
}

/** PQ display light → HLG scene light (inverse OOTF) */
function pqDisplayToHlgScene(displayNormalized: number): number {
  const displayNits = displayNormalized * 10000;
  return Math.pow(Math.max(0, displayNits / HLG_OOTF_LW), 1 / HLG_OOTF_GAMMA);
}

let hlgToPqLut: Uint16Array | null = null;
let pqToHlgLut: Uint16Array | null = null;

function getHlgToPqLut(): Uint16Array {
  // HLG signal → scene linear (EOTF) → display linear (OOTF) → PQ signal (OETF)
  if (!hlgToPqLut) hlgToPqLut = buildLut((v) => pqOetf(hlgSceneToPqDisplay(hlgEotf(v))));
  return hlgToPqLut;
}
function getPqToHlgLut(): Uint16Array {
  // PQ signal → display linear (EOTF) → scene linear (inverse OOTF) → HLG signal (OETF)
  if (!pqToHlgLut) pqToHlgLut = buildLut((v) => hlgOetf(pqDisplayToHlgScene(pqEotf(v))));
  return pqToHlgLut;
}

/**
 * Convert an rgb48le buffer between HDR transfer functions, in-place.
 * Uses a composite 65536-entry LUT (source EOTF → linear → target OETF)
 * for O(1) per-sample conversion. No-op if from === to.
 */
export function convertTransfer(buf: Buffer, from: "pq" | "hlg", to: "pq" | "hlg"): void {
  if (from === to) return;
  const lut = from === "hlg" ? getHlgToPqLut() : getPqToHlgLut();
  const len = buf.length / 2;
  for (let i = 0; i < len; i++) {
    const off = i * 2;
    buf.writeUInt16LE(lut[buf.readUInt16LE(off)] ?? 0, off);
  }
}

// ── Buffer sampling ───────────────────────────────────────────────────────────

/**
 * Sample an rgb48le buffer at floating-point UV coordinates (0–1 range, clamped).
 * Uses bilinear interpolation between the 4 nearest pixels, equivalent to
 * GLSL `texture2D` with clamp-to-edge wrapping.
 *
 * @param buf  rgb48le buffer — w * h * 6 bytes
 * @param u    Horizontal coordinate in [0, 1]
 * @param v    Vertical coordinate in [0, 1]
 * @param w    Image width in pixels
 * @param h    Image height in pixels
 * @returns    [r, g, b] as 16-bit values (0–65535)
 */
export function sampleRgb48le(
  buf: Buffer,
  u: number,
  v: number,
  w: number,
  h: number,
): [number, number, number] {
  // Clamp UV to [0, 1] then map to pixel coordinates
  const uc = Math.max(0, Math.min(1, u));
  const vc = Math.max(0, Math.min(1, v));

  const sx = uc * (w - 1);
  const sy = vc * (h - 1);

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);

  const fx = sx - x0;
  const fy = sy - y0;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const off00 = (y0 * w + x0) * 6;
  const off10 = (y0 * w + x1) * 6;
  const off01 = (y1 * w + x0) * 6;
  const off11 = (y1 * w + x1) * 6;

  const r = Math.round(
    buf.readUInt16LE(off00) * w00 +
      buf.readUInt16LE(off10) * w10 +
      buf.readUInt16LE(off01) * w01 +
      buf.readUInt16LE(off11) * w11,
  );
  const g = Math.round(
    buf.readUInt16LE(off00 + 2) * w00 +
      buf.readUInt16LE(off10 + 2) * w10 +
      buf.readUInt16LE(off01 + 2) * w01 +
      buf.readUInt16LE(off11 + 2) * w11,
  );
  const b = Math.round(
    buf.readUInt16LE(off00 + 4) * w00 +
      buf.readUInt16LE(off10 + 4) * w10 +
      buf.readUInt16LE(off01 + 4) * w01 +
      buf.readUInt16LE(off11 + 4) * w11,
  );

  return [r, g, b];
}

// ── 16-bit math primitives ────────────────────────────────────────────────────

/**
 * Linear interpolate two 16-bit values. Equivalent to GLSL `mix(a, b, t)`.
 */
export function mix16(a: number, b: number, t: number): number {
  return Math.round(a * (1 - t) + b * t);
}

/**
 * Clamp a value to the 16-bit unsigned range [0, 65535].
 */
export function clamp16(v: number): number {
  return Math.max(0, Math.min(65535, v));
}

// ── GLSL math ports ───────────────────────────────────────────────────────────

/**
 * Hermite interpolation from GLSL `smoothstep(edge0, edge1, x)`.
 * Returns 0 for x ≤ edge0, 1 for x ≥ edge1, and a smooth S-curve between.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic pseudo-random value in [0, 1).
 * Port of the GLSL idiom: `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)`.
 */
export function hash(x: number, y: number): number {
  return (((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1) + 1) % 1;
}

/**
 * Value noise with C2-continuous quintic interpolation.
 * Samples `hash()` at the 4 surrounding integer grid corners and blends
 * using the quintic fade f = f³(f(6f − 15) + 10).
 *
 * Returns a value in [0, 1].
 */
export function vnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);

  // Fractional part
  let fx = px - ix;
  let fy = py - iy;

  // Quintic C2 interpolation weights
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const h00 = hash(ix, iy);
  const h10 = hash(ix + 1, iy);
  const h01 = hash(ix, iy + 1);
  const h11 = hash(ix + 1, iy + 1);

  // Bilinear blend
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

// Rotation matrix constants from GLSL: mat2(0.8, 0.6, -0.6, 0.8)
// Applies to [px, py]: px' = 0.8*px - 0.6*py, py' = 0.6*px + 0.8*py
const ROT_A = 0.8;
const ROT_B = 0.6;

/**
 * Fractal Brownian motion — 5-octave accumulation of value noise.
 *
 * Each octave: accumulate `amplitude * vnoise(p)`, rotate p by 36.87°,
 * scale by 2.02, halve the amplitude. Matching the GLSL convention of
 * `mat2(0.8, 0.6, -0.6, 0.8)` for the rotation.
 */
export function fbm(px: number, py: number): number {
  let value = 0;
  let amplitude = 0.5;
  let x = px;
  let y = py;

  for (let i = 0; i < 5; i++) {
    value += amplitude * vnoise(x, y);

    // Rotate by mat2(0.8, 0.6, -0.6, 0.8)
    const nx = ROT_A * x - ROT_B * y;
    const ny = ROT_B * x + ROT_A * y;
    x = nx * 2.02;
    y = ny * 2.02;

    amplitude *= 0.5;
  }

  return value;
}

// ── Transition types and registry ─────────────────────────────────────────────

/** A transition function that blends two rgb48le buffers into an output buffer. */
export type TransitionFn = (
  from: Buffer,
  to: Buffer,
  output: Buffer,
  width: number,
  height: number,
  progress: number,
) => void;

/** Registry of all available transitions by name; prototype-free, so `constructor` finds nothing. */
export const TRANSITIONS: Record<string, TransitionFn> = Object.create(null);

// ── crossfade ─────────────────────────────────────────────────────────────────

/**
 * Simple linear blend between two frames. Equivalent to GLSL `mix(from, to, progress)`.
 */
export const crossfade: TransitionFn = (from, to, out, w, h, p) => {
  const inv = 1 - p;
  for (let i = 0; i < w * h; i++) {
    const o = i * 6;
    out.writeUInt16LE(Math.round(from.readUInt16LE(o) * inv + to.readUInt16LE(o) * p), o);
    out.writeUInt16LE(
      Math.round(from.readUInt16LE(o + 2) * inv + to.readUInt16LE(o + 2) * p),
      o + 2,
    );
    out.writeUInt16LE(
      Math.round(from.readUInt16LE(o + 4) * inv + to.readUInt16LE(o + 4) * p),
      o + 4,
    );
  }
};
TRANSITIONS["crossfade"] = crossfade;

// ── flashThroughWhite ─────────────────────────────────────────────────────────

/**
 * Flash-through-white transition: the outgoing scene brightens to white while
 * the incoming scene emerges from white, creating a bright flash at the midpoint.
 *
 * Port of the GLSL flash-through-white shader.
 */
export const flashThroughWhite: TransitionFn = (from, to, out, w, h, p) => {
  const toWhite = smoothstep(0, 0.45, p); // outgoing brightens toward white
  const fromWhite = 1 - smoothstep(0.5, 1, p); // incoming starts from white
  const blend = smoothstep(0.35, 0.65, p); // crossfade between the two

  for (let i = 0; i < w * h; i++) {
    const o = i * 6;
    const fromR = mix16(from.readUInt16LE(o), 65535, toWhite);
    const fromG = mix16(from.readUInt16LE(o + 2), 65535, toWhite);
    const fromB = mix16(from.readUInt16LE(o + 4), 65535, toWhite);

    const toR = mix16(to.readUInt16LE(o), 65535, fromWhite);
    const toG = mix16(to.readUInt16LE(o + 2), 65535, fromWhite);
    const toB = mix16(to.readUInt16LE(o + 4), 65535, fromWhite);

    out.writeUInt16LE(mix16(fromR, toR, blend), o);
    out.writeUInt16LE(mix16(fromG, toG, blend), o + 2);
    out.writeUInt16LE(mix16(fromB, toB, blend), o + 4);
  }
};
TRANSITIONS["flash-through-white"] = flashThroughWhite;

// ── chromatic-split ───────────────────────────────────────────────────────────

/**
 * RGB channel offset transition. Each channel is sampled at a different UV
 * offset, spreading apart as progress increases (outgoing) and converging
 * as progress approaches 1 (incoming). Port of the GLSL chromatic-split shader.
 */
export const chromaticSplit: TransitionFn = (from, to, out, w, h, p) => {
  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    // Center-relative UV for offset direction
    const cx = ux - 0.5;
    const cy = uy - 0.5;

    const fromShift = p * 0.06;
    const fr = sampleRgb48le(from, ux + cx * fromShift, uy + cy * fromShift, w, h)[0];
    const fg = sampleRgb48le(from, ux, uy, w, h)[1];
    const fb = sampleRgb48le(from, ux - cx * fromShift, uy - cy * fromShift, w, h)[2];

    const toShift = (1 - p) * 0.06;
    const tr = sampleRgb48le(to, ux - cx * toShift, uy - cy * toShift, w, h)[0];
    const tg = sampleRgb48le(to, ux, uy, w, h)[1];
    const tb = sampleRgb48le(to, ux + cx * toShift, uy + cy * toShift, w, h)[2];

    out.writeUInt16LE(clamp16(mix16(fr, tr, p)), o);
    out.writeUInt16LE(clamp16(mix16(fg, tg, p)), o + 2);
    out.writeUInt16LE(clamp16(mix16(fb, tb, p)), o + 4);
  }
};
TRANSITIONS["chromatic-split"] = chromaticSplit;

// ── sdf-iris ──────────────────────────────────────────────────────────────────

/**
 * Circular iris reveal. A sharp edge expands from the center while golden
 * glow rings ripple outward at the boundary. Port of the GLSL sdf-iris shader.
 */
export const sdfIris: TransitionFn = (from, to, out, w, h, p) => {
  // Accent colors for glow rings (16-bit scale)
  const accentBright = [65535, 55000, 35000] as const;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    // Aspect-corrected distance from center
    const ax = (ux - 0.5) * (w / h);
    const ay = uy - 0.5;
    const d = Math.sqrt(ax * ax + ay * ay);

    const radius = p * 1.2;
    const fw = 0.003;
    const edge = smoothstep(radius + fw, radius - fw, d);

    // Three glow rings at different radii and falloff speeds
    const ring1 = Math.exp(-Math.abs(d - radius) * 25);
    const ring2 = Math.exp(-Math.abs(d - radius + 0.04) * 20) * 0.5;
    const ring3 = Math.exp(-Math.abs(d - radius + 0.08) * 15) * 0.25;
    const glow = (ring1 + ring2 + ring3) * p * (1 - p) * 4;

    const [fromR, fromG, fromB] = sampleRgb48le(from, ux, uy, w, h);
    const [toR, toG, toB] = sampleRgb48le(to, ux, uy, w, h);

    out.writeUInt16LE(clamp16(mix16(fromR, toR, edge) + accentBright[0] * glow * 0.6), o);
    out.writeUInt16LE(clamp16(mix16(fromG, toG, edge) + accentBright[1] * glow * 0.6), o + 2);
    out.writeUInt16LE(clamp16(mix16(fromB, toB, edge) + accentBright[2] * glow * 0.6), o + 4);
  }
};
TRANSITIONS["sdf-iris"] = sdfIris;

// ── glitch ────────────────────────────────────────────────────────────────────

/**
 * Deterministic PRNG matching the GLSL `rand` in the glitch shader.
 * Uses different constants than `hash` — do NOT substitute.
 */
function glitchRand(x: number, y: number): number {
  return (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) % 1;
}

/**
 * Block displacement + scanlines + RGB channel split. Intensity peaks at the
 * midpoint (p=0.5) and decays at both ends. Port of the GLSL glitch shader.
 */
export const glitch: TransitionFn = (from, to, out, w, h, p) => {
  const intensity = p * (1 - p) * 4;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    // Horizontal line displacement
    const lineY = Math.floor(uy * 60) / 60;
    const lineDisp = (glitchRand(lineY, Math.floor(p * 17)) - 0.5) * 0.18 * intensity;

    // Block displacement
    const blockX = Math.floor(ux * 12);
    const blockY = Math.floor(uy * 8);
    const progressStep = Math.floor(p * 11);
    const br = glitchRand(blockX + progressStep, blockY + progressStep);
    const ba = (br >= 0.83 ? 1 : 0) * intensity;
    const bdx = (glitchRand(blockX * 2.1, blockY * 2.1) - 0.5) * 0.35 * ba;
    const bdy = (glitchRand(blockX * 3.7, blockY * 3.7) - 0.5) * 0.35 * ba;

    const uvx = Math.max(0, Math.min(1, ux + lineDisp + bdx));
    const uvy = Math.max(0, Math.min(1, uy + bdy));

    // RGB channel split on displaced UV
    const shift = intensity * 0.035;
    const r = sampleRgb48le(from, uvx + shift, uvy, w, h)[0];
    const g = sampleRgb48le(from, uvx, uvy, w, h)[1];
    const b = sampleRgb48le(from, uvx - shift, uvy, w, h)[2];

    // Normalize to 0-1 for scanline, flicker, and crush operations
    let cr = r / 65535;
    let cg = g / 65535;
    let cb = b / 65535;

    // Scanline darkening: darken rows where fract(uy * h * 0.5) > 0.5
    const scanline = (((uy * h * 0.5) % 1) + 1) % 1 >= 0.5 ? 0.05 * intensity : 0;
    cr -= scanline;
    cg -= scanline;
    cb -= scanline;

    // Brightness flicker
    const flicker = 1 + (glitchRand(Math.floor(p * 23), 0) - 0.5) * 0.3 * intensity;
    cr *= flicker;
    cg *= flicker;
    cb *= flicker;

    // Color crush (posterize)
    const levels = 256 - (256 - 8) * (intensity * 0.5);
    cr = Math.floor(cr * levels) / levels;
    cg = Math.floor(cg * levels) / levels;
    cb = Math.floor(cb * levels) / levels;

    // Scale back to 16-bit and mix with `to` by progress
    const [toR, toG, toB] = sampleRgb48le(to, ux, uy, w, h);
    out.writeUInt16LE(clamp16(mix16(Math.round(cr * 65535), toR, p)), o);
    out.writeUInt16LE(clamp16(mix16(Math.round(cg * 65535), toG, p)), o + 2);
    out.writeUInt16LE(clamp16(mix16(Math.round(cb * 65535), toB, p)), o + 4);
  }
};
TRANSITIONS["glitch"] = glitch;

// ── light-leak ────────────────────────────────────────────────────────────────

/**
 * ACES filmic tonemap. Input and output in 0-1 normalized range.
 * Formula: (x * (2.51x + 0.03)) / (x * (2.43x + 0.59) + 0.14)
 */
function aces(x: number): number {
  return Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
}

/**
 * Warm lens-flare from the upper-right corner. The incoming scene burns through
 * an overexposed flash, tonemapped with ACES and crossfaded with the outgoing
 * scene. Port of the GLSL light-leak shader.
 */
export const lightLeak: TransitionFn = (from, to, out, w, h, p) => {
  // Normalized accent colors (0-1 range for ACES pipeline)
  const accent = [50000 / 65535, 25000 / 65535, 5000 / 65535] as const;
  const accentBright = [65535 / 65535, 55000 / 65535, 35000 / 65535] as const;

  // Light source position
  const lpx = 1.3;
  const lpy = -0.2;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const dx = ux - lpx;
    const dy = uy - lpy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const leak = Math.max(0, Math.min(1, Math.exp(-dist * 1.8) * p * 4));

    // Warm color: mix accent with accent_bright based on distance
    const warmR = accent[0] + (accentBright[0] - accent[0]) * dist * 0.7;
    const warmG = accent[1] + (accentBright[1] - accent[1]) * dist * 0.7;
    const warmB = accent[2] + (accentBright[2] - accent[2]) * dist * 0.7;

    // Lens flare streak
    const flare = Math.exp(-Math.abs(uy - (-0.2 + ux * 0.3)) * 15) * leak * 0.3;

    const [fr, fg, fb] = sampleRgb48le(from, ux, uy, w, h);
    const fromR = fr / 65535;
    const fromG = fg / 65535;
    const fromB = fb / 65535;

    // Overexpose and tonemap
    const overR = aces(fromR + warmR * leak * 3 + accentBright[0] * flare);
    const overG = aces(fromG + warmG * leak * 3 + accentBright[1] * flare);
    const overB = aces(fromB + warmB * leak * 3 + accentBright[2] * flare);

    // Mix overexposed → to by smoothstepped progress
    const [toR, toG, toB] = sampleRgb48le(to, ux, uy, w, h);
    const blend = smoothstep(0.15, 0.85, p);

    out.writeUInt16LE(clamp16(mix16(Math.round(overR * 65535), toR, blend)), o);
    out.writeUInt16LE(clamp16(mix16(Math.round(overG * 65535), toG, blend)), o + 2);
    out.writeUInt16LE(clamp16(mix16(Math.round(overB * 65535), toB, blend)), o + 4);
  }
};
TRANSITIONS["light-leak"] = lightLeak;

// ── cross-warp-morph ──────────────────────────────────────────────────────────

/**
 * FBM displacement warp. Both frames are warped in opposite directions by a
 * fractal noise field, then blended by a noise-threshold mask that sweeps
 * across the screen as progress advances. Port of the GLSL cross-warp-morph shader.
 */
export const crossWarpMorph: TransitionFn = (from, to, out, w, h, p) => {
  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const dispX = fbm(ux * 3, uy * 3) - 0.5;
    const dispY = fbm(ux * 3 + 7.3, uy * 3 + 3.7) - 0.5;

    const fromUx = Math.max(0, Math.min(1, ux + dispX * p * 0.5));
    const fromUy = Math.max(0, Math.min(1, uy + dispY * p * 0.5));
    const toUx = Math.max(0, Math.min(1, ux - dispX * (1 - p) * 0.5));
    const toUy = Math.max(0, Math.min(1, uy - dispY * (1 - p) * 0.5));

    const [fromR, fromG, fromB] = sampleRgb48le(from, fromUx, fromUy, w, h);
    const [toR, toG, toB] = sampleRgb48le(to, toUx, toUy, w, h);

    const n = fbm(ux * 4 + 3.1, uy * 4 + 1.7);
    const blend = smoothstep(0.4, 0.6, n + p * 1.2 - 0.6);

    out.writeUInt16LE(clamp16(mix16(fromR, toR, blend)), o);
    out.writeUInt16LE(clamp16(mix16(fromG, toG, blend)), o + 2);
    out.writeUInt16LE(clamp16(mix16(fromB, toB, blend)), o + 4);
  }
};
TRANSITIONS["cross-warp-morph"] = crossWarpMorph;

// ── whip-pan ──────────────────────────────────────────────────────────────────

/**
 * Horizontal motion blur. The outgoing frame is sampled with offsets shifted
 * right (by progress*1.5) and the incoming frame is sampled with offsets shifted
 * left (by (1-progress)*1.5). Each direction uses 10 samples averaged together.
 * Port of the GLSL whip-pan shader.
 */
export const whipPan: TransitionFn = (from, to, out, w, h, p) => {
  const fromOff = p * 1.5;
  const toOff = (1 - p) * 1.5;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    let fromR = 0,
      fromG = 0,
      fromB = 0;
    for (let s = 0; s < 10; s++) {
      const f = s / 10;
      const fuv = Math.max(0, Math.min(1, ux + fromOff + p * 0.08 * f));
      const [r, g, b] = sampleRgb48le(from, fuv, uy, w, h);
      fromR += r;
      fromG += g;
      fromB += b;
    }
    fromR /= 10;
    fromG /= 10;
    fromB /= 10;

    let toR = 0,
      toG = 0,
      toB = 0;
    for (let s = 0; s < 10; s++) {
      const f = s / 10;
      const tuv = Math.max(0, Math.min(1, ux - toOff - (1 - p) * 0.08 * f));
      const [r, g, b] = sampleRgb48le(to, tuv, uy, w, h);
      toR += r;
      toG += g;
      toB += b;
    }
    toR /= 10;
    toG /= 10;
    toB /= 10;

    out.writeUInt16LE(clamp16(mix16(Math.round(fromR), Math.round(toR), p)), o);
    out.writeUInt16LE(clamp16(mix16(Math.round(fromG), Math.round(toG), p)), o + 2);
    out.writeUInt16LE(clamp16(mix16(Math.round(fromB), Math.round(toB), p)), o + 4);
  }
};
TRANSITIONS["whip-pan"] = whipPan;

// ── cinematic-zoom ────────────────────────────────────────────────────────────

/**
 * Radial zoom blur with chromatic aberration. Both frames are blurred along a
 * radial direction from center using 12 samples. R/G/B channels use slightly
 * different zoom factors (1.06, 1.0, 0.94) for chromatic aberration. The
 * outgoing frame zooms inward while the incoming zooms outward.
 * Port of the GLSL cinematic-zoom shader.
 */
export const cinematicZoom: TransitionFn = (from, to, out, w, h, p) => {
  const fromS = p * 0.08;
  const toS = (1 - p) * 0.06;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const dx = ux - 0.5;
    const dy = uy - 0.5;

    let fr = 0,
      fg = 0,
      fb = 0;
    for (let s = 0; s < 12; s++) {
      const f = s / 12;
      const rr = sampleRgb48le(
        from,
        ux - dx * fromS * 1.06 * f,
        uy - dy * fromS * 1.06 * f,
        w,
        h,
      )[0];
      const gg = sampleRgb48le(from, ux - dx * fromS * f, uy - dy * fromS * f, w, h)[1];
      const bb = sampleRgb48le(
        from,
        ux - dx * fromS * 0.94 * f,
        uy - dy * fromS * 0.94 * f,
        w,
        h,
      )[2];
      fr += rr;
      fg += gg;
      fb += bb;
    }
    fr /= 12;
    fg /= 12;
    fb /= 12;

    let tr = 0,
      tg = 0,
      tb = 0;
    for (let s = 0; s < 12; s++) {
      const f = s / 12;
      const rr = sampleRgb48le(to, ux + dx * toS * 1.06 * f, uy + dy * toS * 1.06 * f, w, h)[0];
      const gg = sampleRgb48le(to, ux + dx * toS * f, uy + dy * toS * f, w, h)[1];
      const bb = sampleRgb48le(to, ux + dx * toS * 0.94 * f, uy + dy * toS * 0.94 * f, w, h)[2];
      tr += rr;
      tg += gg;
      tb += bb;
    }
    tr /= 12;
    tg /= 12;
    tb /= 12;

    out.writeUInt16LE(clamp16(mix16(Math.round(fr), Math.round(tr), p)), o);
    out.writeUInt16LE(clamp16(mix16(Math.round(fg), Math.round(tg), p)), o + 2);
    out.writeUInt16LE(clamp16(mix16(Math.round(fb), Math.round(tb), p)), o + 4);
  }
};
TRANSITIONS["cinematic-zoom"] = cinematicZoom;

// ── gravitational-lens ────────────────────────────────────────────────────────

/**
 * Radial warp toward center simulating a gravitational lens effect. The
 * outgoing frame is warped with chromatic separation, masked by a horizon
 * that depends on distance from center. Mixed to the incoming frame using
 * smoothstep(0.3, 0.9, progress). Port of the GLSL gravitational-lens shader.
 */
export const gravitationalLens: TransitionFn = (from, to, out, w, h, p) => {
  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const uvx = ux - 0.5;
    const uvy = uy - 0.5;
    const dist = Math.sqrt(uvx * uvx + uvy * uvy);

    const pull = p * 2;
    const warpStr = (pull * 0.3) / (dist + 0.1);

    const warpedX = Math.max(0, Math.min(1, ux - uvx * warpStr));
    const warpedY = Math.max(0, Math.min(1, uy - uvy * warpStr));

    const [, ag] = sampleRgb48le(from, warpedX, warpedY, w, h);

    const horizon = smoothstep(0, 0.3, dist / (1 - p * 0.85 + 0.001));
    const shift = (pull * 0.02) / (dist + 0.2);

    const rSampX = Math.max(0, Math.min(1, ux - uvx * (warpStr + shift)));
    const rSampY = Math.max(0, Math.min(1, uy - uvy * (warpStr + shift)));
    const bSampX = Math.max(0, Math.min(1, ux - uvx * (warpStr - shift)));
    const bSampY = Math.max(0, Math.min(1, uy - uvy * (warpStr - shift)));

    const ar = sampleRgb48le(from, rSampX, rSampY, w, h)[0];
    const ab = sampleRgb48le(from, bSampX, bSampY, w, h)[2];

    const lensedR = Math.round(ar * horizon);
    const lensedG = Math.round(ag * horizon);
    const lensedB = Math.round(ab * horizon);

    const [toR, toG, toB] = sampleRgb48le(to, ux, uy, w, h);
    const blend = smoothstep(0.3, 0.9, p);

    out.writeUInt16LE(clamp16(mix16(lensedR, toR, blend)), o);
    out.writeUInt16LE(clamp16(mix16(lensedG, toG, blend)), o + 2);
    out.writeUInt16LE(clamp16(mix16(lensedB, toB, blend)), o + 4);
  }
};
TRANSITIONS["gravitational-lens"] = gravitationalLens;

// ── ripple-waves ──────────────────────────────────────────────────────────────

/**
 * Concentric wave distortion. Exponential wave functions create rings radiating
 * outward from center. Both frames are distorted — the outgoing with progress-
 * scaled amplitude, the incoming with (1-progress)-scaled amplitude. A warm
 * accent tint highlights wave peaks. Port of the GLSL ripple-waves shader.
 */
export const rippleWaves: TransitionFn = (from, to, out, w, h, p) => {
  // Accent bright color (16-bit)
  const accentBright = [65535, 55000, 35000] as const;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const uvx = ux - 0.5;
    const uvy = uy - 0.5;
    const dist = Math.sqrt(uvx * uvx + uvy * uvy);

    // Normalize direction from center, offset by small amount to avoid div-by-zero
    const nux = uvx + 0.001;
    const nuy = uvy + 0.001;
    const nlen = Math.sqrt(nux * nux + nuy * nuy);
    const dirx = nux / nlen;
    const diry = nuy / nlen;

    // From frame: waves moving outward (positive phase)
    const fromAmp = p * 0.04;
    const fw1 = Math.exp(Math.sin(dist * 25 - p * 12) - 1);
    const fw2 = Math.exp(Math.sin(dist * 50 - p * 18) - 1) * 0.5;
    const fromUx = Math.max(0, Math.min(1, ux + dirx * (fw1 + fw2) * fromAmp));
    const fromUy = Math.max(0, Math.min(1, uy + diry * (fw1 + fw2) * fromAmp));

    // To frame: waves moving inward (reversed phase)
    const toAmp = (1 - p) * 0.04;
    const tw1 = Math.exp(Math.sin(dist * 25 + p * 12) - 1);
    const tw2 = Math.exp(Math.sin(dist * 50 + p * 18) - 1) * 0.5;
    const toUx = Math.max(0, Math.min(1, ux - dirx * (tw1 + tw2) * toAmp));
    const toUy = Math.max(0, Math.min(1, uy - diry * (tw1 + tw2) * toAmp));

    const [fromR, fromG, fromB] = sampleRgb48le(from, fromUx, fromUy, w, h);
    const [toR, toG, toB] = sampleRgb48le(to, toUx, toUy, w, h);

    const peak = fw1 * p;
    const tintR = accentBright[0] * peak * 0.1;
    const tintG = accentBright[1] * peak * 0.1;
    const tintB = accentBright[2] * peak * 0.1;

    out.writeUInt16LE(clamp16(mix16(Math.round(fromR + tintR), toR, p)), o);
    out.writeUInt16LE(clamp16(mix16(Math.round(fromG + tintG), toG, p)), o + 2);
    out.writeUInt16LE(clamp16(mix16(Math.round(fromB + tintB), toB, p)), o + 4);
  }
};
TRANSITIONS["ripple-waves"] = rippleWaves;

// ── swirl-vortex ──────────────────────────────────────────────────────────────

/**
 * Rotational UV warp. The outgoing frame is rotated clockwise and the incoming
 * counter-clockwise. Rotation angle depends on distance from center and FBM
 * warp noise. Port of the GLSL swirl-vortex shader.
 */
export const swirlVortex: TransitionFn = (from, to, out, w, h, p) => {
  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const uvx = ux - 0.5;
    const uvy = uy - 0.5;
    const dist = Math.sqrt(uvx * uvx + uvy * uvy);

    const warp = fbm(ux * 4, uy * 4) * 0.5;

    const fromAng = p * (1 - dist) * 10 + warp * p * 3;
    const fs = Math.sin(fromAng);
    const fc = Math.cos(fromAng);
    const fromUx = Math.max(0, Math.min(1, uvx * fc - uvy * fs + 0.5));
    const fromUy = Math.max(0, Math.min(1, uvx * fs + uvy * fc + 0.5));

    const toAng = -(1 - p) * (1 - dist) * 10 - warp * (1 - p) * 3;
    const ts = Math.sin(toAng);
    const tc = Math.cos(toAng);
    const toUx = Math.max(0, Math.min(1, uvx * tc - uvy * ts + 0.5));
    const toUy = Math.max(0, Math.min(1, uvx * ts + uvy * tc + 0.5));

    const [fromR, fromG, fromB] = sampleRgb48le(from, fromUx, fromUy, w, h);
    const [toR, toG, toB] = sampleRgb48le(to, toUx, toUy, w, h);

    out.writeUInt16LE(clamp16(mix16(fromR, toR, p)), o);
    out.writeUInt16LE(clamp16(mix16(fromG, toG, p)), o + 2);
    out.writeUInt16LE(clamp16(mix16(fromB, toB, p)), o + 4);
  }
};
TRANSITIONS["swirl-vortex"] = swirlVortex;

// ── thermal-distortion ────────────────────────────────────────────────────────

/**
 * Heat shimmer effect. Horizontal displacement based on a sin wave modulated by
 * FBM noise, fading toward the top of the screen. Both frames are displaced
 * independently, and a warm haze overlay fades as progress advances.
 * Port of the GLSL thermal-distortion shader.
 */
export const thermalDistortion: TransitionFn = (from, to, out, w, h, p) => {
  // Accent bright color (16-bit)
  const accentBright = [65535, 55000, 35000] as const;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const heat = p * 1.5;
    const yFade = smoothstep(1, 0, uy);

    // From frame shimmer: fbm(uv*6) modulates sin wave
    const shimmer = Math.sin(uy * 40 + fbm(ux * 6, uy * 6) * 8) * fbm(ux * 3 + 0, uy * 3 + p * 2);
    const dispX = shimmer * heat * 0.03 * yFade;
    const fromUx = Math.max(0, Math.min(1, ux + dispX));
    const [fromR, fromG, fromB] = sampleRgb48le(from, fromUx, uy, w, h);

    // To frame shimmer: different FBM seed (offset by 3)
    const invShimmer =
      Math.sin(uy * 40 + fbm(ux * 6 + 3, uy * 6 + 3) * 8) * fbm(ux * 3 + 3, uy * 3 + p * 2);
    const dispX2 = invShimmer * (1 - p) * 0.03 * yFade;
    const toUx = Math.max(0, Math.min(1, ux + dispX2));
    const [toR, toG, toB] = sampleRgb48le(to, toUx, uy, w, h);

    const haze = heat * yFade * 0.15 * (1 - p);

    out.writeUInt16LE(clamp16(mix16(fromR, toR, p) + Math.round(accentBright[0] * haze)), o);
    out.writeUInt16LE(clamp16(mix16(fromG, toG, p) + Math.round(accentBright[1] * haze)), o + 2);
    out.writeUInt16LE(clamp16(mix16(fromB, toB, p) + Math.round(accentBright[2] * haze)), o + 4);
  }
};
TRANSITIONS["thermal-distortion"] = thermalDistortion;

// ── domain-warp ───────────────────────────────────────────────────────────────

/**
 * FBM-driven UV warp with edge glow. Computes two layers of FBM (q and r) to
 * derive a warp direction. Both frames are displaced in opposite directions.
 * An edge-detection glow appears at the transition boundary.
 * Port of the GLSL domain-warp shader. Note: mix(B, A, e) ordering — e=1 shows A (from).
 */
export const domainWarp: TransitionFn = (from, to, out, w, h, p) => {
  // Accent colors (16-bit)
  const accentDark = [25000, 8000, 2000] as const;
  const accentBright = [65535, 55000, 35000] as const;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    // Two-layer domain warp: q, then r
    const qx = fbm(ux * 3, uy * 3);
    const qy = fbm(ux * 3 + 5.2, uy * 3 + 1.3);
    const rx = fbm(ux * 3 + qx * 4 + 1.7, uy * 3 + qy * 4 + 9.2);
    const ry = fbm(ux * 3 + qx * 4 + 8.3, uy * 3 + qy * 4 + 2.8);

    const n = fbm(ux * 3 + rx * 2, uy * 3 + ry * 2);
    const warpDirX = (qx - 0.5) * 0.4;
    const warpDirY = (qy - 0.5) * 0.4;

    const aUx = Math.max(0, Math.min(1, ux + warpDirX * p));
    const aUy = Math.max(0, Math.min(1, uy + warpDirY * p));
    const bUx = Math.max(0, Math.min(1, ux - warpDirX * (1 - p)));
    const bUy = Math.max(0, Math.min(1, uy - warpDirY * (1 - p)));

    const [aR, aG, aB] = sampleRgb48le(from, aUx, aUy, w, h);
    const [bR, bG, bB] = sampleRgb48le(to, bUx, bUy, w, h);

    // e=1 → show A (from), e=0 → show B (to): mix(B, A, e)
    const e = smoothstep(p - 0.08, p + 0.08, n);

    const ed = Math.abs(n - p);
    // step(1, p) = p >= 1 ? 1 : 0 → suppress glow at p=1
    const pStep = p >= 1 ? 1 : 0;
    const em = smoothstep(0.1, 0, ed) * (1 - pStep);

    // Edge color: mix accent_dark → accent_bright based on edge proximity
    const ecBlend = smoothstep(0, 0.1, ed);
    const ecR = accentDark[0] + (accentBright[0] - accentDark[0]) * (1 - ecBlend);
    const ecG = accentDark[1] + (accentBright[1] - accentDark[1]) * (1 - ecBlend);
    const ecB = accentDark[2] + (accentBright[2] - accentDark[2]) * (1 - ecBlend);

    // mix(B, A, e) + edge glow
    out.writeUInt16LE(clamp16(mix16(bR, aR, e) + Math.round(ecR * em * 2)), o);
    out.writeUInt16LE(clamp16(mix16(bG, aG, e) + Math.round(ecG * em * 2)), o + 2);
    out.writeUInt16LE(clamp16(mix16(bB, aB, e) + Math.round(ecB * em * 2)), o + 4);
  }
};
TRANSITIONS["domain-warp"] = domainWarp;

// ── ridged-burn ───────────────────────────────────────────────────────────────

/**
 * Ridged noise threshold transition with heat glow and sparks. Uses a custom
 * ridged noise function (5 octaves of abs(vnoise*2 - 1)) to create a
 * burning-paper effect. Accent colors glow at the burn boundary. Sparks
 * appear from high-frequency noise.
 * Port of the GLSL ridged-burn shader. Note: mix(B, A, e) ordering — e=1 shows A (from).
 */

/**
 * Ridged noise: 5 octaves of abs(vnoise*2 - 1) with the same rotation and
 * scaling as fbm. Returns values in [0, ~0.97].
 */
function ridged(px: number, py: number): number {
  let value = 0;
  let amplitude = 0.5;
  let x = px;
  let y = py;

  for (let i = 0; i < 5; i++) {
    value += amplitude * Math.abs(vnoise(x, y) * 2 - 1);

    const nx = ROT_A * x - ROT_B * y;
    const ny = ROT_B * x + ROT_A * y;
    x = nx * 2.02;
    y = ny * 2.02;

    amplitude *= 0.5;
  }

  return value;
}

export const ridgedBurn: TransitionFn = (from, to, out, w, h, p) => {
  // Accent colors (16-bit)
  const accent = [50000, 25000, 5000] as const;
  const accentDark = [25000, 8000, 2000] as const;
  const accentBright = [65535, 55000, 35000] as const;

  for (let i = 0; i < w * h; i++) {
    const ux = (i % w) / w;
    const uy = Math.floor(i / w) / h;
    const o = i * 6;

    const [aR, aG, aB] = sampleRgb48le(from, ux, uy, w, h);
    const [bR, bG, bB] = sampleRgb48le(to, ux, uy, w, h);

    const n = ridged(ux * 4, uy * 4);

    // e=1 → show A (from), e=0 → show B (to): mix(B, A, e)
    const e = smoothstep(p - 0.04, p + 0.04, n);

    const heat = smoothstep(0.12, 0, Math.abs(n - p));
    // step(1, p) = p >= 1 ? 1 : 0 → suppress glow at p=1
    const pStep = p >= 1 ? 1 : 0;
    const heatMasked = heat * (1 - pStep);

    // Burn color gradient: dark → accent → accent_bright → white
    let burnR = accentDark[0] + (accent[0] - accentDark[0]) * smoothstep(0, 0.25, heatMasked);
    let burnG = accentDark[1] + (accent[1] - accentDark[1]) * smoothstep(0, 0.25, heatMasked);
    let burnB = accentDark[2] + (accent[2] - accentDark[2]) * smoothstep(0, 0.25, heatMasked);
    const blend2 = smoothstep(0.25, 0.5, heatMasked);
    burnR = burnR + (accentBright[0] - burnR) * blend2;
    burnG = burnG + (accentBright[1] - burnG) * blend2;
    burnB = burnB + (accentBright[2] - burnB) * blend2;
    const blend3 = smoothstep(0.5, 1, heatMasked);
    burnR = burnR + (65535 - burnR) * blend3;
    burnG = burnG + (65535 - burnG) * blend3;
    burnB = burnB + (65535 - burnB) * blend3;

    // Sparks: high-frequency noise above threshold
    const sparks = (vnoise(ux * 80, uy * 80) >= 0.92 ? 1 : 0) * heatMasked * 3;

    out.writeUInt16LE(
      clamp16(
        mix16(bR, aR, e) +
          Math.round(burnR * heatMasked * 3.5) +
          Math.round(accentBright[0] * sparks),
      ),
      o,
    );
    out.writeUInt16LE(
      clamp16(
        mix16(bG, aG, e) +
          Math.round(burnG * heatMasked * 3.5) +
          Math.round(accentBright[1] * sparks),
      ),
      o + 2,
    );
    out.writeUInt16LE(
      clamp16(
        mix16(bB, aB, e) +
          Math.round(burnB * heatMasked * 3.5) +
          Math.round(accentBright[2] * sparks),
      ),
      o + 4,
    );
  }
};
TRANSITIONS["ridged-burn"] = ridgedBurn;
