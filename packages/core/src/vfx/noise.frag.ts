/**
 * `noise` kernel — GLSL ES 3.00, capture `self`.
 *
 * A port of After Effects' `ADBE Noise`, decoded from `AEFX_Noise.metallib`
 * (`docs/superpowers/specs/ae-metal-ir/AEFX_Noise.metallib.ll` in the exporter
 * repo, helper `_Z5Noise8PixelRGBiifiiff`). The kernel is a pure integer hash of
 * `(x, y, seed)` — no lookup table, no state between frames — so it ports
 * exactly and stays seek-safe by construction.
 *
 * **What the IR says, read from the struct metadata rather than from prose.**
 * `NoiseKernelValues` is `{ inDeviceFormat, inNoiseAmount, inUseColorNoise,
 * inClipNoiseOutput, inRandomSeed_High, inRandomSeed_Low, inNoiseOffsetX,
 * inNoiseOffsetY, … }`. So `ADBE Noise-0002` is **Use Color Noise**, a
 * checkbox — not the "Noise Type (Uniform / Gaussian)" popup the deep dive
 * guessed — and the two mystery seed floats are the halves of one 32-bit
 * random seed. Both params are named here the way the metadata names them.
 *
 * Per channel:
 *
 *     seed32 = (uint(seedHigh) << 16) | (uint(seedLow) & 0xFFFF)
 *     h      = jenkinsMix(a, y, seed32)          // Bob Jenkins' 1997 mix, verbatim
 *     t2     = h  * 1103515245 + 12345
 *     t4     = t2 * 12996205   + 12345
 *     byte   = ((t4 >> 16) & 0xFF) ^ ((t2 >> 9) & 0x7F80)
 *     noise  = amount · (byte / 32704 − 0.5)
 *
 * with `a = x` for monochrome noise and `a = 3x + channel` (R, G, B) for colour
 * noise — four separate hash blocks in the IR, three of them consecutive in
 * `3x`. `32704` is the reciprocal constant `0x3F00002000000000` spelled as a
 * fraction. The noise is ADDED to the buffer's colour and, when Clip Result
 * Values is on, all four channels are clamped to [0, 1] — alpha is clamped but
 * never noised.
 *
 * **Interim seed (plan Task 2.7, pending the Task 4.3 probe).** What the CPU
 * puts in `inRandomSeed_High`/`inRandomSeed_Low` per frame is still unknown —
 * it is the effect's Random Seed combined with something frame-derived, which
 * is why the noise animates with no keyframed property. Until the probe pins
 * it, this kernel seeds the low half with the frame index and leaves the high
 * half at zero, so the pattern is deterministic per frame and different between
 * frames. Switching to the decoded packing is a change to two lines here and
 * two in the reference; nothing else depends on it, and the tests assert the
 * byte distribution and determinism rather than After Effects parity.
 *
 * **Pixel space.** `x` and `y` are integer pixel coordinates with y measured
 * from the TOP, which is how After Effects indexes the buffer — the shader's
 * `v_uv` is y-up, so the row is flipped back here. `inNoiseOffsetX/Y` (the
 * layer's origin inside the source buffer) are not modelled: a HyperFrames host
 * always captures its own box, so its origin is (0, 0).
 *
 * **Premultiplication.** The noise is added to the captured texel as it is,
 * which is premultiplied — the literal port, and After Effects' own buffers are
 * premultiplied too. The consequence is worth stating: on a layer with
 * transparency the noise lands in the transparent region as well, exactly as
 * the effect does in After Effects.
 *
 * **`rgb ≤ a` is enforced regardless of `Clip Result Values`, and that is a
 * deliberate DEPARTURE from AE, not a port of it.** A valid premultiplied
 * colour always has `rgb ≤ a` component-wise (it is `straightRgb · a`); adding
 * noise to `src.rgb` can push it above `src.a` on a near-transparent texel,
 * and `clamp(out4, 0, 1)` alone does not fix that — it clamps each channel to
 * [0, 1] independently, never rgb to a. After Effects can carry that
 * transient state through its float pipeline because everything downstream of
 * it is float too; every render target this runtime writes is 8-bit RGBA
 * (`GL_ATTRS`, `makePingTarget`), and an invalid premultiplied texel read back
 * later (e.g. straight-alpha `rgb / a` for display) reads as a blown-out
 * bright fringe rather than the visible defect After Effects itself never
 * produces. So the clamp to `a` runs unconditionally, on both the `Clip
 * Result Values` on and off paths.
 *
 * **`Clip Result Values` off is otherwise inert here, and that is a real,
 * currently permanent limitation, not a bug to fix in this file.** Every
 * render target in this runtime — the visible `.hf-vfx-out` canvas AND the
 * ping-pong intermediates a multi-node chain reads between passes — is 8-bit
 * `UNSIGNED_BYTE` RGBA, and the GL spec clamps a float fragment output to
 * [0, 1] on conversion to a normalized integer target regardless of what the
 * shader computes. `u_clipping = 0` therefore cannot produce an unclamped
 * value anywhere in this pipeline today; it would take a floating-point
 * render target (a real infrastructure change, not a one-line fix) to give it
 * one. Recorded rather than silently accepted: a reviewer who mutates this
 * shader and finds `u_clipping` untestable is finding a known limitation, not
 * a fresh bug.
 */

