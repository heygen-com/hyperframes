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
  HF_AUDIO_AUTOMATION_ATTR,
  parseAutomation,
  resolveAutomation,
  type HfAutomation,
} from "../audioAutomation.js";
import {
  cancelParamLane,
  scheduleChainAutomation,
  type AutomationTiming,
} from "../audio/audioFxAutomation.js";
import type { FxParamTarget } from "../audio/audioFxGraph.js";
import {
  audioFxWorkletsReady,
  buildFxChain,
  chainNeedsWorklets,
  ensureAudioFxWorklets,
} from "../audio/audioFxGraph.js";
import type { FxChainHandle } from "../audio/audioFxGraph.js";

const EMPTY: HfAudioFxChain = { version: 1, nodes: [] };
const NO_AUTOMATION: HfAutomation = { version: 1, lanes: [] };

function readAutomation(
  el: { getAttribute?(name: string): string | null },
  chain: HfAudioFxChain,
): HfAutomation {
  const raw =
    (typeof el.getAttribute === "function" ? el.getAttribute(HF_AUDIO_AUTOMATION_ATTR) : null) ??
    "";
  if (!raw) return NO_AUTOMATION;
  try {
    return resolveAutomation(parseAutomation(raw), chain);
  } catch {
    // Unreadable automation plays the track flat rather than silencing it,
    // matching how an unreadable chain plays dry. The render refuses instead.
    return NO_AUTOMATION;
  }
}

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
 * A track with no chain is wired straight through, but still watched: adding its
 * first effect is then heard without rescheduling the source.
 *
 * With `timing`, the element's automation lanes are scheduled onto the built
 * effects as AudioParam ramps, and rescheduled when the attribute is edited.
 */
export function attachElementFxChain(
  ctx: BaseAudioContext,
  el: { getAttribute?(name: string): string | null },
  source: AudioNode,
  destination: AudioNode,
  timing?: AutomationTiming,
): { dispose(): void } | null {
  const { chain } = readChain(el);

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

  // Null means the source runs straight into its gain: an empty chain, or one
  // that could not be realised. Mutable because a structural edit swaps the
  // whole graph rather than re-parameterising it.
  let handle: FxChainHandle | null = null;
  let automated: FxParamTarget[] = [];

  /** Take the current graph out of the path, leaving the source connected dry. */
  const detach = (): void => {
    try {
      if (handle) {
        source.disconnect(handle.input);
        handle.output.disconnect(destination);
        handle.dispose();
      } else {
        source.disconnect(destination);
      }
    } catch {
      // Already disconnected; nothing to unwind.
    }
    handle = null;
  };

  /**
   * Put `next` in the signal path.
   *
   * A chain that cannot be realised — an unregistered worklet, an unknown
   * effect — plays dry rather than silencing the track.
   */
  const attach = (next: HfAudioFxChain): void => {
    if (next.nodes.length === 0) {
      source.connect(destination);
      return;
    }
    try {
      const built = buildFxChain(ctx, next);
      source.connect(built.input);
      built.output.connect(destination);
      handle = built;
    } catch {
      source.connect(destination);
    }
  };

  const scheduleFor = (next: HfAudioFxChain, at: AutomationTiming | null): void => {
    automated =
      at && handle ? scheduleChainAutomation(readAutomation(el, next), next, handle.nodes, at) : [];
  };

  attach(chain);
  scheduleFor(chain, timing ?? null);

  /**
   * Re-aim the envelope at the live playhead. An edit lands mid-playback, so
   * the clip has advanced past the offset the source was scheduled with.
   */
  const timingNow = (): AutomationTiming | null => {
    if (!timing) return null;
    const now = typeof ctx.currentTime === "number" ? ctx.currentTime : timing.scheduledAt;
    return {
      scheduledAt: now,
      elapsed: timing.elapsed + (now - timing.scheduledAt) * timing.rate,
      rate: timing.rate,
    };
  };

  const rescheduleAutomation = (next: HfAudioFxChain): void => {
    const at = timingNow();
    if (!at) return;
    cancelParamLane(automated, at.scheduledAt);
    scheduleFor(next, at);
  };

  /**
   * Rebuild the graph for a shape change — an effect added, removed, bypassed,
   * or a filter's pole count switched — while the source keeps playing.
   *
   * The source node is untouched, so the audio does not restart; only the
   * effects between it and its gain are replaced. Doing this here is what keeps
   * a structural edit from needing a composition reload, which is what made the
   * audio audibly chop.
   */
  const rebuild = (next: HfAudioFxChain): void => {
    const at = timingNow();
    cancelParamLane(automated, at?.scheduledAt ?? 0);
    detach();
    attach(next);
    scheduleFor(next, at);
  };

  // Follow the attribute while the source plays, so editing a chain is heard
  // without rescheduling the track. A values-only change re-parameterises the
  // running graph and lands on the next 128-sample quantum; anything structural
  // swaps the effects between the source and its gain, leaving the source — and
  // so the playing audio — alone.
  let observer: MutationObserver | null = null;
  const target = el as unknown as Node;
  if (
    typeof MutationObserver !== "undefined" &&
    typeof (target as Element)?.nodeType === "number"
  ) {
    observer = new MutationObserver(() => {
      const next = readChain(el);
      // `update` reports false when the change is structural rather than a new
      // set of values, which is the signal to swap the graph.
      if (!handle || !handle.update(next.chain)) rebuild(next.chain);
      else rescheduleAutomation(next.chain);
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: [HF_AUDIO_FX_ATTR, HF_AUDIO_AUTOMATION_ATTR],
    });
  }

  return {
    dispose: () => {
      observer?.disconnect();
      if (automated.length > 0) {
        cancelParamLane(automated, typeof ctx.currentTime === "number" ? ctx.currentTime : 0);
      }
      handle?.dispose();
    },
  };
}
