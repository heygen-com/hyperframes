import { describe, expect, it } from "vitest";
import { loadProcessors, type Processor } from "./audioFxProcessors.test-helpers.js";
import { truePeakLatencySamples } from "./audioFxTruePeak.js";

const SR = 48000;
const BLOCK = 128;

const processors = await loadProcessors(SR);

function makeProcessor(name: string, options: Record<string, number>): Processor {
  const Cls = processors.get(name);
  if (!Cls) throw new Error(`no processor ${name}`);
  return new Cls({ processorOptions: options });
}

/** Run planes through a processor in render quanta, returning planes of the same length. */
function run(p: Processor, planes: Float32Array[]): Float32Array[] {
  const frames = planes[0]?.length ?? 0;
  const out = planes.map(() => new Float32Array(frames));
  for (let at = 0; at < frames; at += BLOCK) {
    const n = Math.min(BLOCK, frames - at);
    const inBlock = planes.map((pl) => {
      const b = new Float32Array(BLOCK);
      b.set(pl.subarray(at, at + n));
      return b;
    });
    const outBlock = planes.map(() => new Float32Array(BLOCK));
    p.process([inBlock], [outBlock]);
    outBlock.forEach((b, c) => out[c]?.set(b.subarray(0, n), at));
  }
  return out;
}

const sampleOf = (plane: Float32Array | undefined, i: number): number => plane?.[i] ?? 0;
const dbToLin = (db: number): number => Math.pow(10, db / 20);
const linToDb = (lin: number): number => 20 * Math.log10(Math.max(lin, 1e-12));

/** In-place radix-2 FFT; the inverse leaves the 1/n scale to the caller. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let j = 0;
    for (let b = 0; b < bits; b++) j |= ((i >> b) & 1) << (bits - 1 - b);
    if (j > i) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let at = 0; at < n; at += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const a = at + k;
        const b = a + half;
        const tr = (re[b] as number) * wr - (im[b] as number) * wi;
        const ti = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
        const next = wr * stepRe - wi * stepIm;
        wi = wr * stepIm + wi * stepRe;
        wr = next;
      }
    }
  }
}

/** Samples at each end left out of the peak search: the zero padding rings there. */
const METER_EDGE = 512;
const METER_OVERSAMPLE = 16;

/**
 * True peak in dBFS from an ideal 16x interpolation (zero-padded FFT), not the
 * limiter's 4x detector: a finite FIR meter reads full-band noise about 0.5 dB low.
 */
function truePeakDb(x: Float32Array): number {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im, false);
  const m = n * METER_OVERSAMPLE;
  const upRe = new Float64Array(m);
  const upIm = new Float64Array(m);
  const half = n >> 1;
  for (let k = 0; k < half; k++) {
    upRe[k] = re[k] as number;
    upIm[k] = im[k] as number;
    if (k > 0) {
      upRe[m - k] = re[n - k] as number;
      upIm[m - k] = im[n - k] as number;
    }
  }
  // The Nyquist bin is real and belongs to both sides of the wider spectrum.
  upRe[half] = (re[half] as number) / 2;
  upRe[m - half] = (re[half] as number) / 2;
  fft(upRe, upIm, true);
  let peak = 0;
  const from = METER_EDGE * METER_OVERSAMPLE;
  const to = (x.length - METER_EDGE) * METER_OVERSAMPLE;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(upRe[i] as number) / n);
  return linToDb(peak);
}

const sine = (freq: number, amp: number, seconds: number, phase = 0): Float32Array => {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++)
    out[i] = amp * Math.sin(2 * Math.PI * freq * (i / SR) + phase);
  return out;
};

/** What the ideal-interpolation meter reads on tones, rounded up: they land on the ceiling. */
const TOLERANCE_DB = 0.01;
/** A dense program of tones and low-passed noise bursts reads 0.445 dB over. */
const BROADBAND_TOLERANCE_DB = 0.5;
/** This 2 s hot Gaussian noise reads 1.09 to 1.31 dB over; across 28 longer runs the worst was 1.67. */
const FULL_BAND_NOISE_TOLERANCE_DB = 1.35;

