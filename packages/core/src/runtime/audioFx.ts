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
import {
  audioFxWorkletsReady,
  buildFxChain,
  chainNeedsWorklets,
  ensureAudioFxWorklets,
} from "../audio/audioFxGraph.js";
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

  // An AudioWorkletNode cannot be constructed before its processor is
  // registered — it throws, and the whole chain is lost. So when the chain
  // needs worklets and the module has not landed yet, play dry and swap the
  // graph in once registration resolves.
  if (chainNeedsWorklets(chain) && !audioFxWorkletsReady(ctx)) {
    source.connect(destination);
    let cancelled = false;
    let pending: FxChainHandle | null = null;
    void ensureAudioFxWorklets(ctx)
      .then(() => {
        if (cancelled) return;
        try {
          const late = buildFxChain(ctx, chain);
          source.disconnect(destination);
          source.connect(late.input);
          late.output.connect(destination);
          pending = late;
        } catch {
          // Still unbuildable; the dry connection already stands.
        }
      })
      .catch(() => undefined);
    return {
      dispose: () => {
        cancelled = true;
        pending?.dispose();
      },
    };
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

  // Follow the attribute while the source plays, so dragging a knob is heard
  // without rescheduling the track. Values-only changes re-parameterise the
  // running graph and land on the next 128-sample quantum; a shape change
  // (effect added, bypassed, pole count) cannot be patched in place and waits
  // for the next schedule rather than cutting the audio mid-play.
  let observer: MutationObserver | null = null;
  const target = el as unknown as Node;
  if (
    typeof MutationObserver !== "undefined" &&
    typeof (target as Element)?.nodeType === "number"
  ) {
    observer = new MutationObserver(() => {
      const next = readChain(el);
      if (next.chain.nodes.length > 0) handle.update(next.chain);
    });
    observer.observe(target, { attributes: true, attributeFilter: [HF_AUDIO_FX_ATTR] });
  }

  return {
    dispose: () => {
      observer?.disconnect();
      handle.dispose();
    },
  };
}