/**
 * The constants the reference has to agree with, named once. `byteScale` is
 * `0x3F00002000000000` from the IR — (1 + 2⁻⁹) · 2⁻¹⁵, i.e. 1/32704.
 */
export const NOISE_CONSTANTS = {
  lcgMulA: 1103515245,
  lcgMulB: 12996205,
  lcgAdd: 12345,
  highMask: 0x7f80,
  lowMask: 0xff,
  byteScale: 32704,
} as const;

const { lcgMulA, lcgMulB, lcgAdd, highMask, lowMask, byteScale } = NOISE_CONSTANTS;

export const NOISE_FRAG = `#version 300 es
precision highp float;
// NOT decoration: a fragment shader's default integer precision is mediump,
// and a mediump uint is only guaranteed 16 bits (ESSL 3.00 §4.5.2). Every step
// below — the Jenkins mix, both LCG rounds — is defined by 32-bit wraparound,
// so without this the hash is a different function on any implementation that
// honours the minimum. ANGLE and SwiftShader both use 32-bit ints, which is
// exactly why no test on this machine would catch it.
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_size;
uniform float u_t;
uniform float u_fps;
uniform sampler2D u_src;
uniform float u_amount;
uniform float u_useColorNoise;
uniform float u_clipping;

// Bob Jenkins' 1997 integer mix, the six-round shift/xor/subtract sequence the
// metallib runs verbatim. uint arithmetic wraps in GLSL ES 3.00, which is what
// makes this bit-identical to the C original.
uint hfJenkinsMix(uint a, uint b, uint c) {
  a -= b; a -= c; a ^= (c >> 13u);
  b -= c; b -= a; b ^= (a << 8u);
  c -= a; c -= b; c ^= (b >> 13u);
  a -= b; a -= c; a ^= (c >> 12u);
  b -= c; b -= a; b ^= (a << 16u);
  c -= a; c -= b; c ^= (b >> 5u);
  a -= b; a -= c; a ^= (c >> 3u);
  b -= c; b -= a; b ^= (a << 10u);
  c -= a; c -= b; c ^= (b >> 15u);
  return c;
}

// The hash's 15-bit output byte for one channel.
float hfNoiseByte(uint a, uint y, uint seed) {
  uint h = hfJenkinsMix(a, y, seed);
  uint t2 = h * ${lcgMulA}u + ${lcgAdd}u;
  uint t4 = t2 * ${lcgMulB}u + ${lcgAdd}u;
  return float(((t4 >> 16u) & ${lowMask}u) ^ ((t2 >> 9u) & ${highMask}u));
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec2 px = floor(v_uv * u_size);
  uint x = uint(max(px.x, 0.0));
  // After Effects indexes rows from the top; v_uv is y-up.
  uint y = uint(max(u_size.y - 1.0 - px.y, 0.0));
  float frame = floor(u_t * u_fps + 0.5);
  uint seed = uint(max(frame, 0.0)) & 0xFFFFu;

  float amount = u_amount * 0.01;
  vec3 nz;
  if (u_useColorNoise > 0.5) {
    uint a = x * 3u;
    nz = vec3(hfNoiseByte(a, y, seed), hfNoiseByte(a + 1u, y, seed), hfNoiseByte(a + 2u, y, seed));
  } else {
    nz = vec3(hfNoiseByte(x, y, seed));
  }
  nz = amount * (nz / ${byteScale}.0 - 0.5);

  vec4 out4 = vec4(src.rgb + nz, src.a);
  // A valid premultiplied colour needs rgb <= a component-wise; noise on a
  // near-transparent texel can push rgb above it, which our fixed 8-bit RGBA
  // storage cannot carry safely the way AE's float pipeline can (see the doc
  // comment above). This runs before, and independently of, u_clipping.
  out4.rgb = min(out4.rgb, out4.a);
  fragColor = u_clipping > 0.5 ? clamp(out4, 0.0, 1.0) : out4;
}
`;
