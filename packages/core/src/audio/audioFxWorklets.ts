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
const AUDIO_FX_WORKLET_SOURCE = `
const dbToLin = (db) => Math.pow(10, db / 20);

/**
 * One-pole envelope followers, one per channel.
 *
 * Per channel matters: the followers advance once per sample, so a single shared
 * follower stepped once per channel per sample. On stereo that ran a 20 ms attack
 * as 10 ms, and gave the right channel a gain computed from an envelope that had
 * already traversed the left — so the two channels ducked by different amounts
 * from the same input and the image pumped.
 */
class EnvBank {
  constructor(attackMs, releaseMs) { this.set(attackMs, releaseMs); this.values = []; }
  set(attackMs, releaseMs) {
    this.a = Math.exp(-1 / (sampleRate * Math.max(1e-5, attackMs / 1000)));
    this.r = Math.exp(-1 / (sampleRate * Math.max(1e-5, releaseMs / 1000)));
  }
  push(ch, x) {
    const prev = this.values[ch] ?? 0;
    const m = Math.abs(x);
    const c = m > prev ? this.a : this.r;
    const next = m + c * (prev - m);
    this.values[ch] = next;
    return next;
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

// log10/exp per sample is the single most expensive thing a dynamics processor
// can do on the audio thread, and every sample below the knee needs neither:
// its gain is exactly unity. Comparing envelopes in the linear domain lets the
// quiet majority of samples skip the transcendentals entirely.
const LN10_OVER_20 = Math.LN10 / 20;
const dbToLinFast = (db) => Math.exp(db * LN10_OVER_20);

class HfCompressor extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.env = new EnvBank(this.p.attack ?? 20, this.p.release ?? 250);
    this.port.onmessage = (e) => {
      if (e.data && e.data.__hfDispose) { this.dead = true; return; }
      this.p = { ...this.p, ...e.data };
      this.env.set(this.p.attack ?? 20, this.p.release ?? 250);
    };
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const makeup = dbToLin(p.makeup ?? 0);
    const mix = p.mix ?? 1;
    // Knee is expressed as a ratio in FFmpeg; convert to dB width.
    const kneeDb = 20 * Math.log10(Math.max(1.0001, p.knee ?? 2.83));
    const thresholdDb = p.threshold ?? -24;
    const ratio = p.ratio ?? 4;
    // Below this the gain computer returns unity, so the sample needs no
    // logarithm at all.
    const kneeStartLin = dbToLin(thresholdDb - kneeDb);
    const dry = 1 - mix;
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      for (let n = 0; n < inp.length; n++) {
        const x = inp[n];
        // Per-channel follower, and the sub-knee shortcut: below the knee the
        // gain is exactly unity, so the sample needs no logarithm at all.
        const env = this.env.push(ch, x);
        if (env <= kneeStartLin) {
          out[n] = x * makeup * mix + x * dry;
          continue;
        }
        const envDb = 20 * Math.log10(env);
        const g = dbToLinFast(kneeGain(envDb, thresholdDb, ratio, kneeDb));
        out[n] = x * g * makeup * mix + x * dry;
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
    this.env = new EnvBank(this.p.attack ?? 5, this.p.release ?? 50);
    this.port.onmessage = (e) => {
      if (e.data && e.data.__hfDispose) { this.dead = true; return; }
      this.p = { ...this.p, ...e.data };
      this.env.set(this.p.attack ?? 5, this.p.release ?? 50);
    };
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const ceiling = dbToLin(this.p.limit ?? -1);
    const outGain = dbToLin(this.p.level_out ?? 0);
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      for (let n = 0; n < inp.length; n++) {
        const x = inp[n];
        const env = this.env.push(ch, x);
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
    this.env = new EnvBank(this.p.attack ?? 1, this.p.release ?? 100);
    this.gains = [];
    this.port.onmessage = (e) => {
      if (e.data && e.data.__hfDispose) { this.dead = true; return; }
      this.p = { ...this.p, ...e.data };
      this.env.set(this.p.attack ?? 1, this.p.release ?? 100);
    };
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const threshold = dbToLin(p.threshold ?? -35);
    const floor = dbToLin(p.range ?? -24);
    const ratio = p.ratio ?? 10;
    // Knee is declared in the registry as a ratio, like the compressor's; a
    // hard threshold ignored it and chattered on material sitting right at the
    // gate point.
    const kneeDb = 20 * Math.log10(Math.max(1.0001, p.knee ?? 2.83));
    const kneeLin = dbToLin((p.threshold ?? -35) + kneeDb);
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      for (let n = 0; n < inp.length; n++) {
        const x = inp[n];
        const env = this.env.push(ch, x);
        let target = 1;
        // Above the threshold the gate is fully open; skip the pow entirely.
        if (env < threshold) {
          const under = env > 1e-9 ? threshold / env : 1e9;
          target = Math.max(floor, 1 / Math.pow(under, ratio - 1));
          if (!isFinite(target)) target = floor;
        }
        // Smooth toward the target so the gate does not click on every sample.
        const held = this.gains[ch] ?? 1;
        const c = target < held ? this.env.r : this.env.a;
        const smoothed = target + c * (held - target);
        this.gains[ch] = smoothed;
        out[n] = x * smoothed;
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
    this.holds = [];
    this.held = [];
    this.port.onmessage = (e) => {
      if (e.data && e.data.__hfDispose) { this.dead = true; return; }
      this.p = { ...this.p, ...e.data };
    };
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const levels = Math.pow(2, (p.bits ?? 8) - 1);
    const step = Math.max(1, Math.round(p.samples ?? 1));
    const mix = p.mix ?? 1;
    for (let ch = 0; ch < i.length; ch++) {
      const inp = i[ch], out = o[ch];
      if (this.held[ch] === undefined) this.held[ch] = 0;
      if (this.holds[ch] === undefined) this.holds[ch] = 0;
      for (let n = 0; n < inp.length; n++) {
        // Per channel: advancing one shared counter only on the last channel
        // left every earlier channel either unheld or frozen for a whole
        // 128-sample quantum, clicking once a block.
        if (this.holds[ch] === 0) this.held[ch] = Math.round(inp[n] * levels) / levels;
        out[n] = this.held[ch] * mix + inp[n] * (1 - mix);
        this.holds[ch] = (this.holds[ch] + 1) % step;
      }
    }
    return true;
  }
}
registerProcessor("hf-bitcrush", HfBitcrush);

/** Linear-interpolated read, \`delaySamples\` behind the write head. */
function readTap(ring, write, delaySamples) {
  const len = ring.length;
  const pos = (write - 1 - delaySamples + len) % len;
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  const i1 = (i0 + 1) % len;
  return ring[i0] * (1 - frac) + ring[i1] * frac;
}

/** Equal-power-ish crossfade, zero at a tap's reset point — hides the splice. */
function xfade(phase) {
  return Math.sin(Math.PI * phase);
}

/**
 * Dual-tap granular delay line: two read taps 180° apart in a 100 ms grain,
 * each sweeping at a speed relative to the write head that shifts pitch
 * without changing duration. One tap is always fading in as the other fades
 * out, which hides the splice each tap makes when it wraps.
 *
 * write/phase are block-level state, advanced once per SAMPLE across all
 * channels together (not once per channel) — advancing them inside the
 * per-channel loop would move the tap 2x/4x too fast on a stereo/quad input.
 */
class HfPitchshift extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.grain = Math.round(sampleRate * 0.1);
    this.buf = [];
    this.write = 0;
    this.phase = 0;
    // Samples written so far, capped at one grain. The taps read up to a grain
    // behind the write head, so until this fills they would read the ring's
    // zeros — the head of every clip came out attenuated or silent.
    this.filled = 0;
    // How much of the wet (pitch-shifted) path is currently in the output, and
    // where it is heading. Crossing between dry and wet is a ~50 ms jump in the
    // signal, so it is RAMPED rather than switched: a hard swap either way is a
    // click. Ramping in both directions is also what lets a node return to true
    // bypass at semitones 0 — a one-way latch left preview stuck with the delay
    // that the render, building a fresh node from the attribute, does not have.
    this.wet = 0;
    this.wetTarget = 0;
    // ~15 ms one-pole, short enough to feel immediate on a slider drag and long
    // enough that the splice is inaudible.
    this.wetCoef = Math.exp(-1 / (sampleRate * 0.015));
    this.port.onmessage = (e) => {
      if (e.data && e.data.__hfDispose) { this.dead = true; return; }
      this.p = { ...this.p, ...e.data };
    };
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const p = this.p;
    const semitones = Math.max(-12, Math.min(12, p.semitones ?? 0));
    const mix = Math.max(0, Math.min(1, p.mix ?? 1));
    const grain = this.grain;
    const ringLen = grain * 2;
    const n = i[0] ? i[0].length : 0;
    for (let ch = 0; ch < i.length; ch++) {
      if (!this.buf[ch]) this.buf[ch] = new Float32Array(ringLen);
    }

    // Nothing to shift, or mixed fully out. The grain delay is ~grain/2
    // whatever the ratio, so at semitones=0 this degenerated into a pure 50 ms
    // delay of the signal — while the copy for that exact setting reads
    // "Unchanged pitch".
    this.wetTarget = semitones === 0 ? 0 : mix;

    // Fully dry AND settled: take the cheap transparent path. The ring keeps
    // filling, so a later shift does not start cold.
    if (this.wetTarget === 0 && this.wet < 1e-4) {
      this.wet = 0;
      let w = this.write;
      for (let s = 0; s < n; s++) {
        for (let ch = 0; ch < i.length; ch++) {
          const x = i[ch][s];
          this.buf[ch][w] = x;
          o[ch][s] = x;
        }
        w = (w + 1) % ringLen;
      }
      this.write = w;
      this.filled = Math.min(grain, this.filled + n);
      return true;
    }

    const ratio = Math.pow(2, semitones / 12);
    const inc = (1 - ratio) / grain;
    let write = this.write, phase = this.phase, filled = this.filled, wetNow = this.wet;
    const target = this.wetTarget, coef = this.wetCoef;
    for (let s = 0; s < n; s++) {
      phase += inc;
      phase -= Math.floor(phase);
      const phaseB = (phase + 0.5) % 1;
      const gA = xfade(phase), gB = xfade(phaseB);
      // Ramp the wet path in as the ring fills rather than reading zeros:
      // 100 ms of unshifted audio at the head of a clip beats 50 ms of silence.
      const warm = filled >= grain ? 1 : filled / grain;
      wetNow = target + coef * (wetNow - target);
      const wetMix = wetNow * warm;
      for (let ch = 0; ch < i.length; ch++) {
        const ring = this.buf[ch];
        const inp = i[ch], out = o[ch];
        const x = inp[s];
        ring[write] = x;
        const wet =
          readTap(ring, write, phase * grain) * gA + readTap(ring, write, phaseB * grain) * gB;
        out[s] = x * (1 - wetMix) + wet * wetMix;
      }
      write = (write + 1) % ringLen;
      if (filled < grain) filled++;
    }
    this.write = write;
    this.phase = phase;
    this.filled = filled;
    this.wet = wetNow;
    return true;
  }
}
registerProcessor("hf-pitchshift", HfPitchshift);
`;

