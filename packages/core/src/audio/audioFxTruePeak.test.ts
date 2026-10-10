import { describe, expect, it } from "vitest";
import { ensureAudioFxWorklets } from "./audioFxWorklets.js";
import { truePeakLatencySamples } from "./audioFxTruePeak.js";

const SR = 48000;
const BLOCK = 128;

interface Processor {
  port: { postMessage(data: unknown): void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
type ProcessorClass = new (o: unknown) => Processor;

/** The registered processors, evaluated from the module `addModule` is handed. */
async function loadProcessors(): Promise<Map<string, ProcessorClass>> {
  let moduleSource = "";
  await ensureAudioFxWorklets({
    audioWorklet: {
      addModule: async (url: string) => {
        moduleSource = atob(url.replace("data:text/javascript;base64,", ""));
      },
    },
  } as unknown as BaseAudioContext);
  const made = new Map<string, ProcessorClass>();
  class Base {
    port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage: (data: unknown) => this.port.onmessage?.({ data }),
    };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", moduleSource)(
    Base,
    (name: string, cls: ProcessorClass) => made.set(name, cls),
    SR,
  );
  return made;
}

const processors = await loadProcessors();

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

const dbToLin = (db: number): number => Math.pow(10, db / 20);
const linToDb = (lin: number): number => 20 * Math.log10(Math.max(lin, 1e-12));

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
}

/**
 * True peak in dBFS from 16x Kaiser-windowed sinc interpolation, 48 taps each
 * side. Deliberately a different and longer filter than the limiter's own 4x
 * detector, so a detector that flatters its own estimate cannot pass.
 */
function truePeakDb(x: Float32Array): number {
  const OS = 16;
  const SIDE = 48;
  const beta = 9;
  const norm = besselI0(beta);
  const kernel = new Float64Array(OS * (2 * SIDE));
  for (let phase = 0; phase < OS; phase++) {
    for (let k = -SIDE + 1; k <= SIDE; k++) {
      const t = k - phase / OS;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = t / SIDE;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / norm;
      kernel[phase * 2 * SIDE + (k + SIDE - 1)] = sinc * w;
    }
  }
  let peak = 0;
  for (let n = SIDE; n < x.length - SIDE; n++) {
    for (let phase = 0; phase < OS; phase++) {
      let acc = 0;
      for (let k = -SIDE + 1; k <= SIDE; k++) {
        acc += (x[n - k] ?? 0) * (kernel[phase * 2 * SIDE + (k + SIDE - 1)] ?? 0);
      }
      peak = Math.max(peak, Math.abs(acc));
    }
  }
  return linToDb(peak);
}

const sine = (freq: number, amp: number, seconds: number, phase = 0): Float32Array => {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++)
    out[i] = amp * Math.sin(2 * Math.PI * freq * (i / SR) + phase);
  return out;
};

/** Tolerance on the ceiling for tonal material: the 4x detector against a 16x meter. */
const TOLERANCE_DB = 0.25;
/** Broadband noise has energy where a finite interpolator reads low. */
const BROADBAND_TOLERANCE_DB = 0.4;

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
    let compared = 0;
    for (let k = Math.round(0.2 * SR); k < Math.round(0.25 * SR); k++) {
      const inL = loud[k] ?? 0;
      const inR = quiet[k] ?? 0;
      if (Math.abs(inL) < 0.3 || Math.abs(inR) < 0.02) continue;
      const gainL = (l?.[k + latency] ?? 0) / inL;
      const gainR = (r?.[k + latency] ?? 0) / inR;
      expect(gainL).toBeLessThan(0.9);
      expect(gainR).toBeCloseTo(gainL, 3);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
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
