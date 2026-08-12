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
  clearParamLane,
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
 * An element's automation lanes, bound to whatever chain it carries.
 *
 * FX lanes need the chain to resolve their target's range, so they are dropped
 * for an element with no chain; a volume lane is always readable.
 */
export function readElementAutomation(el: {
  getAttribute?(name: string): string | null;
}): HfAutomation {
  return readAutomation(el, readChain(el).chain);
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
 * effects as AudioParam ramps, and rescheduled when the attribute is edited or
 * `setRate` reports the transport changed speed.
 */
export interface ElementFxHandle {
  dispose(): void;
  /**
   * Re-aim every booked envelope at a new playback rate.
   *
   * Lanes are committed to absolute context times, so a param scheduled at 1×
   * keeps its original wall-clock plan while the audio underneath runs at the
   * new speed: a lowpass sweeping over 10 clip-seconds, switched to 2×, eats
   * 20 s of material in 10 s of wall clock with the sweep unchanged.
   */
  setRate(rate: number): void;
}

export function attachElementFxChain(
  ctx: BaseAudioContext,
  el: { getAttribute?(name: string): string | null },
  source: AudioNode,
  destination: AudioNode,
  timing?: AutomationTiming,
): ElementFxHandle | null {
  const { chain } = readChain(el);

  // Null means the source runs straight into its gain: an empty chain, or one
  // that could not be realised. Mutable because a structural edit swaps the
  // whole graph rather than re-parameterising it.
  let handle: FxChainHandle | null = null;
  let automated: FxParamTarget[] = [];
  let disposed = false;
  /** Bumped per attach, so a worklet wait that resolves late cannot revive a
   *  chain the element has since moved on from. */
  let workletGeneration = 0;

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
  const attach = (next: HfAudioFxChain, elapsed: number): void => {
    if (next.nodes.length === 0) {
      source.connect(destination);
      return;
    }
    // An AudioWorkletNode cannot be constructed before its processor is
    // registered — it throws, and the whole chain is lost. So a chain holding a
    // limiter, compressor, gate or bitcrush plays dry until the module lands and
    // then takes the ordinary rebuild path.
    //
    // That wait used to return early from the whole function, which left the
    // track with no automation scheduled and no observer on the attribute: adding
    // a compressor to a carved bed killed the carve's envelopes and froze every
    // later edit until the composition reloaded. Rebuilding through the same path
    // an edit uses is what keeps those two working.
    if (chainNeedsWorklets(next) && !audioFxWorkletsReady(ctx)) {
      source.connect(destination);
      const generation = ++workletGeneration;
      void ensureAudioFxWorklets(ctx)
        .then(() => {
          // Stale if the element was disposed or the chain changed while waiting.
          if (disposed || generation !== workletGeneration) return;
          rebuild(readChain(el).chain);
        })
        .catch(() => undefined);
      return;
    }
    try {
      // Where the clip has got to, so a modulated effect resumes at the phase the
      // render would be at rather than restarting its LFO from zero.
      const built = buildFxChain(ctx, next, elapsed);
      source.connect(built.input);
      built.output.connect(destination);
      handle = built;
    } catch {
      source.connect(destination);
    }
  };

  const scheduleFor = (next: HfAudioFxChain, at: AutomationTiming | null): void => {
    automated =
      at && handle
        ? scheduleChainAutomation(readAutomation(el, next), next, handle.nodes, at, handle.presets)
        : [];
  };

  // The reference frame every later reschedule measures from. Mutable because a
  // rate change rebases it: `elapsed` has to stop advancing at the old rate the
  // instant the new one takes effect, or every subsequent edit re-aims the
  // envelope at the wrong clip position.
  let frame: AutomationTiming | null = timing ? { ...timing } : null;

  // `timingNow` is not in scope yet, and does not need to be: nothing has played
  // between the frame being taken and this line.
  attach(chain, frame?.elapsed ?? 0);
  scheduleFor(chain, frame);

  /**
   * Re-aim the envelope at the live playhead. An edit lands mid-playback, so
   * the clip has advanced past the offset the source was scheduled with.
   */
  const timingNow = (): AutomationTiming | null => {
    if (!frame) return null;
    const now = typeof ctx.currentTime === "number" ? ctx.currentTime : frame.scheduledAt;
    return {
      scheduledAt: now,
      elapsed: frame.elapsed + (now - frame.scheduledAt) * frame.rate,
      rate: frame.rate,
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
    attach(next, at?.elapsed ?? 0);
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
      // Clear the booked envelopes before touching the graph. `update` writes each
      // knob straight onto its AudioParam, and a write landing inside a running
      // curve is refused with NotSupportedError unless the param is cancelled
      // first — so an edit made while one was playing threw instead of applying,
      // and the console filled with uncaught errors. The reschedule below puts the
      // envelope back from the current playhead.
      if (automated.length > 0) clearParamLane(automated);
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
    setRate: (rate: number) => {
      const at = timingNow();
      if (disposed || !at || !Number.isFinite(rate) || rate <= 0 || rate === at.rate) return;
      // Rebased at the playhead the OLD rate carried us to, then replayed from
      // there at the new one.
      frame = { ...at, rate };
      cancelParamLane(automated, at.scheduledAt);
      scheduleFor(readChain(el).chain, frame);
    },
    dispose: () => {
      disposed = true;
      observer?.disconnect();
      if (automated.length > 0) {
        cancelParamLane(automated, typeof ctx.currentTime === "number" ? ctx.currentTime : 0);
      }
      handle?.dispose();
    },
  };
}
