import { useCallback } from "react";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditing";
import { fetchParsedAnimations, getAnimationsForElement } from "./useGsapTweenCache";

const COLD_PARSE_RETRIES = 5;
const COLD_PARSE_DELAY_MS = 120;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Decide an element's animations from a parse result, or signal a retry.
 *
 * Returns `null` only when the parse is *cold* (missing or zero total animations)
 * — the initial-load race where the endpoint isn't ready yet, so the caller should
 * retry. A warm parse with no match for this element returns `[]` (the element
 * genuinely has no animation — create a new one, don't retry).
 */
export function selectElementAnimationsOrRetry(
  parsed: ParsedGsap | null,
  target: { id: string | null; selector: string | null },
): GsapAnimation[] | null {
  if (!parsed || parsed.animations.length === 0) return null;
  return getAnimationsForElement(parsed.animations, target);
}

export function useGsapAnimationFetchFallback(projectId: string | null, gsapSourceFile: string) {
  return useCallback(
    (selection: DomEditSelection) => async (): Promise<GsapAnimation[]> => {
      if (!projectId) return [];
      const target = { id: selection.id ?? null, selector: selection.selector ?? null };
      // A drag can fire before the async parse is warm; a cold parse must retry
      // rather than fall through to the no-animation path (which duplicates the tween).
      for (let attempt = 0; ; attempt++) {
        const parsed = await fetchParsedAnimations(projectId, gsapSourceFile);
        const resolved = selectElementAnimationsOrRetry(parsed, target);
        if (resolved !== null) return resolved;
        if (attempt >= COLD_PARSE_RETRIES) return [];
        await delay(COLD_PARSE_DELAY_MS);
      }
    },
    [projectId, gsapSourceFile],
  );
}
