/**
 * Builds the Web Audio graph for an FX chain, one builder per `web` id in the
 * core registry.
 *
 * Every node exposes `update`, so turning a dial re-parameterises the running
 * graph instead of rebuilding it. That is the whole point of previewing in the
 * browser: an AudioParam change lands on the next 128-sample render quantum,
 * about 2.7 ms at 48 kHz, so the knob-to-ear loop is immediate.
 */

import {
  enabledAudioFxNodes,
  getAudioFxDef,
  normalizeAudioFxParams,
  type HfAudioFxChain,
  type HfAudioFxNode,
  type HfAudioFxParamValues,
} from "../audioFx.js";
import { audioFxWorkletsReady, ensureAudioFxWorklets } from "./audioFxWorklets.js";

/**
 * Deterministic reverb impulse, shared by both engines so the browser and the
 * render convolve the identical response. Exponentially-decaying noise with a
 * one-pole lowpass standing in for air absorption; the PRNG is seeded from the
 * parameters so the same room always produces the same tail.
 */
export function synthesizeReverbImpulse(
  sampleRate: number,
  size: number,
  damping: number,
): Float32Array {
  const seconds = 0.6 + Math.max(0, Math.min(1, size)) * 2.6;
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(length);
  // Seed from the parameters: same room, same tail, on every machine.
  let seed = (Math.round(size * 1000) * 2654435761 + Math.round(damping * 1000) * 40503) >>> 0;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const cutoff = Math.max(0.001, 1 - Math.max(0, Math.min(1, damping)));
  let lp = 0;
  let energy = 0;
  for (let i = 0; i < length; i++) {
    lp += cutoff * (rand() - lp);
    const sample = lp * Math.pow(1 - i / length, 2.5);
    out[i] = sample;
    energy += sample * sample;
  }
  // Scale to unit energy. A ConvolverNode applies the impulse's gain whole (the
  // graph sets `normalize = false` so the room is deterministic rather than
  // browser-defined), and this impulse is decaying noise whose raw energy runs
  // to +33 dB at the default size — loud enough that simply adding a Reverb
  // clipped the mix. Normalising here keeps the wet knob meaning what it says
  // and keeps preview and render identical, since both convolve this buffer.
  const norm = Math.sqrt(energy);
  if (norm > 0) {
    for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) / norm;
  }
  return out;
}

/**
 * Where an automation lane writes when it drives one knob.
 *
 * A knob is not always one AudioParam. A wet/dry mix is two gains moving in
 * opposition, and a knob in milliseconds drives a delay time in seconds, so
 * each target carries its own mapping out of the knob's declared unit.
 */
export interface FxParamTarget {
  param: AudioParam;
  map?: (value: number) => number;
}

export interface FxNodeHandle {
  input: AudioNode;
  output: AudioNode;
  update(params: HfAudioFxParamValues): void;
  /**
   * AudioParams behind the knobs the registry marks `automatable`, keyed by
   * parameter key. Absent for a node whose values cannot be scheduled.
   */
  automation?: Record<string, FxParamTarget[]>;
  dispose(): void;
}

/**
 * `elapsed` is the clip-relative time, in seconds, the graph is being built at.
 *
 * Zero for the render, which always starts a clip's audio from its first sample,
 * and zero for a preview attached before playback. It is non-zero in the one case
 * that used to be wrong: preview rebuilding the graph mid-play — a seek, a scrub,
 * or any structural edit — where an LFO restarting from phase 0 made preview
 * disagree with the render, and with itself across an edit.
 */
type Builder = (ctx: BaseAudioContext, p: HfAudioFxParamValues, elapsed: number) => FxNodeHandle;

const n = (v: number | string | undefined): number => (typeof v === "number" ? v : Number(v ?? 0));

/** Milliseconds on the knob, seconds on the AudioParam. */
const msToSec = (v: number): number => v / 1000;

