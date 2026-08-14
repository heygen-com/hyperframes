/**
 * Named starting points for the FX rack.
 *
 * Voice carve turned a pile of effects into one understandable feature. These
 * do the same for the cases an analysis cannot decide: a preset is a chain
 * somebody already tuned, applied in one click and editable immediately
 * afterwards.
 *
 * A preset is DATA, deliberately. Applying one writes ordinary nodes into
 * `data-fx-chain` — the same nodes hand-building would produce — so there is no
 * second code path to keep in agreement with the rack, nothing new in the
 * render, and no failure mode the chain does not already have. The author can
 * see everything that was written on their behalf and change any of it.
 *
 * Only the parameters a preset actually means are listed; `normalizeAudioFxParams`
 * fills the rest from the effect's own defaults. That keeps each entry readable
 * as an intent rather than a dump of every knob.
 *
 * Node ORDER is load-bearing — the chain is serial, so a limiter first and a
 * limiter last are different sounds. Every preset below runs
 * subtractive filtering → dynamics → tone → character → limiter, the order
 * `skills/hyperframes-audio` already teaches.
 */

import {
  HF_AUDIO_FX_CHAIN_VERSION,
  mintAudioFxNodeId,
  normalizeAudioFxParams,
  type HfAudioFxChain,
  type HfAudioFxNode,
  type HfAudioFxParamValues,
} from "./audioFx.js";

/**
 * Which shelf of the menu a preset sits on.
 *
 * Deliberately NOT the effect registry's own `group` (filter/dynamics/…): that
 * groups by what an effect *is*, and an author picking a preset is shopping for
 * what they *want*. "Telephone" is filters and saturation; nobody looks for it
 * under either.
 */
export type HfAudioFxPresetFamily = "voice" | "repair" | "character" | "space";

export interface HfAudioFxPresetNode {
  /** Effect id from HF_AUDIO_FX. */
  type: string;
  /**
   * What the rack calls this node — the JOB it is doing, not its filter type.
   *
   * A peaking filter is "Shape One Range" wherever it appears, so a chain that
   * cuts mud and then lifts clarity shows the same words twice and an author
   * cannot follow it. Naming each node for its job is what lets a preset read
   * as a list of things that were done.
   */
  label?: string;
  /** Only what this preset means to set; the rest come from the effect's defaults. */
  params?: HfAudioFxParamValues;
}

export interface HfAudioFxPreset {
  id: string;
  label: string;
  family: HfAudioFxPresetFamily;
  /** One line, in the author's language — what it does, not which effects it uses. */
  description: string;
  nodes: readonly HfAudioFxPresetNode[];
}

const preset = (
  id: string,
  family: HfAudioFxPresetFamily,
  label: string,
  description: string,
  nodes: readonly HfAudioFxPresetNode[],
): HfAudioFxPreset => ({ id, label, family, description, nodes });

/**
 * A 24 dB/oct skirt is two of these stacked: `poles` tops out at 2 (12 dB/oct)
 * because a BiquadFilterNode is two-pole and that is the honest maximum for one
 * node. The telephone band wants the steeper slope, so it pays for two.
 */
const steep = (
  type: "highpass" | "lowpass",
  frequency: number,
  label: string,
): HfAudioFxPresetNode[] => [
  { type, label, params: { frequency, q: 0.707, poles: "2" } },
  { type, label, params: { frequency, q: 0.707, poles: "2" } },
];