// Registration is per context, not per module: a processor registered on one
// AudioContext does not exist on another, so caching a single promise made
// every context after the first believe it was ready when it was not.
const registered = new WeakMap<BaseAudioContext, Promise<void>>();

/** True once the processors are usable on this context. */
export function audioFxWorkletsReady(ctx: BaseAudioContext): boolean {
  return readyContexts.has(ctx);
}
const readyContexts = new WeakSet<BaseAudioContext>();

/**
 * Register the processors on a context. Idempotent per context, since
 * addModule throws if the same processor name is registered twice.
 */
export function ensureAudioFxWorklets(ctx: BaseAudioContext): Promise<void> {
  let modulePromise = registered.get(ctx);
  if (!modulePromise) {
    modulePromise = (async () => {
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
      readyContexts.add(ctx);
    })().catch((err: unknown) => {
      // A failed registration must not be remembered. `readyContexts` is only
      // written on success, so callers correctly keep asking — and every ask
      // replayed this same rejected promise, leaving the limiter, compressor,
      // gate and bitcrush silent for the life of the context with no way back.
      // One transient failure (a slow module load, a context still warming up)
      // permanently disabled half the rack.
      registered.delete(ctx);
      throw err;
    });
    registered.set(ctx, modulePromise);
  }
  return modulePromise;
}