/**
 * An LFO with a settable phase.
 *
 * An OscillatorNode cannot have one: its phase is zero at `start()`, and
 * `start(when)` clamps a past `when` to now. So the modulator is one cycle of the
 * waveform in a looping buffer instead, where `start(when, offset)` *is* a phase
 * control.
 *
 * The buffer holds exactly one second, so it plays at 1 Hz at the default rate
 * and `playbackRate` reads directly in Hz — which is what the `speed` knob is in,
 * and what an automation lane aimed at it writes, so neither needs a mapping.
 *
 * Phase is taken as `elapsed × speed`, which is exact for the constant speed this
 * is built with. A lane that sweeps `speed` advances the real phase by its
 * integral, so a graph rebuilt mid-sweep resumes fractionally off — smaller than
 * the whole-cycle error this replaces, and not worth integrating a curve for.
 */
function lfoSource(
  ctx: BaseAudioContext,
  wave: "sine" | "triangle",
  speed: number,
  elapsed: number,
): AudioBufferSourceNode {
  const length = Math.max(1, Math.round(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const cycle = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const phase = i / length;
    // Both start at zero and rise, the convention an OscillatorNode uses, so a
    // render — which builds at elapsed 0 — is unmoved by this change.
    cycle[i] =
      wave === "sine"
        ? Math.sin(2 * Math.PI * phase)
        : 4 * Math.abs(((phase + 0.75) % 1) - 0.5) - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = speed;
  // A negative `offset` throws, and `elapsed` is only trusted to be a number.
  const offset = ((((elapsed * speed) % 1) + 1) % 1) * (length / ctx.sampleRate);
  src.start(typeof ctx.currentTime === "number" ? ctx.currentTime : 0, offset);
  return src;
}

/**
 * Retire an LFO: stopped *and* unwired.
 *
 * Both halves. The old oscillators were stopped and left in their builder's
 * dispose list — so every chain rebuild that dropped a chorus or a phaser left a
 * modulator still connected to the delay or the allpass bank it had been
 * driving. Nothing audible came out of it, because the shell around it was
 * disconnected, but the nodes stayed reachable and a session of edits to a
 * modulated track accumulated them. Same shape as the worklet leak above.
 */
function retireLfo(src: AudioBufferSourceNode): void {
  try {
    src.stop();
  } catch {
    /* already stopped */
  }
  src.disconnect();
}

/** A wet/dry pair: the dry side is whatever the wet side is not. */
function mixTargets(wet: AudioParam, dry: AudioParam): FxParamTarget[] {
  return [{ param: wet }, { param: dry, map: (v) => 1 - v }];
}

/** Linear crossfade: dry falls as wet rises, in lockstep. */
function setWetDryMix(wet: GainNode, dry: GainNode, mix: number): void {
  wet.gain.value = mix;
  dry.gain.value = 1 - mix;
}

/** A node that is its own input and output and has nothing to tear down. */
function simple(
  node: AudioNode,
  update: (p: HfAudioFxParamValues) => void,
  automation?: Record<string, FxParamTarget[]>,
): FxNodeHandle {
  return { input: node, output: node, update, automation, dispose: () => node.disconnect() };
}

/**
 * Filter types whose Q a BiquadFilterNode actually reads. The spec leaves it
 * unused for shelving filters, so the registry offers no shelf Q and the graph
 * must expose none either — the exposure invariant would otherwise advertise an
 * AudioParam for a knob nobody can set.
 */
const USES_Q: ReadonlySet<BiquadFilterType> = new Set(["peaking", "highpass", "lowpass"]);

/** dB on the knob, a linear multiplier on the AudioParam. */
const dbToLinear = (db: number): number => Math.pow(10, db / 20);

/**
 * A plain level stage.
 *
 * Every other gain in the registry sits on a BiquadFilterNode, whose `gain`
 * param is already in dB. A GainNode's is a linear multiplier, so both the
 * initial value and anything an automation lane schedules have to be converted —
 * which is what `FxParamTarget.map` is for.
 */
const gainStage: Builder = (ctx, p) => {
  const g = ctx.createGain();
  const apply = (v: HfAudioFxParamValues): void => {
    g.gain.value = dbToLinear(n(v.gain));
  };
  apply(p);
  return simple(g, apply, { gain: [{ param: g.gain, map: dbToLinear }] });
};

function biquad(type: BiquadFilterType, useGain: boolean): Builder {
  return (ctx, p) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    const apply = (v: HfAudioFxParamValues): void => {
      f.frequency.value = n(v.frequency);
      if (v.q !== undefined) f.Q.value = n(v.q);
      if (useGain) f.gain.value = n(v.gain);
    };
    apply(p);
    return simple(f, apply, {
      frequency: [{ param: f.frequency }],
      ...(USES_Q.has(type) ? { q: [{ param: f.Q }] } : {}),
      ...(useGain ? { gain: [{ param: f.gain }] } : {}),
    });
  };
}

/**
 * FFmpeg's highpass/lowpass take a pole count; Web Audio's biquad is always
 * two-pole, so one-pole is built from raw coefficients via IIRFilterNode.
 * Changing the pole count changes the node type, so the chain rebuilds rather
 * than updates — handled by the caller comparing structural signatures.
 */
function onePoleBuilder(kind: "highpass" | "lowpass"): Builder {
  return (ctx, p) => {
    const k = Math.tan((Math.PI * n(p.frequency)) / ctx.sampleRate);
    const node =
      kind === "highpass"
        ? ctx.createIIRFilter([1 / (1 + k), -1 / (1 + k)], [1, (k - 1) / (k + 1)])
        : ctx.createIIRFilter([k / (1 + k), k / (1 + k)], [1, (k - 1) / (k + 1)]);
    // IIRFilterNode coefficients are immutable; the caller rebuilds on change.
    // Nothing here is schedulable either, so a frequency lane on a one-pole
    // filter has nowhere to write — the scheduler skips what is not exposed.
    return simple(node, () => {});
  };
}

function workletBuilder(processor: string): Builder {
  return (ctx, p) => {
    const node = new AudioWorkletNode(ctx, processor, { processorOptions: { ...p } });
    return {
      input: node,
      output: node,
      update: (v) => node.port.postMessage({ ...v }),
      dispose: () => {
        // Disconnecting is not enough to retire an AudioWorkletProcessor: it
        // lives until its `process()` returns false, and these all returned
        // true unconditionally. So every chain rebuild that dropped a limiter,
        // compressor, gate or bitcrush left it running on the audio thread for
        // the rest of the session, and a few edits to a carved bed accumulated
        // a stack of them. The processors treat this message as their cue to
        // stop.
        node.port.postMessage({ __hfDispose: true });
        node.disconnect();
      },
    };
  };
}

/** Curves matching asoftclip's shapes, sampled once per parameter change. */
const CURVES: Record<string, (x: number) => number> = {
  tanh: Math.tanh,
  atan: (x) => (2 / Math.PI) * Math.atan((Math.PI / 2) * x),
  cubic: (x) => (Math.abs(x) >= 1 ? Math.sign(x) : x - x ** 3 / 3),
  exp: (x) => Math.sign(x) * (1 - Math.exp(-Math.abs(x))),
  alg: (x) => x / Math.sqrt(1 + x * x),
  quintic: (x) => (Math.abs(x) >= 1 ? Math.sign(x) : x - x ** 5 / 5),
  sin: (x) => (Math.abs(x) >= 1 ? Math.sign(x) : Math.sin((Math.PI / 2) * x)),
  erf: (x) => Math.tanh(1.20211 * x),
  hard: (x) => Math.max(-1, Math.min(1, x)),
};

const waveshaper: Builder = (ctx, p) => {
  const ws = ctx.createWaveShaper();
  const preGain = ctx.createGain();
  const postGain = ctx.createGain();
  preGain.connect(ws).connect(postGain);
  const apply = (v: HfAudioFxParamValues): void => {
    const shape = CURVES[String(v.type)] ?? Math.tanh;
    const threshold = Math.pow(10, n(v.threshold) / 20);
    const SIZE = 8192;
    const curve = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      const x = (i / (SIZE - 1)) * 2 - 1;
      curve[i] = shape(x / Math.max(1e-6, threshold)) * threshold;
    }
    ws.curve = curve;
    ws.oversample = n(v.oversample) >= 4 ? "4x" : n(v.oversample) >= 2 ? "2x" : "none";
    postGain.gain.value = Math.pow(10, n(v.output) / 20);
  };
  apply(p);
  return {
    input: preGain,
    output: postGain,
    update: apply,
    // The curve itself is rebuilt wholesale, but the make-up gain after it is
    // an ordinary AudioParam.
    automation: { output: [{ param: postGain.gain, map: (v) => Math.pow(10, v / 20) }] },
    dispose: () => {
      preGain.disconnect();
      ws.disconnect();
      postGain.disconnect();
    },
  };
};

