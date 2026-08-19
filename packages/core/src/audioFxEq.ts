/**
 * A multi-band EQ, as a composite over effects that already ship.
 *
 * Bass, middle and treble is the most widely understood audio control there is
 * — everyone has used one — which makes it the right answer for an author who
 * would never reach for a parametric filter. It also removes a real failure:
 * without it, a chain shaping two ranges holds two peaking filters that look
 * identical in the rack.
 *
 * Built the way the carve is: one module owning several tagged nodes, rather
 * than a new effect type. Three bands ARE a low shelf, a peaking and a high
 * shelf, so there is nothing new in the graph, nothing new in the render, and
 * an author who opens the details finds exactly the filters they could have
 * added by hand.
 *
 * That is also forced by the registry: parameters are a flat key/value record,
 * so an `eq` effect *type* carrying N bands would need array-shaped params it
 * has no way to express.
 */

import {
  HF_AUDIO_FX_CHAIN_VERSION,
  mintAudioFxNodeId,
  normalizeAudioFxParams,
  type HfAudioFxChain,
  type HfAudioFxNode,
} from "./audioFx.js";

/** A band is one node. `name` is what the fader is labelled, and its handle. */
export interface HfAudioEqBand {
  name: string;
  /** Corner for a shelf, centre for a peak. */
  frequency: number;
  /** The only value a fader moves. Everything else is fixed when the band is made. */
  gain: number;
  q?: number;
  kind: "lowshelf" | "peaking" | "highshelf";
}

/**
 * How far a fader travels. The registry allows ±40 dB on these filters, which
 * is a repair tool's range — a tone control that can bury a track under 40 dB
 * of bass is not a tone control. ±12 is the span a hi-fi offers, and it is
 * enough to fix a voice.
 */
export const HF_AUDIO_EQ_RANGE_DB = 12;

/** Bass, middle, treble — the set nobody needs taught. */
export const HF_AUDIO_EQ_3: readonly HfAudioEqBand[] = [
  { name: "Bass", frequency: 200, gain: 0, kind: "lowshelf" },
  { name: "Middle", frequency: 1000, gain: 0, q: 0.9, kind: "peaking" },
  { name: "Treble", frequency: 4000, gain: 0, kind: "highshelf" },
];

/**
 * Five bands, named from the shared vocabulary the rest of the rack uses — so
 * reaching for the EQ is also how an author learns the words.
 */
export const HF_AUDIO_EQ_5: readonly HfAudioEqBand[] = [
  { name: "Bass", frequency: 160, gain: 0, kind: "lowshelf" },
  { name: "Warmth", frequency: 350, gain: 0, q: 1, kind: "peaking" },
  { name: "Middle", frequency: 1000, gain: 0, q: 0.9, kind: "peaking" },
  { name: "Clarity", frequency: 3000, gain: 0, q: 1, kind: "peaking" },
  { name: "Air", frequency: 9000, gain: 0, kind: "highshelf" },
];

const clampGain = (db: number): number =>
  Number.isFinite(db) ? Math.max(-HF_AUDIO_EQ_RANGE_DB, Math.min(HF_AUDIO_EQ_RANGE_DB, db)) : 0;

/** Realise bands as ordinary nodes, tagged so the module can find them again. */
export function audioEqNodes(
  bands: readonly HfAudioEqBand[],
  eqId: string,
  chain: HfAudioFxChain,
): HfAudioFxNode[] {
  const out: HfAudioFxNode[] = [];
  let running: HfAudioFxChain = { ...chain, nodes: [...chain.nodes] };
  for (const band of bands) {
    const made: HfAudioFxNode = {
      type: band.kind,
      id: mintAudioFxNodeId(running),
      fromEq: eqId,
      // The band name IS the node's job name, so a rack showing the bands
      // individually still reads as words rather than as three filter types.
      label: band.name,
      enabled: true,
      params: normalizeAudioFxParams(band.kind, {
        frequency: band.frequency,
        gain: clampGain(band.gain),
        ...(band.kind === "peaking" ? { q: band.q ?? 1 } : {}),
      }),
    };
    out.push(made);
    running = { ...running, nodes: [...running.nodes, made] };
  }
  return out;
}

/** Add an EQ to a chain. Returns the chain and the id the module addresses it by. */
export function addAudioEq(
  chain: HfAudioFxChain,
  bands: readonly HfAudioEqBand[] = HF_AUDIO_EQ_3,
): { chain: HfAudioFxChain; eqId: string } {
  const taken = new Set(chain.nodes.map((n) => n.fromEq).filter(Boolean));
  let eqId = "eq1";
  for (let i = 1; taken.has(eqId); i += 1) eqId = `eq${i + 1}`;
  return {
    chain: { ...chain, nodes: [...chain.nodes, ...audioEqNodes(bands, eqId, chain)] },
    eqId,
  };
}

/** Every EQ in a chain, in the order their first band appears. */
export function audioEqIds(chain: HfAudioFxChain): string[] {
  const seen: string[] = [];
  for (const node of chain.nodes) {
    if (node.fromEq && !seen.includes(node.fromEq)) seen.push(node.fromEq);
  }
  return seen;
}

/**
 * Read one EQ's bands back out of the chain.
 *
 * The nodes are the truth, not a cached band list: an author can open the
 * details and move a frequency by hand, and the faders have to reflect that
 * rather than silently overwrite it on the next drag.
 */
export function readAudioEqBands(chain: HfAudioFxChain, eqId: string): HfAudioEqBand[] {
  const out: HfAudioEqBand[] = [];
  for (const node of chain.nodes) {
    if (node.fromEq !== eqId) continue;
    if (node.type !== "lowshelf" && node.type !== "peaking" && node.type !== "highshelf") continue;
    const params = node.params ?? {};
    const freq = params["frequency"];
    const gain = params["gain"];
    const q = params["q"];
    out.push({
      name: node.label ?? node.type,
      frequency: typeof freq === "number" ? freq : 1000,
      gain: typeof gain === "number" ? gain : 0,
      ...(typeof q === "number" ? { q } : {}),
      kind: node.type,
    });
  }
  return out;
}

/** Move one fader. Everything else about the band is left alone. */
export function setAudioEqBandGain(
  chain: HfAudioFxChain,
  eqId: string,
  bandName: string,
  gain: number,
): HfAudioFxChain {
  return {
    ...chain,
    nodes: chain.nodes.map((node) =>
      node.fromEq === eqId && node.label === bandName
        ? {
            ...node,
            params: normalizeAudioFxParams(node.type, {
              ...(node.params ?? {}),
              gain: clampGain(gain),
            }),
          }
        : node,
    ),
  };
}

/** Remove a whole EQ, bands and all. */
export function removeAudioEq(chain: HfAudioFxChain, eqId: string): HfAudioFxChain {
  return { ...chain, nodes: chain.nodes.filter((n) => n.fromEq !== eqId) };
}

/**
 * What the module says when it is closed.
 *
 * Named for the bands that were actually moved, so a rack of collapsed modules
 * still reads as a sentence — and an untouched EQ says so rather than listing
 * three zeroes.
 */
export function audioEqSummary(bands: readonly HfAudioEqBand[]): string {
  const moved = bands.filter((b) => Math.abs(b.gain) >= 0.1);
  if (moved.length === 0) return "Flat — nothing changed yet";
  return moved
    .map((b) => `${b.name} ${b.gain > 0 ? "+" : "−"}${Math.abs(Number(b.gain.toFixed(1)))}`)
    .join(", ");
}

export const HF_AUDIO_EQ_CHAIN_VERSION = HF_AUDIO_FX_CHAIN_VERSION;
