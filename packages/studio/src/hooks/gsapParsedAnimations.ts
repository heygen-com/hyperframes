import type { ParsedGsap } from "@hyperframes/core/gsap-parser";
import { isStudioHoldSet } from "@hyperframes/core/gsap-parser";

export async function fetchParsedAnimations(
  projectId: string,
  sourceFile: string,
): Promise<ParsedGsap | null> {
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/gsap-animations/${encodeURIComponent(sourceFile)}`,
      // Always re-read the freshly-parsed source; no per-call timestamp (which
      // would defeat caching forever and is a deterministic-render no-no).
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const parsed = (await res.json()) as ParsedGsap;
    // Studio-emitted pre-keyframe hold `set`s are an internal runtime detail (they
    // hold an element's first keyframe before its tween). They must not surface as
    // user animations, otherwise they pollute the keyframe cache / timeline diamonds.
    return { ...parsed, animations: parsed.animations.filter((a) => !isStudioHoldSet(a)) };
  } catch {
    return null;
  }
}
