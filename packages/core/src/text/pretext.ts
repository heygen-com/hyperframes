import {
  layout,
  measureLineStats,
  measureNaturalWidth,
  prepare,
  prepareWithSegments,
} from "@chenglou/pretext";

/**
 * The text measurement surface exposed to compositions as
 * `window.__hyperframes.pretext`.
 *
 * Measuring text by writing it into the DOM and reading it back forces a
 * reflow, which is both slow per frame and a determinism risk (the value
 * depends on when you read it). These measure off a canvas instead, so a
 * composition can size a container, pick a font size, or decide a line break
 * at any frame without disturbing layout. `fitTextFontSize` is itself built on
 * `prepare` + `layout`.
 *
 * Note the split, because it decides where you call these: `prepare` (and
 * `prepareWithSegments`) does the real font measurement and needs a canvas, so
 * it only works in a browser, not in Node. Everything downstream of a prepared
 * string is arithmetic and is cheap enough to run per frame.
 *
 * Deliberately omitted from this surface:
 * - `clearCache` and `setLocale` mutate process-global state. A composition
 *   calling either would change how *other* compositions measure, which breaks
 *   the guarantee that the same file renders the same video every time.
 *   Withholding `clearCache` does not strand memory: the cache is keyed by
 *   (segment, font) where segments come from `Intl.Segmenter` at word
 *   granularity, so it grows with the number of distinct *words* a composition
 *   renders, not with frames. A counter or typewriter re-measuring every frame
 *   reuses the same entries. Only genuinely new words allocate, which bounds it
 *   at a composition's vocabulary.
 * - The incremental cursor API (`layoutNextLine`, `walkLineRanges`, and
 *   friends) has no caller yet. Add it when something needs it.
 *
 * @see packages/core/src/runtime/entry.ts for where this is attached.
 */
export const pretext = {
  /** Measure a string for a CSS font (e.g. `"700 48px Inter"`). */
  prepare,
  /** Line count and total height for a prepared string at a given width. */
  layout,
  /** Like `prepare`, but retains segments so widths can be measured. */
  prepareWithSegments,
  /** Line count plus `maxLineWidth` — the widest rendered line. */
  measureLineStats,
  /** Width the string would occupy on a single unwrapped line. */
  measureNaturalWidth,
} as const;
