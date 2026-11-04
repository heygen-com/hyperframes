/** Band-limited resampling by windowed-sinc interpolation, so analysis reads the same at any decode rate. */

import { finish, type Steps } from "./audioSteps";

const ZERO_CROSSINGS = 8;
const STEPS_PER_CROSSING = 256;
/** Cutoff as a share of the lower Nyquist, leaving the window's transition band below it. */
const CUTOFF = 0.95;

const KERNEL = Float64Array.from({ length: ZERO_CROSSINGS * STEPS_PER_CROSSING + 2 }, (_, i) => {
  const x = i / STEPS_PER_CROSSING;
  if (x >= ZERO_CROSSINGS) return 0;
  const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  return sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / ZERO_CROSSINGS));
});

function kernelAt(x: number): number {
  const at = Math.abs(x) * STEPS_PER_CROSSING;
  const i = Math.floor(at);
  if (i + 1 >= KERNEL.length) return 0;
  const frac = at - i;
  return KERNEL[i]! * (1 - frac) + KERNEL[i + 1]! * frac;
}

export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  return finish(resampleSteps(samples, from, to));
}

const SAMPLES_PER_STEP = 4096;

export function* resampleSteps(
  samples: Float32Array,
  from: number,
  to: number,
): Steps<Float32Array> {
  if (from === to) return samples;
  const ratio = to / from;
  const scale = Math.min(1, ratio) * CUTOFF;
  const reach = ZERO_CROSSINGS / scale;
  const out = new Float32Array(Math.floor(samples.length * ratio));
  for (let n = 0; n < out.length; n++) {
    if (n % SAMPLES_PER_STEP === 0) yield;
    const t = n / ratio;
    const last = Math.min(samples.length - 1, Math.floor(t + reach));
    let sum = 0;
    for (let k = Math.max(0, Math.ceil(t - reach)); k <= last; k++)
      sum += samples[k]! * kernelAt((t - k) * scale);
    out[n] = sum * scale;
  }
  return out;
}
