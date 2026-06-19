/**
 * Shared pure timing resolver — WS-C.
 *
 * resolveTimings() is the single intended implementation of word-anchored
 * elastic timing, designed to be the one code path that BOTH the preview
 * (session layer in @hyperframes/sdk) and render (timingCompiler.ts +
 * htmlBundler) sides call so they cannot drift apart.
 *
 * NOT YET WIRED: neither path consumes it yet — the anchor-producing inputs
 * (TTS word timings) arrive on the Pacific/backend side, which is deferred.
 * Until a real caller lands, the "preview == render" parity below is a property
 * of the resolver (one pure function) rather than a guarantee the two live
 * paths currently share. Wire it into timingCompiler and session before
 * relying on it for parity.
 *
 * Constraints:
 * - Deterministic + pure: no Date.now(), no Math.random(), no DOM, no I/O.
 * - Never timescale animated content: elastic hold extends the hold window,
 *   not tween durations.
 * - Align-on-adjust: only explicitly anchored elements become word-locked;
 *   un-anchored elements keep their authored start/duration unchanged.
 * - Elastic hold: holdDuration = max(0, slot − (enter + exit)), clamped ≥ 0.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface WordTiming {
  /** Word index (0-based) */
  index: number;
  /** Absolute start time of this word in seconds */
  start: number;
  /** Absolute end time of this word in seconds */
  end: number;
}

export interface ElementAnchor {
  /** Which element this anchor applies to */
  hfId: string;
  /**
   * Index of the word in `wordTimings` this element is anchored to.
   * The element's enterAt = wordTimings[wordIndex].start + enterOffset.
   */
  wordIndex: number;
  /**
   * Offset in seconds from the anchored word's start time to the element's enter.
   * Defaults to 0.
   */
  enterOffset?: number;
  /**
   * The authored enter duration (time from element start until hold begins).
   * Used to compute the hold slot.
   */
  enterDuration: number;
  /**
   * The authored exit duration (time from hold end until element exits).
   * Used to compute the hold slot.
   */
  exitDuration: number;
  /**
   * The "slot" end time: the element must finish by this time.
   * holdDuration = max(0, slotEnd - (enterAt + enterDuration + exitDuration))
   */
  slotEnd: number;
}

export interface AuthoredTiming {
  hfId: string;
  /** Authored data-start value in seconds */
  start: number;
  /** Authored duration in seconds (data-duration or data-end - data-start) */
  duration: number;
}

export interface ResolvedTiming {
  enterAt: number;
  exitAt: number;
  /** Computed elastic hold duration (>= 0). Non-anchored elements have holdDuration = 0. */
  holdDuration: number;
}

export interface ResolveTimingsInput {
  /** All authored element timings (both anchored and un-anchored). */
  elements: AuthoredTiming[];
  /** TTS word timings from the backend. */
  wordTimings: WordTiming[];
  /** The set of elements that are word-anchored. Only these get word-locked. */
  anchors: ElementAnchor[];
}

export type ResolveTimingsResult = Record<string, ResolvedTiming>;

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve element timings for a composition with optional word-anchored elements.
 *
 * Align-on-adjust rule: only elements with an explicit anchor in `anchors` are
 * word-locked. All others keep their authored start/duration unchanged.
 *
 * Elastic hold: for anchored elements, the hold window is expanded to fill the
 * slot without timescaling animated content. The hold duration is:
 *   holdDuration = max(0, slotEnd - (enterAt + enterDuration + exitDuration))
 *
 * @param input - Elements, word timings, and anchor map.
 * @returns A map from hfId to resolved { enterAt, exitAt, holdDuration }.
 */
export function resolveTimings(input: ResolveTimingsInput): ResolveTimingsResult {
  const { elements, wordTimings, anchors } = input;

  // Build anchor lookup by hfId for O(1) access.
  const anchorMap = new Map<string, ElementAnchor>();
  for (const anchor of anchors) {
    anchorMap.set(anchor.hfId, anchor);
  }

  // Build word timing lookup by index for O(1) access.
  const wordMap = new Map<number, WordTiming>();
  for (const wt of wordTimings) {
    wordMap.set(wt.index, wt);
  }

  const result: ResolveTimingsResult = {};

  for (const el of elements) {
    const anchor = anchorMap.get(el.hfId);

    if (anchor === undefined) {
      // Un-anchored: keep authored timing exactly as-is.
      result[el.hfId] = {
        enterAt: el.start,
        exitAt: el.start + el.duration,
        holdDuration: 0,
      };
      continue;
    }

    // Word-anchored: compute enter from the word timing.
    const word = wordMap.get(anchor.wordIndex);
    const wordStart = word !== undefined ? word.start : 0;
    const enterOffset = anchor.enterOffset ?? 0;
    const enterAt = wordStart + enterOffset;

    // Elastic hold: expand hold to fill the slot, clamped >= 0.
    // holdDuration = max(0, slotEnd - (enterAt + enterDuration + exitDuration))
    const holdDuration = Math.max(
      0,
      anchor.slotEnd - (enterAt + anchor.enterDuration + anchor.exitDuration),
    );

    // exitAt = enterAt + enterDuration + hold + exitDuration
    const exitAt = enterAt + anchor.enterDuration + holdDuration + anchor.exitDuration;

    result[el.hfId] = { enterAt, exitAt, holdDuration };
  }

  return result;
}
