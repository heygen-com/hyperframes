/**
 * Lazy `openComposition`.
 *
 * `@hyperframes/sdk` models a composition as a live linkedom document, so a
 * static import drags linkedom + htmlparser2 / css-select / domutils / cssom /
 * entities (~410KB of module graph) into the studio's eagerly-loaded bundle —
 * bytes the browser downloads before first paint even though nothing parses a
 * composition until a session opens or an edit runs.
 *
 * Every openComposition call site is already inside an `async` function that
 * awaits the result, so routing them through this module defers the whole stack
 * to its own chunk at zero behavioural cost. Import `openComposition` from here,
 * never from `@hyperframes/sdk` directly — one static import anywhere on the
 * eager graph puts all of it back. (Type-only imports are erased and are fine.)
 *
 * Same pattern as `player/lib/mediaProbe.ts` does for mediabunny.
 */
import type { Composition, OpenCompositionOptions } from "@hyperframes/sdk";

export async function openComposition(
  html: string,
  opts?: OpenCompositionOptions,
): Promise<Composition> {
  const sdk = await import("@hyperframes/sdk");
  return sdk.openComposition(html, opts);
}