const delayFeedback: Builder = (ctx, p) => {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const dl = ctx.createDelay(5);
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  input.connect(dl);
  dl.connect(fb);
  fb.connect(dl);
  dl.connect(wet).connect(out);
  input.connect(dry).connect(out);
  const apply = (v: HfAudioFxParamValues): void => {
    dl.delayTime.value = Math.min(5, n(v.time) / 1000);
    fb.gain.value = n(v.feedback);
    setWetDryMix(wet, dry, n(v.mix));
  };
  apply(p);
  return {
    input,
    output: out,
    update: apply,
    automation: {
      time: [{ param: dl.delayTime, map: (v) => Math.min(5, msToSec(v)) }],
      feedback: [{ param: fb.gain }],
      mix: mixTargets(wet.gain, dry.gain),
    },
    dispose: () => [input, out, dl, fb, wet, dry].forEach((x) => x.disconnect()),
  };
};

const chorusLfo: Builder = (ctx, p, elapsed) => {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const dl = ctx.createDelay(0.5);
  const lfo = lfoSource(ctx, "sine", n(p.speed), elapsed);
  const depth = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  lfo.connect(depth).connect(dl.delayTime);
  input.connect(dl).connect(wet).connect(out);
  input.connect(dry).connect(out);
  const apply = (v: HfAudioFxParamValues): void => {
    dl.delayTime.value = n(v.delay) / 1000;
    depth.gain.value = n(v.depth) / 1000;
    lfo.playbackRate.value = n(v.speed);
    setWetDryMix(wet, dry, n(v.mix));
  };
  apply(p);
  return {
    input,
    output: out,
    update: apply,
    automation: {
      delay: [{ param: dl.delayTime, map: msToSec }],
      depth: [{ param: depth.gain, map: msToSec }],
      // One second of waveform, so the rate is the frequency in Hz the knob names.
      speed: [{ param: lfo.playbackRate }],
      mix: mixTargets(wet.gain, dry.gain),
    },
    dispose: () => {
      retireLfo(lfo);
      [input, out, dl, depth, wet, dry].forEach((x) => x.disconnect());
    },
  };
};

