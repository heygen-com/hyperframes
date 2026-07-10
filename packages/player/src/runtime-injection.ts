/**
 * Pure decision + HTML-transform helpers for pre-parse runtime injection.
 *
 * Anime-first compositions call `hyperframesAnime.register(id, timeline, ...)`
 * inline, synchronously, during initial document parse. That global is only
 * installed by the HyperFrames runtime. A raw composition loaded straight into
 * the player's iframe (no runtime present yet) throws a ReferenceError on that
 * call — by the time the probe's normal polling loop (composition-probe.ts)
 * observes the iframe, the call has already run and failed. Appending a
 * `<script>` tag after the fact (the existing late-injection path used for
 * GSAP) cannot help: the register() call already happened.
 *
 * The fix is to inject the runtime *before* the composition's own scripts
 * execute, which means rewriting the HTML and reloading the iframe from that
 * rewritten copy (via `srcdoc`) rather than the original `src`. These two
 * functions isolate the decision ("does this document need that treatment?")
 * and the transform ("rewrite the HTML so the runtime loads first") from the
 * DOM/network orchestration in composition-probe.ts, so both are unit
 * testable without a real iframe or fetch.
 */

export interface PreParseRuntimeState {
  /** `window.__hf` or `window.__player` already present. */
  hasRuntime: boolean;
  /** Non-empty `window.__timelines` (GSAP path) already present. */
  hasTimelines: boolean;
  /** A `hyperframesAnime`/`__hfAnime` registry with at least one entry already present. */
  hasAnimeRegistrations: boolean;
  /** An inline (non-`src`) `<script>` in the iframe document mentions `hyperframesAnime`. */
  referencesHyperframesAnime: boolean;
  /** Pre-parse injection has already been attempted for the current `src`. */
  alreadyAttempted: boolean;
}

/**
 * Decide whether the probe should fetch the composition's `src`, inject the
 * runtime into it pre-parse, and reload the iframe via `srcdoc`.
 *
 * Only true when every other signal has already ruled out both "already
 * working" (a runtime or timeline registry is present) and "already tried"
 * (the loop guard) — and the document positively references the API whose
 * absence is presumably breaking it.
 */
export function needsPreParseRuntime(state: PreParseRuntimeState): boolean {
  if (state.alreadyAttempted) return false;
  if (state.hasRuntime || state.hasTimelines || state.hasAnimeRegistrations) return false;
  return state.referencesHyperframesAnime;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Rewrite composition HTML so the runtime `<script>` loads before any of the
 * document's own scripts, preserving relative-asset resolution.
 *
 * - Inserts `<script src="runtimeUrl">` as the very first child of `<head>`,
 *   creating `<head>` (and `<html>` if even that is missing) when absent.
 * - Inserts `<base href="baseHref">` alongside it, but only if the document
 *   doesn't already declare one — loading the rewritten HTML via `srcdoc`
 *   would otherwise resolve every relative asset against the embedding page's
 *   URL instead of the composition's own directory.
 *
 * Regex-based (matching the existing `injectShaderOptionsIntoSrcdoc` pattern
 * in shader-options.ts) rather than a DOM parse: it never throws on
 * malformed/fragment HTML, it just falls back to prepending a `<head>` block.
 */
export function injectRuntimeIntoHtml(html: string, runtimeUrl: string, baseHref: string): string {
  const baseTag = /<base\b[^>]*>/i.test(html) ? "" : `<base href="${escapeAttr(baseHref)}">`;
  const scriptTag = `<script src="${escapeAttr(runtimeUrl)}"></script>`;
  const injected = `${baseTag}${scriptTag}`;

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${injected}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${injected}</head>`);
  }
  return `<head>${injected}</head>${html}`;
}
