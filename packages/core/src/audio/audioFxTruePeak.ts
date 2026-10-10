/**
 * The `hf-truepeak` AudioWorklet: a lookahead limiter that holds the
 * inter-sample (true) peak under a ceiling in dBTP.
 *
 * A 4x polyphase interpolator estimates the true peak per sample; the excess
 * becomes a required gain. Its minimum over the lookahead window, smoothed by a
 * boxcar of the same length, stays at or below the required gain at every sample,
 * so the ramp is done before the peak leaves the delay line. Release recovers
 * exponentially and only ever lowers the gain further. One gain serves all
 * channels. Latency is lookahead plus the interpolator's group delay: the offline
 * render trims it (`chainLatencySamples`), live preview plays it.
 */

export const TRUE_PEAK_OVERSAMPLE = 4;
/** Group delay of the interpolator, in input samples. */
export const TRUE_PEAK_DETECTOR_DELAY = 16;

const KERNEL_HALF = TRUE_PEAK_OVERSAMPLE * TRUE_PEAK_DETECTOR_DELAY;
/** Taps per polyphase branch: the longest branch of a 2 * KERNEL_HALF + 1 kernel. */
const BRANCH_TAPS = 2 * TRUE_PEAK_DETECTOR_DELAY + 1;

export function truePeakLookaheadSamples(lookaheadMs: number, sampleRate: number): number {
  return Math.max(1, Math.round((lookaheadMs * sampleRate) / 1000));
}

/** Samples between a sample entering the limiter and leaving it. */
export function truePeakLatencySamples(lookaheadMs: number, sampleRate: number): number {
  return truePeakLookaheadSamples(lookaheadMs, sampleRate) + TRUE_PEAK_DETECTOR_DELAY;
}

export const TRUE_PEAK_WORKLET_SOURCE = `
const TP_OS = ${TRUE_PEAK_OVERSAMPLE};
const TP_HALF = ${KERNEL_HALF};
const TP_BRANCH = ${BRANCH_TAPS};
const TP_DELAY = ${TRUE_PEAK_DETECTOR_DELAY};

function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
}

/** Kaiser-windowed sinc, one array per polyphase branch, newest tap first. */
function tpBranches() {
  const beta = 6;
  const norm = besselI0(beta);
  const branches = [];
  for (let p = 0; p < TP_OS; p++) {
    const taps = new Float64Array(TP_BRANCH);
    let sum = 0;
    for (let j = 0; j < TP_BRANCH; j++) {
      const k = p + TP_OS * j;
      if (k > 2 * TP_HALF) continue;
      const t = (k - TP_HALF) / TP_OS;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = (k - TP_HALF) / TP_HALF;
      taps[j] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / norm);
      sum += taps[j];
    }
    // Unity gain at DC on every branch, so a steady level reads as itself.
    for (let j = 0; j < TP_BRANCH; j++) taps[j] /= sum;
    branches.push(taps);
  }
  return branches;
}

class HfTruePeak extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.p = o.processorOptions || {};
    this.look = Math.max(1, Math.round((this.p.lookahead ?? 3) * sampleRate / 1000));
    this.delayLen = this.look + TP_DELAY;
    this.branches = tpBranches();
    this.setLevels();
    this.ch = [];
    this.rel = 1;
    this.dqIdx = new Int32Array(this.look + 2);
    this.dqVal = new Float64Array(this.look + 2);
    this.dqHead = 0;
    this.dqTail = 0;
    this.t = 0;
    this.avgRing = new Float64Array(this.look + 1).fill(1);
    this.avgPos = 0;
    this.avgSum = this.look + 1;
    this.port.onmessage = (e) => {
      if (e.data && e.data.__hfDispose) { this.dead = true; return; }
      this.p = { ...this.p, ...e.data };
      this.setLevels();
    };
  }
  setLevels() {
    this.ceiling = Math.pow(10, (this.p.ceiling ?? -1) / 20);
    this.relCoef = 1 - Math.exp(-1 / (sampleRate * Math.max(1e-4, (this.p.release ?? 80) / 1000)));
  }
  channel(c) {
    if (!this.ch[c]) {
      this.ch[c] = {
        delay: new Float32Array(this.delayLen),
        w: 0,
        hist: new Float32Array(TP_BRANCH * 2),
        pos: 0,
      };
    }
    return this.ch[c];
  }
  /** Largest interpolated magnitude across channels for the newest sample. */
  peak(chans, inputs, n) {
    let peak = 0;
    for (let c = 0; c < chans; c++) {
      const s = this.channel(c);
      const x = inputs[c][n];
      s.pos = (s.pos + 1) % TP_BRANCH;
      s.hist[s.pos] = x;
      s.hist[s.pos + TP_BRANCH] = x;
      const base = s.pos + TP_BRANCH;
      for (let p = 0; p < TP_OS; p++) {
        const taps = this.branches[p];
        let acc = 0;
        for (let j = 0; j < TP_BRANCH; j++) acc += taps[j] * s.hist[base - j];
        const a = acc < 0 ? -acc : acc;
        if (a > peak) peak = a;
      }
    }
    return peak;
  }
  /** Windowed minimum of the required gain over the last look + 1 values. */
  windowMin(v) {
    const cap = this.dqIdx.length;
    while (this.dqTail !== this.dqHead && this.dqVal[(this.dqTail + cap - 1) % cap] >= v) {
      this.dqTail = (this.dqTail + cap - 1) % cap;
    }
    this.dqIdx[this.dqTail] = this.t;
    this.dqVal[this.dqTail] = v;
    this.dqTail = (this.dqTail + 1) % cap;
    while (this.dqIdx[this.dqHead] <= this.t - (this.look + 1)) {
      this.dqHead = (this.dqHead + 1) % cap;
    }
    this.t++;
    return this.dqVal[this.dqHead];
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const i = inputs[0], o = outputs[0];
    if (!i || !i.length) return true;
    const chans = i.length;
    const frames = i[0].length;
    for (let n = 0; n < frames; n++) {
      const peak = this.peak(chans, i, n);
      const need = peak > this.ceiling ? this.ceiling / peak : 1;
      const m = this.windowMin(need);
      this.avgSum += m - this.avgRing[this.avgPos];
      this.avgRing[this.avgPos] = m;
      this.avgPos = (this.avgPos + 1) % this.avgRing.length;
      const target = Math.min(1, this.avgSum / this.avgRing.length);
      const released = this.rel + (1 - this.rel) * this.relCoef;
      this.rel = released < target ? released : target;
      if (target >= 1 && this.rel > 0.9999999) this.rel = 1;
      for (let c = 0; c < chans; c++) {
        const s = this.channel(c);
        o[c][n] = s.delay[s.w] * this.rel;
        s.delay[s.w] = i[c][n];
        s.w = (s.w + 1) % this.delayLen;
      }
    }
    return true;
  }
}
registerProcessor("hf-truepeak", HfTruePeak);
`;