const PHASER_STAGES = 6;

const allpassPhaser: Builder = (ctx, p, elapsed) => {
  const input = ctx.createGain();
  const out = ctx.createGain();
  // aphaser's in_gain/out_gain trim the signal entering and leaving the effect.
  // Wiring them to the wet and dry legs instead made "Input" mute the dry path
  // and let the two defaults sum above unity, so inserting a phaser raised the
  // track level.
  const inTrim = ctx.createGain();
  const outTrim = ctx.createGain();
  // aphaser's type 0 is triangular, 1 sinusoidal. The builder once left this
  // unset, so the declared default ("Triangular") was silently a sine. The
  // waveform is baked into the LFO's buffer, so switching it is a shape change
  // that rebuilds the chain rather than a value pushed into the running graph —
  // see `shapeOf`.
  const lfo = lfoSource(ctx, String(p.type) === "1" ? "sine" : "triangle", n(p.speed), elapsed);
  const depth = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const stages: BiquadFilterNode[] = [];
  input.connect(inTrim);
  let node: AudioNode = inTrim;
  for (let i = 0; i < PHASER_STAGES; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = "allpass";
    ap.Q.value = 0.7071;
    depth.connect(ap.frequency);
    node.connect(ap);
    node = ap;
    stages.push(ap);
  }
  lfo.connect(depth);
  node.connect(wet).connect(outTrim);
  inTrim.connect(dry).connect(outTrim);
  outTrim.connect(out);
  const apply = (v: HfAudioFxParamValues): void => {
    // aphaser sweeps around a centre derived from its delay; mirror the range
    // rather than the exact curve, and let the parity harness score it.
    const centre = 1000 / Math.max(0.1, n(v.delay));
    for (const ap of stages) ap.frequency.value = centre;
    depth.gain.value = centre * n(v.decay);
    lfo.playbackRate.value = n(v.speed);
    inTrim.gain.value = n(v.in_gain);
    outTrim.gain.value = n(v.out_gain);
    // Summed at unity: the sweep is the effect, not a blend control.
    wet.gain.value = 1;
    dry.gain.value = 1;
  };
  apply(p);
  return {
    input,
    output: out,
    update: apply,
    // `delay` and `decay` set the sweep centre, which feeds every stage's
    // frequency at once — not one knob, one param — so they stay unautomated.
    automation: {
      speed: [{ param: lfo.playbackRate }],
      // The trims, not wet/dry. apply() drives inTrim/outTrim from these knobs
      // and pins wet and dry to 1 — so a lane aimed at wet/dry modulated a
      // constant and left the trim frozen, and the next values-only edit slammed
      // it back over the running envelope. The comment above records that this
      // wiring was already moved once; the automation map was missed.
      in_gain: [{ param: inTrim.gain }],
      out_gain: [{ param: outTrim.gain }],
    },
    dispose: () => {
      retireLfo(lfo);
      [input, out, inTrim, outTrim, depth, wet, dry, ...stages].forEach((x) => x.disconnect());
    },
  };
};

