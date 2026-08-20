/**
 * Where in the rack an automation lane's parameter actually lives.
 *
 * A lane names `fx.<nodeId>.<param>`, but the rack does not show one flat list
 * of nodes: the carve is one module standing for the filters it compiled, EQ
 * bands are folded into their own module, and preset runs are collapsible
 * groups. A node id therefore resolves to one of several surfaces, and the
 * caller has to open the RIGHT one — opening `openNode` on a carve band, whose
 * row is filtered out of `handBuilt`, would open nothing at all and read as the
 * click doing nothing.
 */

import { parseAutomationTarget } from "@hyperframes/core/audio-automation";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";

export type AudioFxRevealTarget =
  /** A hand-built effect, addressed by its index in the chain. */
  | { kind: "node"; index: number; nodeId: string }
  /** An EQ module, addressed by the id its bands share. */
  | { kind: "eq"; eqId: string }
  /** A preset run, addressed the way `collapsedRuns` keys it. */
  | { kind: "preset"; runKey: string }
  /** The carve module, which owns every `fromCarve` node collectively. */
  | { kind: "carve" }
  /** The track's own volume — no rack row; the reveal is the rack itself. */
  | { kind: "volume" };

/**
 * Resolve a lane target to the surface that shows it, or null when the chain
 * does not contain it (a stale lane, or one whose effect was removed).
 */
export function audioFxRevealTarget(
  target: string,
  chain: HfAudioFxChain | null,
): AudioFxRevealTarget | null {
  const parsed = parseAutomationTarget(target);
  if (!parsed) return null;
  if (parsed.kind === "volume") return { kind: "volume" };
  if (parsed.kind === "preset") {
    // A preset-level lane names the preset, not a node inside it: find its run
    // by the first node that belongs to it, which is how `runKey` is built.
    const index = (chain?.nodes ?? []).findIndex((node) => node.fromPreset === parsed.presetId);
    return index >= 0 ? { kind: "preset", runKey: `${parsed.presetId}-${index}` } : null;
  }
  const index = (chain?.nodes ?? []).findIndex((node) => node.id === parsed.nodeId);
  const node = index >= 0 ? chain?.nodes[index] : undefined;
  if (!node) return null;
  // Order matters: a carve band can also carry `fromEq`/`fromPreset` tags, and
  // the carve module is the one that actually renders it.
  if (node.fromCarve) return { kind: "carve" };
  if (node.fromEq) return { kind: "eq", eqId: node.fromEq };
  if (node.fromPreset) {
    const first = (chain?.nodes ?? []).findIndex((n) => n.fromPreset === node.fromPreset);
    return { kind: "preset", runKey: `${node.fromPreset}-${first}` };
  }
  return { kind: "node", index, nodeId: parsed.nodeId };
}
