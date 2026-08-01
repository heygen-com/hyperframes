/**
 * AudioWorklet processors for the effects Web Audio has no native node for.
 *
 * Each one targets the behaviour of its FFmpeg counterpart rather than of any
 * particular plugin, because the render is FFmpeg and preview only earns its
 * keep by predicting the render. How closely each lands is measured, not
 * assumed — see the preview/render parity harness.
 *
 * Kept as a source string so it can be registered from a Blob URL without a
 * separate bundled asset, which keeps the studio's build unchanged.
 */
export const AUDIO_FX_WORKLET_SOURCE = `
const dbToLin = (db) => Math.pow(10, db / 20);

/** One-pole envelope follower shared by the dynamics processors. */
class Env {
  constructor(attackMs, releaseMs) { this.set(attackMs, releaseMs); this.value = 0; }
  set(attackMs, releaseMs) {
    this.a = Math.exp(-1 / (sampleRate * Math.max(1e-5, attackMs / 1000)));
    this.r = Math.exp(-1 / (sampleRate * Math.max(1e-5, releaseMs / 1000)));
  }
  push(x) {
    const m = Math.abs(x);
    const c = m > this.value ? this.a : this.r;
    this.value = m + c * (this.value - m);
    return this.value;
  }
}

/** Soft-knee gain computer in dB, matching acompressor's shape. */
function kneeGain(envDb, thresholdDb, ratio, kneeDb) {
  const over = envDb - thresholdDb;
  if (kneeDb > 0 && over > -kneeDb && over < kneeDb) {
    const t = (over + kneeDb) / (2 * kneeDb);
    return -((1 - 1 / ratio) * kneeDb * t * t);
  }
  return over > 0 ? -(over * (1 - 1 / ratio)) : 0;
}

class HfCompressor extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.env = new Env(this.p.attack ?? 20, this.p.release ?? 250);
    this.port.onmessage = (e) => {
      this.p = { ...this.p, ...e.data };
      this.env.set(this.p.attack ?? 20, this.p.release ?? 250);
    };
  }
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const makeup = dbToLin(p.makeup ?? 0);
    const mix = p.mix ?? 1;
    // Knee is expressed as a ratio in FFmpeg; convert to dB width.
    const kneeDb = 20 * Math.log10(Math.max(1.0001, p.knee ?? 2.83));
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      for (let n = 0; n < inp.length; n++) {
        const x = inp[n];
        const env = this.env.push(x);
        const envDb = env > 1e-9 ? 20 * Math.log10(env) : -200;
        const g = dbToLin(kneeGain(envDb, p.threshold ?? -24, p.ratio ?? 4, kneeDb));
        out[n] = x * g * makeup * mix + x * (1 - mix);
      }
    }
    return true;
  }
}
registerProcessor("hf-compressor", HfCompressor);

class HfLimiter extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.env = new Env(this.p.attack ?? 5, this.p.release ?? 50);
    this.port.onmessage = (e) => {
      this.p = { ...this.p, ...e.data };
      this.env.set(this.p.attack ?? 5, this.p.release ?? 50);
    };
  }
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const ceiling = dbToLin(this.p.limit ?? -1);
    const outGain = dbToLin(this.p.level_out ?? 0);
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      for (let n = 0; n < inp.length; n++) {
        const x = inp[n];
        const env = this.env.push(x);
        // Only ever attenuate: a limiter that can raise level is a compressor.
        const g = env > ceiling ? ceiling / env : 1;
        out[n] = x * g * outGain;
      }
    }
    return true;
  }
}
registerProcessor("hf-limiter", HfLimiter);

class HfGate extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.env = new Env(this.p.attack ?? 1, this.p.release ?? 100);
    this.gain = 1;
    this.port.onmessage = (e) => {
      this.p = { ...this.p, ...e.data };
      this.env.set(this.p.attack ?? 1, this.p.release ?? 100);
    };
  }
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const threshold = dbToLin(p.threshold ?? -35);
    const floor = dbToLin(p.range ?? -24);
    const ratio = p.ratio ?? 10;
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      for (let n = 0; n < inp.length; n++) {
        const x = inp[n];
        const env = this.env.push(x);
        let target = 1;
        if (env < threshold) {
          const under = env > 1e-9 ? threshold / env : 1e9;
          target = Math.max(floor, 1 / Math.pow(under, ratio - 1));
          if (!isFinite(target)) target = floor;
        }
        // Smooth toward the target so the gate does not click on every sample.
        const c = target < this.gain ? this.env.r : this.env.a;
        this.gain = target + c * (this.gain - target);
        out[n] = x * this.gain;
      }
    }
    return true;
  }
}
registerProcessor("hf-gate", HfGate);

class HfBitcrush extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.hold = 0;
    this.held = [];
    this.port.onmessage = (e) => { this.p = { ...this.p, ...e.data }; };
  }
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const levels = Math.pow(2, (p.bits ?? 8) - 1);
    const step = Math.max(1, Math.round(p.samples ?? 1));
    const mix = p.mix ?? 1;
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      if (this.held[ch] === undefined) this.held[ch] = 0;
      for (let n = 0; n < inp.length; n++) {
        if (this.hold === 0) this.held[ch] = Math.round(inp[n] * levels) / levels;
        out[n] = this.held[ch] * mix + inp[n] * (1 - mix);
        if (ch === i.length - 1) this.hold = (this.hold + 1) % step;
      }
    }
    return true;
  }
}
registerProcessor("hf-bitcrush", HfBitcrush);
`;

let modulePromise: Promise<void> | undefined;

/**
 * Register the processors on a context. Idempotent per module instance, since
 * addModule throws if the same processor name is registered twice.
 */
export function ensureAudioFxWorklets(ctx: BaseAudioContext): Promise<void> {
  modulePromise ??= (async () => {
    if (!ctx.audioWorklet) {
      throw new Error(
        "AudioWorklet is unavailable — the page needs a secure context (https, localhost or file://)",
      );
    }
    // A data: URL rather than a blob:, because a blob inherits the page origin
    // and is treated as opaque on a file:// page, where the module then fails
    // to load with an unhelpful AbortError.
    const url = `data:text/javascript;base64,${btoa(
      String.fromCharCode(...new TextEncoder().encode(AUDIO_FX_WORKLET_SOURCE)),
    )}`;
    await ctx.audioWorklet.addModule(url);
  })();
  return modulePromise;
}

/** Test seam: forget the cached registration so a fresh context can register. */
export function __resetAudioFxWorkletsForTests(): void {
  modulePromise = undefined;
}