const convolver: Builder = (ctx, p) => {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const conv = ctx.createConvolver();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  conv.normalize = false;
  input.connect(conv).connect(wet).connect(out);
  input.connect(dry).connect(out);
  let lastKey = "";
  const apply = (v: HfAudioFxParamValues): void => {
    const key = `${n(v.size)}:${n(v.damping)}`;
    if (key !== lastKey) {
      // Same generator the render uses, so both convolve the identical tail.
      const ir = synthesizeReverbImpulse(ctx.sampleRate, n(v.size), n(v.damping));
      const buf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
      buf.getChannelData(0).set(ir);
      conv.buffer = buf;
      lastKey = key;
    }
    wet.gain.value = n(v.wet);
    dry.gain.value = n(v.dry);
  };
  apply(p);
  return {
    input,
    output: out,
    update: apply,
    // Size and damping regenerate the impulse response, so only the wet/dry
    // balance is schedulable.
    automation: { wet: [{ param: wet.gain }], dry: [{ param: dry.gain }] },
    dispose: () => [input, out, conv, wet, dry].forEach((x) => x.disconnect()),
  };
};

const BUILDERS: Record<string, Builder> = {
  "gain-node": gainStage,
  "biquad-peaking": biquad("peaking", true),
  "biquad-lowshelf": biquad("lowshelf", true),
  "biquad-highshelf": biquad("highshelf", true),
  "biquad-highpass": biquad("highpass", false),
  "biquad-lowpass": biquad("lowpass", false),
  "worklet-compressor": workletBuilder("hf-compressor"),
  "worklet-limiter": workletBuilder("hf-limiter"),
  "worklet-gate": workletBuilder("hf-gate"),
  "worklet-bitcrush": workletBuilder("hf-bitcrush"),
  "worklet-pitchshift": workletBuilder("hf-pitchshift"),
  waveshaper,
  "delay-feedback": delayFeedback,
  "chorus-lfo": chorusLfo,
  "allpass-phaser": allpassPhaser,
  convolver,
};

/** Effect ids whose Web Audio node needs a worklet module registered first. */
export function chainNeedsWorklets(chain: HfAudioFxChain): boolean {
  return chain.nodes.some((node) => getAudioFxDef(node.type)?.web.startsWith("worklet-") ?? false);
}

export function buildFxNode(
  ctx: BaseAudioContext,
  type: string,
  params: HfAudioFxParamValues,
  elapsed = 0,
): FxNodeHandle {
  const def = getAudioFxDef(type);
  if (!def) throw new Error(`Unknown effect type: ${type}`);
  const resolved = normalizeAudioFxParams(type, params);
  // One-pole is a different node type, not a different parameter value.
  if ((type === "highpass" || type === "lowpass") && String(resolved.poles) === "1") {
    return onePoleBuilder(type)(ctx, resolved, elapsed);
  }
  const builder = BUILDERS[def.web];
  if (!builder) throw new Error(`No Web Audio builder for ${def.web}`);
  return builder(ctx, resolved, elapsed);
}

