/**
 * Live audio FX in preview.
 *
 * The transport plays each track from a decoded AudioBuffer and mutes the
 * `<audio>` element to avoid doubling, so effects are spliced into that graph
 * rather than captured off the element — capturing it would process a stream
 * nothing is listening to.
 *
 * Preview and the offline render call the same graph builders, so what is heard
 * while scrubbing is what gets written.
 */

import { HF_AUDIO_FX_ATTR, parseAudioFxChain, type HfAudioFxChain } from "../audioFx.js";
import { buildFxChain, chainNeedsWorklets, ensureAudioFxWorklets } from "../audio/audioFxGraph.js";
import type { FxChainHandle } from "../audio/audioFxGraph.js";

const EMPTY: HfAudioFxChain = { version: 1, nodes: [] };

function readChain(el: { getAttribute?(name: string): string | null }): {
  chain: HfAudioFxChain;
  raw: string;
} {
  // Callers include the transport, whose element may be any media-like object;
  // anything without getAttribute simply has no chain.
  const raw =
    (typeof el.getAttribute === "function" ? el.getAttribute(HF_AUDIO_FX_ATTR) : null) ?? "";
  if (!raw) return { chain: EMPTY, raw: "" };
  try {
    return { chain: parseAudioFxChain(raw), raw };
  } catch {
    // An unreadable chain plays dry rather than silencing the track.
    return { chain: EMPTY, raw: "" };
  }
}

/**
 * Splice an element's FX chain between a decoded source and its gain stage.
 *
 * The transport plays audio from a decoded AudioBuffer rather than from the
 * `<audio>` element (the element is muted to avoid doubling), so this is the
 * point where effects belong — capturing the element would process a stream
 * nothing is listening to.
 *
 * Returns null when the element carries no chain, leaving the original
 * source-to-gain connection in place.
 */
export function attachElementFxChain(
  ctx: BaseAudioContext,
  el: { getAttribute?(name: string): string | null },
  source: AudioNode,
  destination: AudioNode,
): { dispose(): void } | null {
  const { chain } = readChain(el);
  if (chain.nodes.length === 0) {
    source.connect(destination);
    return null;
  }

  let handle: FxChainHandle;
  try {
    handle = buildFxChain(ctx, chain);
  } catch {
    // A chain we cannot realise plays dry rather than silencing the track.
    source.connect(destination);
    return null;
  }

  source.connect(handle.input);
  handle.output.connect(destination);

  if (chainNeedsWorklets(chain)) {
    // Worklet processors are registered lazily; until the module resolves those
    // nodes pass silence, which is a brief dropout rather than a broken track.
    void ensureAudioFxWorklets(ctx).catch(() => undefined);
  }
  return { dispose: () => handle.dispose() };
}