export const HF_AUDIO_FX_PRESETS: readonly HfAudioFxPreset[] = [
  // ---------------------------------------------------------------- voice --
  preset(
    "voice-clean",
    "voice",
    "Clean Voice",
    "Cuts rumble and mud, evens out the level, adds a little clarity.",
    [
      { type: "highpass", label: "Remove Rumble", params: { frequency: 80, q: 0.707, poles: "2" } },
      { type: "peaking", label: "Reduce Mud", params: { frequency: 250, gain: -3, q: 1.2 } },
      {
        type: "compressor",
        label: "Even Out Loudness",
        params: { threshold: -20, ratio: 3, attack: 12, release: 180, makeup: 3 },
      },
      { type: "peaking", label: "Add Clarity", params: { frequency: 3000, gain: 2.5, q: 1 } },
      { type: "limiter", label: "Peak Ceiling", params: { limit: -1, attack: 5, release: 50 } },
    ],
  ),
  preset(
    "voice-broadcast",
    "voice",
    "Broadcast",
    "Denser and more forward — a radio-presenter sound.",
    [
      { type: "highpass", label: "Remove Rumble", params: { frequency: 90, q: 0.707, poles: "2" } },
      { type: "peaking", label: "Reduce Boxiness", params: { frequency: 400, gain: -3, q: 1.4 } },
      {
        type: "compressor",
        label: "Even Out Loudness",
        params: { threshold: -24, ratio: 4, attack: 8, release: 150, makeup: 5 },
      },
      { type: "peaking", label: "Add Clarity", params: { frequency: 2500, gain: 3, q: 0.9 } },
      { type: "highshelf", label: "Add Air", params: { frequency: 8000, gain: 2 } },
      { type: "saturate", label: "Warmth", params: { type: "tanh", threshold: -12, output: 0 } },
      { type: "limiter", label: "Peak Ceiling", params: { limit: -1, attack: 5, release: 60 } },
    ],
  ),
  preset(
    "voice-warm",
    "voice",
    "Close & Warm",
    "Intimate and lightly handled, for a voice close to the mic.",
    [
      { type: "highpass", label: "Remove Rumble", params: { frequency: 70, q: 0.707, poles: "2" } },
      { type: "lowshelf", label: "Add Weight", params: { frequency: 180, gain: 2 } },
      {
        type: "compressor",
        label: "Even Out Loudness",
        params: { threshold: -18, ratio: 2.5, attack: 20, release: 250, makeup: 2 },
      },
      { type: "peaking", label: "Add Clarity", params: { frequency: 3000, gain: 1.5, q: 0.8 } },
      { type: "limiter", label: "Peak Ceiling", params: { limit: -1.5 } },
    ],
  ),

  // --------------------------------------------------------------- repair --
  // Named for what they DO. None of these is noise reduction: that needs
  // spectral work this effect set does not have, and a preset implying
  // otherwise would be a lie the author only discovers after trusting it.
  preset(
    "rumble-cut",
    "repair",
    "Cut Rumble",
    "Removes traffic, handling and air-conditioning from under a voice.",
    [{ type: "highpass", label: "Cut Rumble", params: { frequency: 100, q: 0.707, poles: "2" } }],
  ),
  preset(
    "room-gate",
    "repair",
    "Quiet Between Phrases",
    "Silences the gaps between words. Room tone under speech stays — this closes the pauses, it does not remove noise.",
    [
      {
        type: "gate",
        label: "Silence the Gaps",
        params: { threshold: -45, range: -18, ratio: 10, attack: 2, release: 180 },
      },
    ],
  ),
  preset(
    "boom-tame",
    "repair",
    "Tame Boominess",
    "Takes out the chestiness of a voice too close to the mic.",
    [{ type: "peaking", label: "Tame Boominess", params: { frequency: 200, gain: -4, q: 1.4 } }],
  ),
  preset(
    "harsh-tame",
    "repair",
    "Soften Harshness",
    "Rounds off a brittle upper-mid. Broad and always-on; sibilance proper wants the measuring version.",
    [{ type: "peaking", label: "Soften Harshness", params: { frequency: 3200, gain: -3, q: 1.6 } }],
  ),

  // ------------------------------------------------------------ character --
  preset(
    "telephone",
    "character",
    "Telephone",
    "Down the line — the narrow band of a phone call.",
    [
      ...steep("highpass", 300, "Strip the Bass"),
      ...steep("lowpass", 3400, "Strip the Treble"),
      { type: "peaking", label: "Phone Honk", params: { frequency: 1200, gain: 6, q: 1.2 } },
      { type: "peaking", label: "De-mud", params: { frequency: 550, gain: -4, q: 1 } },
      {
        type: "saturate",
        label: "Circuit Grit",
        params: { type: "tanh", threshold: -9, output: -2 },
      },
    ],
  ),
  preset("radio-am", "character", "AM Radio", "Narrow, gritty and a little crushed.", [
    // Narrower than the megaphone at BOTH ends, which is most of the difference
    // between them: an AM channel is a few kHz wide and the receiver rolls off
    // well before a horn does.
    { type: "highpass", label: "Strip the Bass", params: { frequency: 220, q: 0.707, poles: "2" } },
    {
      type: "lowpass",
      label: "Strip the Treble",
      params: { frequency: 2200, q: 0.707, poles: "2" },
    },
    // Where the telephone honks, a receiver DIPS: the IF filter's droop, and the
    // reason the two stop sounding alike. Telephone's band is its identity (it
    // is the G.712 passband), so the radio is what moves.
    { type: "peaking", label: "IF Droop", params: { frequency: 1200, gain: -5, q: 0.9 } },
    // And a lift at the bottom of the band — AM is boxy where a phone is thin.
    { type: "lowshelf", label: "Boxy", params: { frequency: 500, gain: 4 } },
    // Soft — a receiver compressing, not a driver being overdriven. `tanh`
    // rounds the peaks where the megaphone's `hard` clips them flat.
    { type: "saturate", label: "Radio Grit", params: { type: "tanh", threshold: -8, output: -1 } },
    // The crush is the AM signature: quantisation noise reads as carrier hiss,
    // and it is the one thing the megaphone has none of.
    { type: "bitcrush", label: "Carrier Hiss", params: { bits: 8, samples: 1, mix: 0.45 } },
  ]),
  preset(
    "megaphone",
    "character",
    "Megaphone",
    "Shouted through a horn, with the slap that comes with it.",
    [
      {
        type: "highpass",
        label: "Strip the Bass",
        params: { frequency: 700, q: 0.707, poles: "2" },
      },
      {
        type: "lowpass",
        label: "Strip the Treble",
        params: { frequency: 4000, q: 0.707, poles: "2" },
      },
      // A horn is a resonant tube and that resonance IS the sound: one narrow
      // peak with a second ringing above it, where the radio has none at all.
      { type: "peaking", label: "Horn Honk", params: { frequency: 1900, gain: 14, q: 3 } },
      { type: "peaking", label: "Horn Ring", params: { frequency: 3200, gain: 6, q: 3 } },
      // A driver pushed past its limit — flat-topped, not rounded. Measured on a
      // log sweep, the threshold is the whole ballgame: at -14 the clipper
      // flattened the response to a dead -19 dB line and ERASED the horn peaks
      // above, leaving this indistinguishable from AM Radio. Backed off until
      // the resonance survives the clipping that is supposed to sit on top of it.
      {
        type: "saturate",
        label: "Overdrive",
        params: { type: "hard", threshold: -5, output: -3 },
      },
      // The outdoor reflection that comes back off whatever is being shouted at.
      // Far enough to be a slap rather than a thickening.
      { type: "delay", label: "Horn Slap", params: { time: 65, feedback: 0.2, mix: 0.28 } },
    ],
  ),
  preset(
    "lofi-tape",
    "character",
    "Tape",
    "Worn, warm and slightly unsteady, like a played-out cassette.",
    [
      { type: "lowpass", label: "Tape Rolloff", params: { frequency: 6500, q: 0.707, poles: "2" } },
      { type: "lowshelf", label: "Add Weight", params: { frequency: 120, gain: 2 } },
      {
        type: "saturate",
        label: "Tape Warmth",
        params: { type: "tanh", threshold: -14, output: 0 },
      },
      { type: "bitcrush", label: "Tape Noise", params: { bits: 12, samples: 2, mix: 0.35 } },
      // A slow, shallow chorus is what wow and flutter actually are.
      {
        type: "chorus",
        label: "Wow & Flutter",
        params: { delay: 6, depth: 0.6, speed: 0.4, mix: 0.15 },
      },
    ],
  ),
  preset("pa-system", "character", "Tannoy", "Announced across a concourse.", [
    { type: "highpass", label: "Strip the Bass", params: { frequency: 250, q: 0.707, poles: "2" } },
    {
      type: "lowpass",
      label: "Strip the Treble",
      params: { frequency: 5000, q: 0.707, poles: "2" },
    },
    // Higher and harder than the telephone's honk, which is what a big horn
    // does — and it keeps the top the phone throws away.
    { type: "peaking", label: "Tannoy Honk", params: { frequency: 2400, gain: 9, q: 2 } },
    {
      type: "saturate",
      label: "Driver Grit",
      params: { type: "tanh", threshold: -10, output: -1 },
    },
    {
      type: "reverb",
      label: "Concourse",
      params: { size: 0.54, damping: 0.48, wet: 0.25, dry: 0.8 },
    },
  ]),
  preset("intercom", "character", "Intercom", "Buzzed through a door panel, squelch and all.", [
    {
      type: "gate",
      label: "Squelch",
      params: { threshold: -40, range: -30, ratio: 10, attack: 1, release: 120 },
    },
    { type: "highpass", label: "Strip the Bass", params: { frequency: 500, q: 0.707, poles: "2" } },
    {
      type: "lowpass",
      label: "Strip the Treble",
      params: { frequency: 3000, q: 0.707, poles: "2" },
    },
    { type: "peaking", label: "Panel Honk", params: { frequency: 2000, gain: 6, q: 2 } },
    { type: "bitcrush", label: "Crunch", params: { bits: 11, samples: 1, mix: 0.3 } },
  ]),
  // The chorus with its wobble dialled up until it stops being width and starts
  // being the effect: fast (10 Hz, the top of the range) and fully wet, so none
  // of the straight signal is left to anchor the pitch.
  preset(
    "doofus-worble",
    "character",
    "Doofus Worble",
    "Seasick and wobbling — no straight signal left.",
    [
      {
        type: "chorus",
        label: "Worble",
        params: { delay: 14.6, depth: 2.57, speed: 10, mix: 1 },
      },
    ],
  ),

  // ---------------------------------------------------------------- space --
  preset("room-tight", "space", "Tight Room", "A small hard room — presence without wash.", [
    {
      type: "reverb",
      label: "Tight Room",
      params: { size: 0.25, damping: 0.6, wet: 0.18, dry: 0.9 },
    },
  ]),
  preset(
    "room-natural",
    "space",
    "Natural Room",
    "Sounds recorded somewhere rather than nowhere.",
    [
      {
        type: "reverb",
        label: "Natural Room",
        params: { size: 0.5, damping: 0.5, wet: 0.25, dry: 0.85 },
      },
    ],
  ),
  preset("hall", "space", "Hall", "Long and open, for something that should sit far back.", [
    { type: "reverb", label: "Hall", params: { size: 0.9, damping: 0.3, wet: 0.4, dry: 0.75 } },
  ]),
  preset("slap-echo", "space", "Slap Echo", "One quick repeat — rockabilly vocal, not a wash.", [
    { type: "delay", label: "Slap Echo", params: { time: 110, feedback: 0.12, mix: 0.22 } },
  ]),
  preset("dub-throw", "space", "Dub Throw", "Repeats that trail off well behind the beat.", [
    { type: "delay", label: "Dub Throw", params: { time: 375, feedback: 0.55, mix: 0.3 } },
  ]),
];

