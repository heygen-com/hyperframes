/**
 * Audio FX chain: the one description of every effect that can be applied to an
 * audio track.
 *
 * Preview and render both run the same Web Audio graph — the studio in a live
 * AudioContext, the engine in an OfflineAudioContext inside the headless
 * browser it already drives. There is only one implementation of each effect,
 * so preview predicting the render is a property of the architecture rather
 * than something to measure and defend.
 *
 * This file holds what both ends need to agree on: the parameter set for each
 * effect with its usable range, and the id of the graph builder that realises
 * it. Parameters are declared in the units a person thinks in (dB, ms, Hz);
 * the graph builders convert where the Web Audio node wants something else.
 */

export const HF_AUDIO_FX_ATTR = "data-fx-chain";

/**
 * The same attribute as a `dataset` / `dataAttributes` key — the `data-` prefix
 * is not part of that spelling.
 *
 * Derived rather than restated: the studio writes through
 * `HF_AUDIO_FX_ATTR` and reads through the key, so a hardcoded `"fx-chain"`
 * on the read side is a rename waiting to half-land.
 */
export const HF_AUDIO_FX_DATA_KEY = HF_AUDIO_FX_ATTR.slice("data-".length);

/** Chain files are versioned; a reader must refuse a version it doesn't know. */
export const HF_AUDIO_FX_CHAIN_VERSION = 1;

export type HfAudioFxGroup = "filter" | "dynamics" | "nonlinear" | "time";

export interface HfAudioFxNumberParam {
  kind: "number";
  key: string;
  label: string;
  /** Shown after the value in the panel; "" for a bare ratio. */
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Frequency-style controls need a log knob to be usable. */
  scale?: "linear" | "log";
  /**
   * The knob is backed by an AudioParam, so an automation lane can drive it.
   *
   * Not every knob can be: a WaveShaper curve, a convolution impulse and a
   * worklet's `processorOptions` are all set wholesale rather than scheduled.
   * A graph builder must expose an AudioParam for every parameter flagged here
   * — `audioFxGraph.test.ts` builds each effect and checks it.
   */
  automatable?: boolean;
  /** One line explaining what turning this does, shown on the control. */
  hint?: string;
}

export interface HfAudioFxEnumParam {
  kind: "enum";
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  default: string;
  hint?: string;
}

export type HfAudioFxParam = HfAudioFxNumberParam | HfAudioFxEnumParam;

export type HfAudioFxParamValues = Record<string, number | string>;

export interface HfAudioFxDef {
  id: string;
  label: string;
  group: HfAudioFxGroup;
  /** One sentence on what the effect is for, shown when adding it. */
  description: string;
  params: readonly HfAudioFxParam[];
  /**
   * Identifier for the Web Audio graph builder that realises this effect. Kept
   * as a string rather than a function so this module stays free of browser
   * globals and can be imported by the engine and the linter.
   */
  web: string;
}

const freq = (
  key = "frequency",
  label = "Frequency",
  def = 1000,
  min = 20,
  max = 20000,
): HfAudioFxNumberParam => ({
  kind: "number",
  key,
  label,
  unit: "Hz",
  min,
  max,
  step: 1,
  default: def,
  scale: "log",
  automatable: true,
});

const qParam = (def = 0.707, hint = "Bandwidth — higher is narrower."): HfAudioFxNumberParam => ({
  kind: "number",
  key: "q",
  label: "Q",
  unit: "",
  min: 0.1,
  max: 20,
  step: 0.01,
  default: def,
  scale: "log",
  automatable: true,
  hint,
});

const gainDb = (min = -40, max = 40, def = 0): HfAudioFxNumberParam => ({
  kind: "number",
  key: "gain",
  label: "Gain",
  unit: "dB",
  min,
  max,
  step: 0.1,
  default: def,
  automatable: true,
});

const poles: HfAudioFxEnumParam = {
  kind: "enum",
  key: "poles",
  label: "Slope",
  options: [
    { value: "1", label: "6 dB/oct" },
    { value: "2", label: "12 dB/oct" },
  ],
  default: "2",
  hint: "Two poles is the usual biquad; one pole is gentler.",
};

/**
 * Every effect, in panel order. Ranges are the usable span for each control;
 * a value that survives `normalizeAudioFxParams` is always safe to realise.
 */
