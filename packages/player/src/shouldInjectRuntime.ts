/**
 * Decide whether the player should inject the HyperFrames runtime on the
 * current probe tick.
 *
 * The player polls the loaded iframe every 200ms to discover either:
 *   - a runtime bridge already installed (`window.__hf` / `window.__player`), or
 *   - GSAP timelines registered at `window.__timelines`.
 *
 * Two classes of composition require different injection timing:
 *
 *   Nested — the composition uses `data-composition-src` on child elements to
 *   lazy-load sub-scenes. The runtime is what loads those children, so the
 *   composition cannot possibly render on its own. We inject immediately; if
 *   we waited, an inline pre-runtime `gsap.timeline` (common for authoring a
 *   preview before the runtime rebuilds the master timeline) would register
 *   at `__timelines["main"]` with a partial duration, and the adapter path
 *   would then lock the player into `ready` against that incomplete timeline.
 *
 *   Self-contained — the composition has no nested scenes and ships all of
 *   its animation inline (timelines registered under `__timelines`). These
 *   don't strictly need the runtime; the adapter can drive them directly.
 *   We give the adapter path first shot (a 5-tick grace period) and only
 *   inject the runtime as a fallback if no adapter emerges.
 *
 *   Anime (hyperframesAnime.register) — this *late* injection path (appending
 *   a `<script>` after the document has already loaded) can never help an
 *   anime composition: `hyperframesAnime.register(...)` runs synchronously
 *   during initial parse, so by the time this loop observes the iframe the
 *   call has either already succeeded (a registry is present — nothing to
 *   inject) or already thrown (too late — only the pre-parse path in
 *   composition-probe.ts, driven by needsPreParseRuntime in
 *   runtime-injection.ts, can fix that). Either way this function must never
 *   fire the late path for these compositions.
 */
export interface ProbeState {
  hasRuntime: boolean;
  hasTimelines: boolean;
  hasNestedCompositions: boolean;
  runtimeInjected: boolean;
  attempts: number;
  /** A `hyperframesAnime`/`__hfAnime` registry with at least one entry. Optional
   *  so existing GSAP-only callers/tests are unaffected. */
  hasAnimeRegistrations?: boolean;
}

export function shouldInjectRuntime(state: ProbeState): boolean {
  if (state.hasRuntime || state.runtimeInjected || state.hasAnimeRegistrations) return false;
  if (state.hasNestedCompositions) return true;
  if (state.hasTimelines && state.attempts >= 5) return true;
  return false;
}