export const HF_AUDIO_FX_PRESET_IDS: readonly string[] = HF_AUDIO_FX_PRESETS.map((p) => p.id);

const BY_ID = new Map(HF_AUDIO_FX_PRESETS.map((p) => [p.id, p]));

export function getAudioFxPreset(id: string): HfAudioFxPreset | undefined {
  return BY_ID.get(id);
}

/** Menu order: the shelves, in the order the panel lists them. */
export const HF_AUDIO_FX_PRESET_FAMILIES: readonly HfAudioFxPresetFamily[] = [
  "voice",
  "repair",
  "character",
  "space",
];

export function audioFxPresetsByFamily(family: HfAudioFxPresetFamily): HfAudioFxPreset[] {
  return HF_AUDIO_FX_PRESETS.filter((p) => p.family === family);
}

/**
 * Realise a preset as nodes ready to splice into `chain`.
 *
 * Ids are minted against the chain the nodes are joining, not against the
 * preset, so applying the same preset twice cannot collide — and every node
 * gets one, because an automation lane addresses its effect by id and a node
 * without one can never be automated.
 *
 * Params are normalised here rather than at apply time: a preset that names a
 * value the effect would clamp should land in the file as the value that will
 * actually be rendered, so the rack never shows a number the graph is not using.
 */