export interface FxChainHandle {
  input: AudioNode;
  output: AudioNode;
  /** Built effects in chain order, carrying the node ids lanes address. */
  nodes: { id?: string; type: string; handle: FxNodeHandle }[];
  /**
   * The wet/dry blend around each preset run, by preset id — where a
   * whole-preset lane writes. Two gains in opposition, the same shape
   * `mixTargets` builds for an effect's own mix knob.
   */
  presets: Record<string, FxParamTarget[]>;
  /** Re-parameterise in place when the shape is unchanged; false if a rebuild is needed. */
  update(chain: HfAudioFxChain): boolean;
  dispose(): void;
}

/**
 * Consecutive nodes grouped by the preset that wrote them.
 *
 * `amount` comes off the nodes themselves — a preset is bypassed by setting its
 * members' `enabled` to false everywhere else in the codebase, and the wrap has
 * to agree with that or the switch and the lane would fight. Absent means fully
 * applied, which is what every chain written before this shipped means.
 */
function presetRuns(
  nodes: readonly HfAudioFxNode[],
): { preset?: string; amount: number; nodes: HfAudioFxNode[] }[] {
  const out: { preset?: string; amount: number; nodes: HfAudioFxNode[] }[] = [];
  for (const node of nodes) {
    const preset = node.fromPreset;
    const last = out.at(-1);
    if (last && last.preset === preset) last.nodes.push(node);
    else {
      const amount = typeof node.presetAmount === "number" ? node.presetAmount : 1;
      out.push({
        ...(preset ? { preset } : {}),
        amount: Math.min(1, Math.max(0, amount)),
        nodes: [node],
      });
    }
  }
  return out;
}

/**
 * A signature of everything that changes the graph's *shape* rather than its
 * parameter values. When this is unchanged an update can just push new values
 * into the running nodes; when it changes, the caller rebuilds.
 */
function shapeOf(chain: HfAudioFxChain): string {
  return enabledAudioFxNodes(chain)
    .map((node) => {
      const p = normalizeAudioFxParams(node.type, node.params);
      const poles = p.poles !== undefined ? `:${p.poles}` : "";
      // A one-pole filter is an IIRFilterNode whose coefficients are fixed at
      // construction, so its cutoff cannot be pushed into the running graph.
      // Carrying the frequency here makes a cutoff change rebuild instead of
      // being pushed into a no-op updater — which is what let preview keep
      // filtering at the old frequency while the render used the new one.
      const fixedFreq = String(p.poles) === "1" ? `@${p.frequency}` : "";
      // The phaser's LFO waveform is baked into a buffer at construction, for the
      // same reason: pushed into the running graph it would be a no-op, and
      // preview would keep sweeping on a triangle while the render used a sine.
      const wave = node.type === "phaser" ? `~${p.type}` : "";
      // Which preset run this node belongs to, for the same reason again: the
      // wet/dry wrap is WIRED around a run at construction, so moving a node
      // across a preset boundary changes the graph's shape even when the type
      // sequence is identical. Without this, reordering a hand-added peaking
      // filter past a preset's peaking filter kept the in-place update path and
      // left the wrap bracketing the wrong effect — preview blending out the
      // author's own node while the render, which rebuilds, blended out the
      // preset's.
      const run = node.fromPreset ? `%${node.fromPreset}` : "";
      return `${node.type}${poles}${fixedFreq}${wave}${run}`;
    })
    .join("|");
}

/**
 * Build the whole chain in series. Returns a handle whose `input`/`output` can
 * be spliced into any graph; an empty chain yields a pass-through.
 *
 * `elapsed` is where in the clip this is being built — see `Builder`. It only
 * reaches the modulated effects, and only matters when the graph is built after
 * the audio has already started.
 */
