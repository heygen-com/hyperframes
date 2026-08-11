/**
 * Named jobs: the range IS the module.
 *
 * "Shape One Range" has three controls — where, how much, how wide — and no
 * honest way to nominate one of them as the knob that matters. Nominating *how
 * much* is incoherent, because boosting an unspecified frequency means nothing:
 * the range is the first decision, not the second.
 *
 * So the menu offers the decision instead of the machine. Each job is a peaking
 * filter with its frequency already chosen — Reduce Mud, Add Clarity, Soften
 * Harshness — and picking the module IS picking the range, which makes one knob
 * honest rather than a simplification hiding the real choice. It also dissolves
 * the duplicate-name problem at the root: a preset that cuts mud and then lifts
 * clarity used to read "Shape One Range" twice with nothing to tell them apart.
 *
 * Every job here is one the preset catalogue already ships, at the settings it
 * ships them with, so this names the vocabulary the presets were written in
 * rather than inventing a second one. Reasoning in
 * `plans/audio-fx-ux/README.md` §"The hole in the single-knob rule".
 *
 * The frequency is a starting point, not a cage — it is an ordinary peaking node
 * underneath, and Details opens on the same three controls it always had.
 */

import {
  defaultAudioFxParams,
  mintAudioFxNodeId,
  normalizeAudioFxParams,
  type HfAudioFxChain,
  type HfAudioFxNode,
  type HfAudioFxParamValues,
} from "./audioFx.js";

export interface HfAudioFxJob {
  id: string;
  /** What the rack calls the node this makes. */
  label: string;
  /** The complaint that leads here, in the author's words. */
  does: string;
  /** The registry effect underneath. */
  type: string;
  /** Where it acts, and how hard — the decision the author is spared. */
  params: HfAudioFxParamValues;
}

/**
 * Ordered low to high, which is the order an author hears them in: weight and
 * mud at the bottom, clarity and harshness at the top.
 */
export const HF_AUDIO_FX_JOBS: readonly HfAudioFxJob[] = [
  {
    id: "tame-boominess",
    label: "Tame Boominess",
    does: "Too much low-end body — it booms.",
    type: "peaking",
    params: { frequency: 200, gain: -4, q: 1.4 },
  },
  {
    id: "reduce-mud",
    label: "Reduce Mud",
    does: "Muffled, like it is behind cardboard.",
    type: "peaking",
    params: { frequency: 250, gain: -3, q: 1.2 },
  },
  {
    id: "reduce-boxiness",
    label: "Reduce Boxiness",
    does: "Sounds like a small room, or a box.",
    type: "peaking",
    params: { frequency: 400, gain: -3, q: 1.4 },
  },
  {
    id: "add-clarity",
    label: "Add Clarity",
    does: "It is hard to make out — it sits back.",
    type: "peaking",
    params: { frequency: 3000, gain: 2.5, q: 1 },
  },
  {
    id: "soften-harshness",
    label: "Soften Harshness",
    does: "Harsh and tiring to listen to.",
    type: "peaking",
    params: { frequency: 3200, gain: -3, q: 1.6 },
  },
];

export function getAudioFxJob(id: string): HfAudioFxJob | undefined {
  return HF_AUDIO_FX_JOBS.find((job) => job.id === id);
}

/** Effect ids the job list covers, which the add menu offers as jobs instead. */
export const HF_AUDIO_FX_JOB_TYPES: ReadonlySet<string> = new Set(
  HF_AUDIO_FX_JOBS.map((job) => job.type),
);

/**
 * The node a job adds: an ordinary effect carrying the job's name.
 *
 * `label` is the field a preset already uses to name a node for the work it
 * does, so a job needs nothing new — and a job node and a preset node are
 * indistinguishable afterwards, which is right. They are the same idea.
 */
export function audioFxJobNode(job: HfAudioFxJob, chain: HfAudioFxChain): HfAudioFxNode {
  return {
    type: job.type,
    id: mintAudioFxNodeId(chain),
    enabled: true,
    label: job.label,
    // Through the registry, so a job cannot ship a value the effect would clamp
    // or a key it does not have.
    params: normalizeAudioFxParams(job.type, {
      ...defaultAudioFxParams(job.type),
      ...job.params,
    }),
  };
}