export function audioFxPresetNodes(
  preset: HfAudioFxPreset,
  chain: HfAudioFxChain,
): HfAudioFxNode[] {
  const out: HfAudioFxNode[] = [];
  // Minted against a growing chain, so ids are unique within this batch too.
  let running: HfAudioFxChain = { ...chain, nodes: [...chain.nodes] };
  for (const node of preset.nodes) {
    const made: HfAudioFxNode = {
      type: node.type,
      id: mintAudioFxNodeId(running),
      fromPreset: preset.id,
      ...(node.label ? { label: node.label } : {}),
      enabled: true,
      params: normalizeAudioFxParams(node.type, node.params),
    };
    out.push(made);
    running = { ...running, nodes: [...running.nodes, made] };
  }
  return out;
}

/**
 * The chain after applying a preset.
 *
 * Appends by default: stacking Telephone onto an already-cleaned voice is a
 * real thing to want, and replacing silently would throw away work. Re-applying
 * a preset that is already present replaces ITS OWN nodes in place instead of
 * adding a second copy — which is what `fromPreset` is for, and mirrors how the
 * carve replaces its own bands rather than stacking new ones on hand-added
 * effects.
 */
export function applyAudioFxPreset(
  chain: HfAudioFxChain,
  preset: HfAudioFxPreset,
  options: { replaceChain?: boolean } = {},
): HfAudioFxChain {
  if (options.replaceChain) {
    return {
      version: HF_AUDIO_FX_CHAIN_VERSION,
      nodes: audioFxPresetNodes(preset, { version: HF_AUDIO_FX_CHAIN_VERSION, nodes: [] }),
    };
  }

  const existing = chain.nodes.findIndex((n) => n.fromPreset === preset.id);
  if (existing === -1) {
    return { ...chain, nodes: [...chain.nodes, ...audioFxPresetNodes(preset, chain)] };
  }

  // Re-apply: drop this preset's old nodes, then rebuild them where the first
  // one stood, so the preset keeps its place in the signal order.
  const kept = chain.nodes.filter((n) => n.fromPreset !== preset.id);
  const before = kept.slice(0, existing);
  const after = kept.slice(existing);
  const made = audioFxPresetNodes(preset, { ...chain, nodes: kept });
  return { ...chain, nodes: [...before, ...made, ...after] };
}

/** Every preset whose nodes are still present, for the rack's group braces. */
export function activeAudioFxPresetIds(chain: HfAudioFxChain): string[] {
  const seen: string[] = [];
  for (const node of chain.nodes) {
    if (node.fromPreset && !seen.includes(node.fromPreset)) seen.push(node.fromPreset);
  }
  return seen;
}