describe("hf-truepeak", () => {
  it("holds an inter-sample peak that the sample peak hides under the ceiling", () => {
    // fs/4 at 45 degrees: every sample is +-0.707 but the waveform between them
    // reaches 1.0, a +3 dB overshoot no sample-peak detector can see.
    const input = sine(SR / 4, 1, 0.5, Math.PI / 4);
    expect(linToDb(Math.max(...input.map(Math.abs)))).toBeCloseTo(-3.01, 1);
    expect(truePeakDb(input)).toBeGreaterThan(-0.2);

    const ceiling = -6;
    const [out] = run(makeProcessor("hf-truepeak", { ceiling, lookahead: 3, release: 80 }), [
      input,
    ]);
    expect(truePeakDb(out as Float32Array)).toBeLessThanOrEqual(ceiling + TOLERANCE_DB);
  });

  it("does not let the envelope limiter's miss through: same signal, same ceiling", () => {
    const input = sine(SR / 4, 1, 0.5, Math.PI / 4);
    const ceiling = -6;
    const [old] = run(makeProcessor("hf-limiter", { limit: ceiling, attack: 5, release: 50 }), [
      input,
    ]);
    const [next] = run(makeProcessor("hf-truepeak", { ceiling, lookahead: 3, release: 80 }), [
      input,
    ]);
    expect(truePeakDb(old as Float32Array)).toBeGreaterThan(ceiling + 1);
    expect(truePeakDb(next as Float32Array)).toBeLessThanOrEqual(ceiling + TOLERANCE_DB);
  });

  it("is in place before an abrupt onset reaches the output", () => {
    const quiet = sine(997, 0.1, 0.2);
    const loud = sine(997, 1.4, 0.2);
    const input = new Float32Array(quiet.length + loud.length);
    input.set(quiet);
    input.set(loud, quiet.length);
    const ceiling = -3;
    const [out] = run(makeProcessor("hf-truepeak", { ceiling, lookahead: 1.5, release: 120 }), [
      input,
    ]);
    expect(truePeakDb(out as Float32Array)).toBeLessThanOrEqual(ceiling + TOLERANCE_DB);
  });

  it("keeps a dense program with random peaks and broadband noise under the ceiling", () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff - 0.5;
    };
    const input = new Float32Array(SR);
    const tones = [220, 1450, 5200, 11800];
    let smooth = 0;
    for (let i = 0; i < input.length; i++) {
      let v = 0;
      for (const f of tones) v += 0.35 * Math.sin(2 * Math.PI * f * (i / SR) + f);
      // Noise through a one-pole lowpass near 6 kHz, gated into bursts.
      smooth += 0.5 * (rand() - smooth);
      input[i] = v + 3 * smooth * (Math.sin(2 * Math.PI * 3 * (i / SR)) > 0.7 ? 1 : 0.1);
    }
    expect(truePeakDb(input)).toBeGreaterThan(3);
    const ceiling = -14;
    const [out] = run(makeProcessor("hf-truepeak", { ceiling, lookahead: 3, release: 80 }), [
      input,
    ]);
    expect(truePeakDb(out as Float32Array)).toBeLessThanOrEqual(ceiling + BROADBAND_TOLERANCE_DB);
  });

  it("lets full-band noise end up over the ceiling by the measured distance, no further", () => {
    let seed = 99;
    const uniform = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed + 0.5) / 4294967296;
    };
    const input = new Float32Array(SR * 2);
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.5 * Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    }
    expect(truePeakDb(input)).toBeGreaterThan(6);
    for (const ceiling of [-1, -6, -14]) {
      const [out] = run(makeProcessor("hf-truepeak", { ceiling, lookahead: 3, release: 80 }), [
        input,
      ]);
      const over = truePeakDb(out as Float32Array) - ceiling;
      expect(over).toBeLessThanOrEqual(FULL_BAND_NOISE_TOLERANCE_DB);
    }
  }, 30_000);

  it("passes a signal under the ceiling unchanged, delayed by exactly its latency", () => {
    const input = sine(440, 0.1, 0.3);
    const lookahead = 3;
    const latency = truePeakLatencySamples(lookahead, SR);
    const [out] = run(makeProcessor("hf-truepeak", { ceiling: -1, lookahead, release: 80 }), [
      input,
    ]);
    for (let i = latency; i < input.length; i++) {
      expect(out?.[i]).toBeCloseTo(input[i - latency] ?? 0, 6);
    }
  });

  it("delays an impulse by truePeakLatencySamples and by nothing else", () => {
    for (const lookahead of [0.5, 1.5, 3, 10]) {
      const input = new Float32Array(2400);
      input[100] = 0.1;
      const [out] = run(makeProcessor("hf-truepeak", { ceiling: -1, lookahead, release: 80 }), [
        input,
      ]);
      const at = (out as Float32Array).findIndex((v) => Math.abs(v) > 1e-6);
      expect(at).toBe(100 + truePeakLatencySamples(lookahead, SR));
      expect(out?.[at]).toBeCloseTo(0.1, 6);
    }
  });

  describe("release", () => {
    /** Output peak over input peak, in 1 ms windows, aligned for the latency. */
    function gainAt(input: Float32Array, out: Float32Array, latency: number, t: number): number {
      const win = Math.round(0.001 * SR);
      const start = Math.round(t * SR);
      let a = 0;
      let b = 0;
      for (let i = start; i < start + win; i++) {
        a = Math.max(a, Math.abs(input[i] ?? 0));
        b = Math.max(b, Math.abs(out[i + latency] ?? 0));
      }
      return b / a;
    }

    function burst(): { input: Float32Array; endsAt: number } {
      const bed = sine(1000, 0.25, 0.3);
      const hit = sine(1000, 1, 0.05);
      const tail = sine(1000, 0.25, 1.2);
      const input = new Float32Array(bed.length + hit.length + tail.length);
      input.set(bed);
      input.set(hit, bed.length);
      input.set(tail, bed.length + hit.length);
      return { input, endsAt: (bed.length + hit.length) / SR };
    }

    it("recovers along the release time constant after the peak has passed", () => {
      const { input, endsAt } = burst();
      const lookahead = 3;
      const latency = truePeakLatencySamples(lookahead, SR);
      const ceiling = -6;
      const [out] = run(makeProcessor("hf-truepeak", { ceiling, lookahead, release: 100 }), [
        input,
      ]);
      const held = gainAt(input, out as Float32Array, latency, endsAt - 0.01);
      expect(held).toBeCloseTo(dbToLin(ceiling), 1);
      // One time constant after the hit: a one-pole has closed 63% of the gap.
      const after = gainAt(input, out as Float32Array, latency, endsAt + 0.1);
      const expected = 1 - (1 - held) * Math.exp(-1);
      expect(after).toBeGreaterThan(expected - 0.03);
      expect(after).toBeLessThan(expected + 0.03);
      expect(gainAt(input, out as Float32Array, latency, endsAt + 1)).toBeGreaterThan(0.995);
    });

    it("recovers more slowly with a longer release", () => {
      const { input, endsAt } = burst();
      const latency = truePeakLatencySamples(3, SR);
      const quick = run(makeProcessor("hf-truepeak", { ceiling: -6, lookahead: 3, release: 50 }), [
        input,
      ])[0] as Float32Array;
      const slow = run(makeProcessor("hf-truepeak", { ceiling: -6, lookahead: 3, release: 400 }), [
        input,
      ])[0] as Float32Array;
      const t = endsAt + 0.15;
      expect(gainAt(input, quick, latency, t)).toBeGreaterThan(
        gainAt(input, slow, latency, t) + 0.15,
      );
    });
  });

  it("applies one gain to every channel so the image does not move", () => {
    const loud = sine(SR / 4, 1, 0.3, Math.PI / 4);
    const quiet = sine(330, 0.05, 0.3);
    const latency = truePeakLatencySamples(3, SR);
    const [l, r] = run(makeProcessor("hf-truepeak", { ceiling: -6, lookahead: 3, release: 80 }), [
      loud,
      quiet,
    ]);
    // The quiet channel is far under the ceiling on its own, yet it ducks with the loud one.
    const gains: [number, number][] = [];
    for (let k = Math.round(0.2 * SR); k < Math.round(0.25 * SR); k++) {
      const inL = sampleOf(loud, k);
      const inR = sampleOf(quiet, k);
      if (Math.abs(inL) >= 0.3 && Math.abs(inR) >= 0.02) {
        gains.push([sampleOf(l, k + latency) / inL, sampleOf(r, k + latency) / inR]);
      }
    }
    expect(gains.length).toBeGreaterThan(100);
    for (const [gainL, gainR] of gains) {
      expect(gainL).toBeLessThan(0.9);
      expect(gainR).toBeCloseTo(gainL, 3);
    }
  });

  it("forgets its delay line and held gain when told the signal jumped", () => {
    const loud = sine(SR / 4, 1, 0.1, Math.PI / 4);
    const quiet = sine(440, 0.05, 0.1);
    const p = makeProcessor("hf-truepeak", { ceiling: -6, lookahead: 3, release: 2000 });
    run(p, [loud]);
    p.port.postMessage({ __hfReset: true });
    const [out] = run(p, [quiet]);
    const latency = truePeakLatencySamples(3, SR);
    expect(Math.max(...(out as Float32Array).subarray(0, latency).map(Math.abs))).toBe(0);
    for (let i = latency; i < quiet.length; i++) {
      expect(out?.[i]).toBeCloseTo(quiet[i - latency] ?? 0, 6);
    }
    const kept = makeProcessor("hf-truepeak", { ceiling: -6, lookahead: 3, release: 2000 });
    run(kept, [loud]);
    const [carried] = run(kept, [quiet]);
    expect(
      Math.max(...(carried as Float32Array).subarray(0, latency).map(Math.abs)),
    ).toBeGreaterThan(0);
    expect(Math.abs((carried?.[latency + 200] ?? 0) / (quiet[200] ?? 1))).toBeLessThan(0.9);
  });

  it("takes ceiling and release live but keeps the lookahead it was built with", () => {
    const p = makeProcessor("hf-truepeak", { ceiling: 0, lookahead: 3, release: 80 });
    const input = sine(SR / 4, 1, 0.3, Math.PI / 4);
    p.port.postMessage({ ceiling: -6, lookahead: 10 });
    const [out] = run(p, [input]);
    expect(truePeakDb(out as Float32Array)).toBeLessThanOrEqual(-6 + TOLERANCE_DB);
    const impulse = new Float32Array(2400);
    impulse[50] = 0.05;
    const q = makeProcessor("hf-truepeak", { ceiling: -1, lookahead: 3, release: 80 });
    q.port.postMessage({ lookahead: 10 });
    const [o2] = run(q, [impulse]);
    expect((o2 as Float32Array).findIndex((v) => Math.abs(v) > 1e-6)).toBe(
      50 + truePeakLatencySamples(3, SR),
    );
  });
});