export function buildFxChain(
  ctx: BaseAudioContext,
  chain: HfAudioFxChain,
  elapsed = 0,
): FxChainHandle {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const handles: { id?: string; type: string; handle: FxNodeHandle }[] = [];
  const presets: { id: string; entry: GainNode; wet: GainNode; dry: GainNode; join: GainNode }[] =
    [];

  /**
   * A preset's consecutive nodes, wrapped in a wet/dry pair.
   *
   * The rest of the chain is a strict series, which is right for an effect the
   * author placed: it is either in the path or it is not. A preset is not one
   * effect, though — it is several the author added as a unit, and "how much of
   * it is applied" is a question about the unit. Its nodes share no automatable
   * parameter, and the worklet ones expose no AudioParams at all, so there is
   * nothing to aim a lane at node-by-node. One crossfade around the run is the
   * whole answer, and it cannot go half-wrong the way seven lanes can.
   *
   * Consecutive only, matching what the rack brackets: a preset pulled apart by
   * a reorder is no longer a unit, and wrapping across the gap would route the
   * effect between its members through the dry leg too.
   */
  const runs = presetRuns(enabledAudioFxNodes(chain));

  let tail: AudioNode = input;
  for (const run of runs) {
    let wrap: { entry: GainNode; wet: GainNode; dry: GainNode; join: GainNode } | null = null;
    if (run.preset) {
      const entry = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const join = ctx.createGain();
      wet.gain.value = run.amount;
      dry.gain.value = 1 - run.amount;
      tail.connect(entry);
      // The dry leg bridges the whole run: it leaves before the first effect and
      // rejoins after the last, which is what makes amount 0 the untouched
      // signal rather than a quieter version of the processed one.
      entry.connect(dry).connect(join);
      wrap = { entry, wet, dry, join };
      tail = entry;
    }
    for (const node of run.nodes) {
      const handle = buildFxNode(ctx, node.type, node.params ?? {}, elapsed);
      tail.connect(handle.input);
      tail = handle.output;
      handles.push({ ...(node.id ? { id: node.id } : {}), type: node.type, handle });
    }
    if (wrap && run.preset) {
      tail.connect(wrap.wet).connect(wrap.join);
      presets.push({ id: run.preset, ...wrap });
      tail = wrap.join;
    }
  }
  tail.connect(output);

  const shape = shapeOf(chain);

  // Accumulated, not assigned. A preset pulled apart by a reorder occupies more
  // than one run, and each run gets its own wrap — keying by id and assigning
  // dropped every wrap but the last, so a whole-preset lane drove one fragment
  // and left the rest at full strength while the switch read "Off".
  const presetTargets: Record<string, FxParamTarget[]> = {};
  for (const p of presets) {
    (presetTargets[p.id] ??= []).push(...mixTargets(p.wet.gain, p.dry.gain));
  }
  return {
    input,
    output,
    presets: presetTargets,
    nodes: handles,
    update(next) {
      if (shapeOf(next) !== shape) return false;
      enabledAudioFxNodes(next).forEach((node, i) => {
        const held = handles[i];
        if (!held) return;
        held.handle.update(normalizeAudioFxParams(node.type, node.params));
        // The id follows the position, because the params just did. Reordering
        // two effects of the same type leaves the shape identical, so the graph
        // is updated in place — but a lane addresses its effect BY id, and an id
        // captured at build time then names whichever effect used to be here.
        // The scheduler would drive `fx.n2.frequency` into the band that is now
        // n1: exactly what HfAudioFxNode.id documents itself as preventing.
        if (node.id === undefined) delete held.id;
        else held.id = node.id;
      });
      // The blend is a value like any other: switching a preset off writes
      // `presetAmount`, and pushing it into the running graph is what keeps that
      // from being a rebuild — and from restarting the audio underneath it.
      // Walked in step with the build, not looked up by id: `find` returned the
      // first wrap for every run sharing a preset id, so a split preset wrote
      // one wrap twice and never touched the other.
      let wrapIndex = 0;
      for (const run of presetRuns(enabledAudioFxNodes(next))) {
        if (!run.preset) continue;
        const wrap = presets[wrapIndex++];
        if (!wrap || wrap.id !== run.preset) continue;
        wrap.wet.gain.value = run.amount;
        wrap.dry.gain.value = 1 - run.amount;
      }
      // `shape` is not reassigned: the early return above already established
      // that `shapeOf(next)` equals it, so recomputing was a whole normalise +
      // join per observer tick to write back the string that was already there.
      return true;
    },
    dispose() {
      for (const { handle } of handles) handle.dispose();
      // The wrap is not one of `handles` — it belongs to the chain rather than
      // to any effect — so it has to be unwired here or a rebuild leaves a
      // crossfade still connected to the graph it used to bridge.
      for (const { entry, wet, dry, join } of presets) {
        entry.disconnect();
        wet.disconnect();
        dry.disconnect();
        join.disconnect();
      }
      input.disconnect();
      output.disconnect();
    },
  };
}

export { audioFxWorkletsReady, ensureAudioFxWorklets };
