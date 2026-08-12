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

type Builder = (ctx: BaseAudioContext, p: HfAudioFxParamValues) => FxNodeHandle;

const n = (v: number | string | undefined): number => (typeof v === "number" ? v : Number(v ?? 0));

/** Milliseconds on the knob, seconds on the AudioParam. */
const msToSec = (v: number): number => v / 1000;

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

const chorusLfo: Builder = (ctx, p) => {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const dl = ctx.createDelay(0.5);
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  lfo.connect(depth).connect(dl.delayTime);
  input.connect(dl).connect(wet).connect(out);
  input.connect(dry).connect(out);
  lfo.start();
  const apply = (v: HfAudioFxParamValues): void => {
    dl.delayTime.value = n(v.delay) / 1000;
    depth.gain.value = n(v.depth) / 1000;
    lfo.frequency.value = n(v.speed);
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
      speed: [{ param: lfo.frequency }],
      mix: mixTargets(wet.gain, dry.gain),
    },
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        /* already stopped */
      }
      [input, out, dl, depth, wet, dry].forEach((x) => x.disconnect());
    },
  };
};

const PHASER_STAGES = 6;

const allpassPhaser: Builder = (ctx, p) => {
  const input = ctx.createGain();
  const out = ctx.createGain();
  // aphaser's in_gain/out_gain trim the signal entering and leaving the effect.
  // Wiring them to the wet and dry legs instead made "Input" mute the dry path
  // and let the two defaults sum above unity, so inserting a phaser raised the
  // track level.
  const inTrim = ctx.createGain();
  const outTrim = ctx.createGain();
  const lfo = ctx.createOscillator();
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
  // aphaser's type 0 is triangular, 1 sinusoidal. The builder never set this, so
  // the declared default ("Triangular") was silently a sine. An OscillatorNode
  // has no triangle-with-the-same-phase primitive to switch to, so triangle is
  // the node's own "triangle" type.
  lfo.start();
  node.connect(wet).connect(outTrim);
  inTrim.connect(dry).connect(outTrim);
  outTrim.connect(out);
  const apply = (v: HfAudioFxParamValues): void => {
    // aphaser sweeps around a centre derived from its delay; mirror the range
    // rather than the exact curve, and let the parity harness score it.
    const centre = 1000 / Math.max(0.1, n(v.delay));
    for (const ap of stages) ap.frequency.value = centre;
    depth.gain.value = centre * n(v.decay);
    lfo.frequency.value = n(v.speed);
    lfo.type = String(v.type) === "1" ? "sine" : "triangle";
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
      speed: [{ param: lfo.frequency }],
      // The trims, not wet/dry. apply() drives inTrim/outTrim from these knobs
      // and pins wet and dry to 1 — so a lane aimed at wet/dry modulated a
      // constant and left the trim frozen, and the next values-only edit slammed
      // it back over the running envelope. The comment above records that this
      // wiring was already moved once; the automation map was missed.
      in_gain: [{ param: inTrim.gain }],
      out_gain: [{ param: outTrim.gain }],
    },
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        /* already stopped */
      }
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
): FxNodeHandle {
  const def = getAudioFxDef(type);
  if (!def) throw new Error(`Unknown effect type: ${type}`);
  const resolved = normalizeAudioFxParams(type, params);
  // One-pole is a different node type, not a different parameter value.
  if ((type === "highpass" || type === "lowpass") && String(resolved.poles) === "1") {
    return onePoleBuilder(type)(ctx, resolved);
  }
  const builder = BUILDERS[def.web];
  if (!builder) throw new Error(`No Web Audio builder for ${def.web}`);
  return builder(ctx, resolved);
}

export interface FxChainHandle {
  input: AudioNode;
  output: AudioNode;
  /** Built effects in chain order, carrying the node ids lanes address. */
  nodes: { id?: string; type: string; handle: FxNodeHandle }[];
  /** Re-parameterise in place when the shape is unchanged; false if a rebuild is needed. */
  update(chain: HfAudioFxChain): boolean;
  dispose(): void;
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
      return `${node.type}${poles}${fixedFreq}`;
    })
    .join("|");
}

/**
 * Build the whole chain in series. Returns a handle whose `input`/`output` can
 * be spliced into any graph; an empty chain yields a pass-through.
 */
export function buildFxChain(ctx: BaseAudioContext, chain: HfAudioFxChain): FxChainHandle {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const handles: { id?: string; type: string; handle: FxNodeHandle }[] = [];

  let tail: AudioNode = input;
  for (const node of enabledAudioFxNodes(chain)) {
    const handle = buildFxNode(ctx, node.type, node.params ?? {});
    tail.connect(handle.input);
    tail = handle.output;
    handles.push({ ...(node.id ? { id: node.id } : {}), type: node.type, handle });
  }
  tail.connect(output);

  const shape = shapeOf(chain);

  return {
    input,
    output,
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
      // `shape` is not reassigned: the early return above already established
      // that `shapeOf(next)` equals it, so recomputing was a whole normalise +
      // join per observer tick to write back the string that was already there.
      return true;
    },
    dispose() {
      for (const { handle } of handles) handle.dispose();
      input.disconnect();
      output.disconnect();
    },
  };
}

export { audioFxWorkletsReady, ensureAudioFxWorklets };