export const HF_AUDIO_FX: readonly HfAudioFxDef[] = [
  {
    id: "gain",
    label: "Gain",
    group: "dynamics",
    description: "Raise or lower the whole signal. Automate it to duck under something else.",
    // Cuts go deep, boosts stay modest: this is a level stage for making room,
    // and a chain that can add 40 dB clips long before it is useful.
    params: [gainDb(-60, 12, 0)],
    web: "gain-node",
  },
  {
    id: "peaking",
    label: "Peaking EQ",
    group: "filter",
    description: "Boost or cut a band, leaving everything either side alone.",
    params: [freq("frequency", "Frequency", 1000), gainDb(-40, 40, 0), qParam(1)],
    web: "biquad-peaking",
  },
  {
    id: "lowshelf",
    label: "Low Shelf",
    group: "filter",
    description: "Lift or drop everything below the corner frequency.",
    // No Q: the Web Audio spec leaves it unused for shelving filters, so the
    // control moved nothing — and being automatable, a lane drawn on it would
    // have been silently inert.
    params: [freq("frequency", "Frequency", 200, 20, 2000), gainDb(-40, 40, 0)],
    web: "biquad-lowshelf",
  },
  {
    id: "highshelf",
    label: "High Shelf",
    group: "filter",
    description: "Lift or drop everything above the corner frequency.",
    params: [freq("frequency", "Frequency", 4000, 500, 20000), gainDb(-40, 40, 0)],
    web: "biquad-highshelf",
  },
  {
    id: "highpass",
    label: "High-pass",
    group: "filter",
    description: "Remove low frequencies — the usual fix for rumble on a voice.",
    params: [freq("frequency", "Cutoff", 300, 20, 20000), qParam(0.707), poles],
    web: "biquad-highpass",
  },
  {
    id: "lowpass",
    label: "Low-pass",
    group: "filter",
    description: "Remove high frequencies — darkens or muffles a track.",
    params: [freq("frequency", "Cutoff", 8000, 100, 20000), qParam(0.707), poles],
    web: "biquad-lowpass",
  },

  {
    id: "compressor",
    label: "Compressor",
    group: "dynamics",
    description: "Pull loud parts down so the quiet ones can come up.",
    params: [
      {
        kind: "number",
        key: "threshold",
        label: "Threshold",
        unit: "dB",
        min: -60,
        max: 0,
        step: 0.5,
        default: -24,
        hint: "Level above which the compressor starts working.",
      },
      {
        kind: "number",
        key: "ratio",
        label: "Ratio",
        unit: ":1",
        min: 1,
        max: 20,
        step: 0.1,
        default: 4,
      },
      {
        kind: "number",
        key: "attack",
        label: "Attack",
        unit: "ms",
        min: 0.01,
        max: 2000,
        step: 0.1,
        default: 20,
        scale: "log",
      },
      {
        kind: "number",
        key: "release",
        label: "Release",
        unit: "ms",
        min: 0.01,
        max: 9000,
        step: 1,
        default: 250,
        scale: "log",
      },
      {
        kind: "number",
        key: "knee",
        label: "Knee",
        unit: "",
        min: 1,
        max: 8,
        step: 0.01,
        default: 2.83,
        hint: "1 is a hard corner; higher eases into it.",
      },
      {
        kind: "number",
        key: "makeup",
        label: "Makeup",
        unit: "dB",
        min: 0,
        max: 36,
        step: 0.1,
        default: 0,
      },
      {
        kind: "number",
        key: "mix",
        label: "Mix",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        hint: "Below 1 blends the dry signal back in.",
      },
    ],
    web: "worklet-compressor",
  },
  {
    id: "limiter",
    label: "Limiter",
    group: "dynamics",
    description: "Hard ceiling — nothing gets past the limit.",
    params: [
      {
        kind: "number",
        key: "limit",
        label: "Ceiling",
        unit: "dB",
        min: -24,
        max: 0,
        step: 0.1,
        default: -1,
      },
      {
        kind: "number",
        key: "attack",
        label: "Attack",
        unit: "ms",
        min: 0.1,
        max: 80,
        step: 0.1,
        default: 5,
      },
      {
        kind: "number",
        key: "release",
        label: "Release",
        unit: "ms",
        min: 1,
        max: 8000,
        step: 1,
        default: 50,
        scale: "log",
      },
      {
        kind: "number",
        key: "level_out",
        label: "Output",
        unit: "dB",
        min: -24,
        max: 24,
        step: 0.1,
        default: 0,
      },
    ],
    web: "worklet-limiter",
  },
  {
    id: "gate",
    label: "Noise Gate",
    group: "dynamics",
    description: "Silence the track when it drops below the threshold.",
    params: [
      {
        kind: "number",
        key: "threshold",
        label: "Threshold",
        unit: "dB",
        min: -80,
        max: 0,
        step: 0.5,
        default: -35,
      },
      {
        kind: "number",
        key: "range",
        label: "Range",
        unit: "dB",
        min: -80,
        max: 0,
        step: 0.5,
        default: -24,
        hint: "How far down the gate pulls when closed.",
      },
      {
        kind: "number",
        key: "ratio",
        label: "Ratio",
        unit: ":1",
        min: 1,
        max: 20,
        step: 0.1,
        default: 10,
      },
      {
        kind: "number",
        key: "attack",
        label: "Attack",
        unit: "ms",
        min: 0.01,
        max: 9000,
        step: 0.1,
        default: 1,
        scale: "log",
      },
      {
        kind: "number",
        key: "release",
        label: "Release",
        unit: "ms",
        min: 0.01,
        max: 9000,
        step: 1,
        default: 100,
        scale: "log",
      },
      {
        kind: "number",
        key: "knee",
        label: "Knee",
        unit: "",
        min: 1,
        max: 8,
        step: 0.01,
        default: 2.83,
      },
    ],
    web: "worklet-gate",
  },

  {
    id: "saturate",
    label: "Saturation",
    group: "nonlinear",
    description: "Soft-clip the waveform for warmth or outright distortion.",
    params: [
      {
        kind: "enum",
        key: "type",
        label: "Curve",
        options: [
          { value: "tanh", label: "Tanh" },
          { value: "atan", label: "Arctan" },
          { value: "cubic", label: "Cubic" },
          { value: "exp", label: "Exponential" },
          { value: "alg", label: "Algebraic" },
          { value: "quintic", label: "Quintic" },
          { value: "sin", label: "Sine" },
          { value: "erf", label: "Error function" },
          { value: "hard", label: "Hard clip" },
        ],
        default: "tanh",
      },
      {
        kind: "number",
        key: "threshold",
        label: "Threshold",
        unit: "dB",
        min: -40,
        max: 0,
        step: 0.1,
        default: -6,
      },
      {
        kind: "number",
        key: "output",
        automatable: true,
        label: "Output",
        unit: "dB",
        min: -24,
        max: 24,
        step: 0.1,
        default: 0,
      },
      {
        kind: "number",
        key: "oversample",
        label: "Oversample",
        unit: "x",
        min: 1,
        max: 8,
        step: 1,
        default: 4,
        hint: "Higher costs more but keeps aliasing down.",
      },
    ],
    web: "waveshaper",
  },
  {
    id: "bitcrush",
    label: "Bitcrush",
    group: "nonlinear",
    description: "Drop bit depth and sample rate for a lo-fi, digital sound.",
    params: [
      {
        kind: "number",
        key: "bits",
        label: "Bit depth",
        unit: "bit",
        min: 1,
        max: 32,
        step: 0.1,
        default: 8,
      },
      {
        kind: "number",
        key: "samples",
        label: "Sample hold",
        unit: "x",
        min: 1,
        max: 250,
        step: 1,
        default: 1,
        hint: "Repeats each sample N times — a crude downsample.",
      },
      {
        kind: "number",
        key: "mix",
        label: "Mix",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
    web: "worklet-bitcrush",
  },

  {
    id: "delay",
    label: "Delay",
    group: "time",
    description: "Repeating echoes behind the dry signal.",
    params: [
      {
        kind: "number",
        key: "time",
        automatable: true,
        label: "Time",
        unit: "ms",
        min: 1,
        max: 5000,
        step: 1,
        default: 250,
        scale: "log",
      },
      // aecho rejects a decay of exactly 0 ("out of allowed range: (0, 1]"),
      // so the floor is a hair above silence rather than at it.
      {
        kind: "number",
        key: "feedback",
        automatable: true,
        label: "Feedback",
        unit: "",
        min: 0.01,
        max: 0.95,
        step: 0.01,
        default: 0.35,
      },
      {
        kind: "number",
        key: "mix",
        automatable: true,
        label: "Mix",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.4,
      },
    ],
    web: "delay-feedback",
  },
  {
    id: "chorus",
    label: "Chorus",
    group: "time",
    description: "Detuned copies of the signal for width and thickness.",
    params: [
      {
        kind: "number",
        key: "delay",
        automatable: true,
        label: "Delay",
        unit: "ms",
        min: 1,
        max: 100,
        step: 0.1,
        default: 7,
      },
      {
        kind: "number",
        key: "depth",
        automatable: true,
        label: "Depth",
        unit: "ms",
        min: 0,
        max: 10,
        step: 0.01,
        default: 2,
      },
      {
        kind: "number",
        key: "speed",
        automatable: true,
        label: "Rate",
        unit: "Hz",
        min: 0.01,
        max: 10,
        step: 0.01,
        default: 1,
      },
      {
        kind: "number",
        key: "mix",
        automatable: true,
        label: "Mix",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
    ],
    web: "chorus-lfo",
  },
  {
    id: "phaser",
    label: "Phaser",
    group: "time",
    description: "Sweeping notches moving through the spectrum.",
    params: [
      {
        kind: "number",
        key: "in_gain",
        automatable: true,
        label: "Input",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.4,
      },
      {
        kind: "number",
        key: "out_gain",
        automatable: true,
        label: "Output",
        unit: "",
        min: 0,
        max: 2,
        step: 0.01,
        default: 0.74,
      },
      // aphaser advertises a delay range starting at 0 but rejects it at
      // runtime with "delay is too small"; 0.1 ms is the real floor.
      {
        kind: "number",
        key: "delay",
        label: "Delay",
        unit: "ms",
        min: 0.1,
        max: 5,
        step: 0.1,
        default: 3,
      },
      {
        kind: "number",
        key: "decay",
        label: "Decay",
        unit: "",
        min: 0,
        max: 0.99,
        step: 0.01,
        default: 0.4,
      },
      {
        kind: "number",
        key: "speed",
        automatable: true,
        label: "Rate",
        unit: "Hz",
        min: 0.1,
        max: 2,
        step: 0.01,
        default: 0.5,
      },
      {
        kind: "enum",
        key: "type",
        label: "Waveform",
        options: [
          { value: "0", label: "Triangular" },
          { value: "1", label: "Sinusoidal" },
        ],
        default: "0",
      },
    ],
    web: "allpass-phaser",
  },
  {
    id: "reverb",
    label: "Reverb",
    group: "time",
    description:
      "Room tail. Both ends convolve the same generated impulse, so preview matches render.",
    params: [
      {
        kind: "number",
        key: "size",
        label: "Room size",
        unit: "",
        min: 0.05,
        max: 1,
        step: 0.01,
        default: 0.7,
      },
      {
        kind: "number",
        key: "damping",
        label: "Damping",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        hint: "Higher rolls the top off the tail faster.",
      },
      {
        kind: "number",
        key: "wet",
        automatable: true,
        label: "Wet",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.35,
      },
      {
        kind: "number",
        key: "dry",
        automatable: true,
        label: "Dry",
        unit: "",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.7,
      },
    ],
    web: "convolver",
  },
] as const;

const BY_ID = new Map(HF_AUDIO_FX.map((d) => [d.id, d]));

export function getAudioFxDef(id: string): HfAudioFxDef | undefined {
  return BY_ID.get(id);
}

export const HF_AUDIO_FX_IDS: readonly string[] = HF_AUDIO_FX.map((d) => d.id);

/** Every parameter at its declared default, ready to seed a freshly added effect. */
export function defaultAudioFxParams(id: string): HfAudioFxParamValues {
  const def = BY_ID.get(id);
  if (!def) return {};
  const out: HfAudioFxParamValues = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/**
 * Clamp and fill a parameter set so it is always renderable: unknown keys are
 * dropped, missing keys take their default, numbers are clamped into their
 * declared range, and an unrecognised enum value falls back to its default.
 * A non-finite number is treated as missing rather than passed through, since
 * NaN reaching an AudioParam silences the node for the rest of the render.
 */
export function normalizeAudioFxParams(
  id: string,
  values: Readonly<HfAudioFxParamValues> | undefined,
): HfAudioFxParamValues {
  const def = BY_ID.get(id);
  if (!def) return {};
  const out: HfAudioFxParamValues = {};
  for (const p of def.params) {
    const raw = values?.[p.key];
    if (p.kind === "enum") {
      const ok = p.options.some((o) => o.value === raw);
      out[p.key] = ok ? (raw as string) : p.default;
      continue;
    }
    // Only a number, or a string that actually spells one. `Number(null)`,
    // `Number("")`, `Number(false)` and `Number([])` are all 0 and all pass
    // Number.isFinite, so a missing or blanked value used to clamp to 0 rather
    // than fall back to the declared default — and 0 is a legal value for most
    // of these knobs, so nothing downstream could tell. A compressor whose
    // threshold arrived as null sat at 0 dB and never engaged, silently,
    // instead of at its -24 dB default. `numberOrNull` in audioAutomation.ts
    // already guards exactly this.
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? Number(raw)
          : Number.NaN;
    out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default;
  }
  return out;
}

export interface HfAudioFxNode {
  /** Effect id from HF_AUDIO_FX. */
  type: string;
  /**
   * Stable handle for this node within its chain, minted when the node is
   * added. Automation lanes address nodes by id (`fx.<id>.<param>`) so that
   * reordering the chain never re-points a lane at a different effect. Older
   * chains have no ids; they load fine and simply cannot be automated until
   * the panel touches them.
   */
  id?: string;
  /** Set on nodes the carve analysis generated, so re-running replaces them
   *  instead of stacking another set on top of hand-added effects. */
  fromCarve?: boolean;
  /**
   * Id of the preset that wrote this node, for the same reason `fromCarve`
   * exists: re-applying a preset replaces its own nodes rather than adding a
   * second copy, and the rack can brace them together under the preset's name.
   *
   * The id rather than a flag, because a chain can carry more than one preset
   * and each has to be able to find its own.
   */
  fromPreset?: string;
  /**
   * What the rack calls this node, when the effect's own name is not specific
   * enough to be useful.
   *
   * A peaking filter is "Shape One Range" wherever it appears, so a chain that
   * cuts mud at 250 Hz and lifts clarity at 3 kHz shows the same words twice
   * and an author cannot tell the two apart. A preset names each node for the
   * JOB it is doing instead — "Reduce Mud", "Add Clarity" — and the rack reads
   * as a list of things that were done rather than a list of filter types.
   */
  label?: string;
  /**
   * Id of the multi-band EQ that owns this node, when it is one of its bands.
   *
   * Same device as `fromCarve`: the module gathers its own nodes out of the
   * chain and presents them as one control surface, so an EQ needs no new
   * effect type and its bands stay ordinary filters underneath.
   */
  fromEq?: string;

  /**
   * How much of this node's preset is applied, 0..1 — the wet/dry blend the
   * graph wraps its run in.
   *
   * On every node of the run rather than beside the chain, because the chain has
   * nowhere else to put it: `HfAudioFxChain` is a version and a list of nodes,
   * and a preset is defined by which nodes carry its tag. The graph reads it off
   * the first node of each run. Absent means fully applied, which is what every
   * chain written before this means.
   */
  presetAmount?: number /**
   * Set on the gain stage the leveller writes, so re-running replaces it rather
   * than stacking a second one — the same contract `fromCarve` has.
   */;
  fromLeveller?: boolean;
  /** Absent means enabled — chain files written before the field existed still load. */
  enabled?: boolean;
  params?: HfAudioFxParamValues;
}

export interface HfAudioFxChain {
  version: number;
  nodes: HfAudioFxNode[];
}

export class AudioFxChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioFxChainError";
  }
}

/**
 * Parse a chain file. Unknown effect ids are rejected rather than skipped: a
 * chain that silently loses a node would render differently from the project
 * the author saved, which is worse than refusing to render at all.
 */
export function parseAudioFxChain(json: string): HfAudioFxChain {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new AudioFxChainError(`Chain file is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new AudioFxChainError("Chain file must be a JSON object.");
  }
  const obj = raw as { version?: unknown; nodes?: unknown };
  if (obj.version !== HF_AUDIO_FX_CHAIN_VERSION) {
    throw new AudioFxChainError(`Unsupported chain version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.nodes)) {
    throw new AudioFxChainError("Chain file is missing a `nodes` array.");
  }
  const nodes: HfAudioFxNode[] = obj.nodes.map((n, i) => {
    if (typeof n !== "object" || n === null) {
      throw new AudioFxChainError(`Node ${i} is not an object.`);
    }
    const node = n as {
      type?: unknown;
      id?: unknown;
      enabled?: unknown;
      params?: unknown;
      fromCarve?: unknown;
      fromPreset?: unknown;
      label?: unknown;
      fromEq?: unknown;
      fromLeveller?: unknown;
      presetAmount?: unknown;
    };
    if (typeof node.type !== "string" || !BY_ID.has(node.type)) {
      throw new AudioFxChainError(`Node ${i} has unknown effect type: ${String(node.type)}`);
    }
    return {
      type: node.type,
      ...(typeof node.id === "string" && node.id ? { id: node.id } : {}),
      ...(node.fromCarve === true ? { fromCarve: true as const } : {}),
      // Both survive the round trip or a preset stops being able to find its
      // own nodes after a reload: re-applying would stack a second copy and
      // the rack would lose the grouping it braces them with.
      ...(typeof node.fromPreset === "string" && node.fromPreset
        ? { fromPreset: node.fromPreset }
        : {}),
      ...(typeof node.label === "string" && node.label ? { label: node.label } : {}),
      ...(typeof node.fromEq === "string" && node.fromEq ? { fromEq: node.fromEq } : {}),
      ...(node.fromLeveller === true ? { fromLeveller: true as const } : {}),
      // Clamped on the way in: the blend is two gains in opposition, and a value
      // outside 0..1 makes the dry leg negative rather than simply loud.
      ...(typeof node.presetAmount === "number" && Number.isFinite(node.presetAmount)
        ? { presetAmount: Math.min(1, Math.max(0, node.presetAmount)) }
        : {}),
      enabled: node.enabled !== false,
      params: normalizeAudioFxParams(
        node.type,
        (node.params ?? undefined) as HfAudioFxParamValues | undefined,
      ),
    };
  });
  return { version: HF_AUDIO_FX_CHAIN_VERSION, nodes };
}

/** The nodes that should process audio, in order. */
export function enabledAudioFxNodes(chain: HfAudioFxChain): HfAudioFxNode[] {
  return chain.nodes.filter((n) => n.enabled !== false);
}

/** Serialise a chain for the `data-fx-chain` attribute. */
export function serializeAudioFxChain(chain: HfAudioFxChain): string {
  return JSON.stringify({
    version: HF_AUDIO_FX_CHAIN_VERSION,
    nodes: chain.nodes.map((node) => ({
      type: node.type,
      ...(node.id ? { id: node.id } : {}),
      ...(node.fromCarve === true ? { fromCarve: true } : {}),
      ...(node.fromPreset ? { fromPreset: node.fromPreset } : {}),
      ...(node.label ? { label: node.label } : {}),
      ...(node.fromEq ? { fromEq: node.fromEq } : {}),
      ...(node.fromLeveller === true ? { fromLeveller: true } : {}),
      // Omitted when fully applied, so an untouched preset does not grow a field
      // in every chain that carries one.
      ...(typeof node.presetAmount === "number" && node.presetAmount !== 1
        ? { presetAmount: node.presetAmount }
        : {}),
      ...(node.enabled === false ? { enabled: false } : {}),
      params: normalizeAudioFxParams(node.type, node.params),
    })),
  });
}

/**
 * Next free node id for a chain, as `n1`, `n2`, … — counted rather than random
 * so that adding an effect produces the same document on every machine, which
 * compositions require.
 */
export function mintAudioFxNodeId(chain: HfAudioFxChain): string {
  const taken = new Set(chain.nodes.map((n) => n.id).filter(Boolean));
  for (let i = 1; ; i += 1) {
    const id = `n${i}`;
    if (!taken.has(id)) return id;
  }
}
