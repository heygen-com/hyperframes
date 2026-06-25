import { useCallback } from "react";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditing";
import { fetchParsedAnimations, getAnimationsForElement } from "./useGsapTweenCache";

// A cold parse is the initial-load race: the endpoint is reachable but its parse
// isn't warm yet (zero total animations). It's worth waiting out (~600ms).
const COLD_PARSE_RETRIES = 5;
const COLD_PARSE_DELAY_MS = 120;
// A hard fetch error (404/403/network/JSON failure → `fetchParsedAnimations`
// returns null) is NOT a parse-warming race, so it shouldn't burn the full
// cold-parse budget. One short retry covers a transient blip; beyond that the
// endpoint genuinely isn't serving this file, so fall through to "no animation".
const FETCH_ERROR_RETRIES = 1;
const FETCH_ERROR_DELAY_MS = 120;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Outcome of resolving an element's animations from a single parse result.
 * - `resolved`: a definitive answer (matched animations, or `[]` when the parse
 *   is warm but this element has no animation — create a new one, don't retry).
 * - `fetch-error`: `fetchParsedAnimations` returned null (HTTP/network/JSON
 *   failure) — retry briefly, not for the full cold-parse budget.
 * - `cold`: the parse came back reachable but with zero total animations — the
 *   initial-load warming race, worth the full cold-parse retry budget.
 */
export type ElementAnimationsOutcome =
  | { kind: "resolved"; animations: GsapAnimation[] }
  | { kind: "fetch-error" }
  | { kind: "cold" };

/**
 * Classify a parse result for one element. Differentiates a hard fetch failure
 * (`parsed === null`) from a warm-but-empty cold parse (`animations.length === 0`)
 * so the caller can apply the right retry budget to each.
 */
export function selectElementAnimationsOrRetry(
  parsed: ParsedGsap | null,
  target: { id: string | null; selector: string | null },
): ElementAnimationsOutcome {
  if (!parsed) return { kind: "fetch-error" };
  if (parsed.animations.length === 0) return { kind: "cold" };
  return { kind: "resolved", animations: getAnimationsForElement(parsed.animations, target) };
}

export function useGsapAnimationFetchFallback(projectId: string | null, gsapSourceFile: string) {
  return useCallback(
    (selection: DomEditSelection) => async (): Promise<GsapAnimation[]> => {
      if (!projectId) return [];
      const target = { id: selection.id ?? null, selector: selection.selector ?? null };
      // A drag can fire before the async parse is warm; a cold parse must retry
      // rather than fall through to the no-animation path (which duplicates the
      // tween). A hard fetch error is a different failure — retry only briefly.
      let coldAttempts = 0;
      let errorAttempts = 0;
      for (;;) {
        const parsed = await fetchParsedAnimations(projectId, gsapSourceFile);
        const outcome = selectElementAnimationsOrRetry(parsed, target);
        if (outcome.kind === "resolved") return outcome.animations;
        if (outcome.kind === "fetch-error") {
          if (errorAttempts >= FETCH_ERROR_RETRIES) return [];
          errorAttempts++;
          await delay(FETCH_ERROR_DELAY_MS);
          continue;
        }
        // cold
        if (coldAttempts >= COLD_PARSE_RETRIES) return [];
        coldAttempts++;
        await delay(COLD_PARSE_DELAY_MS);
      }
    },
    [projectId, gsapSourceFile],
  );
}
