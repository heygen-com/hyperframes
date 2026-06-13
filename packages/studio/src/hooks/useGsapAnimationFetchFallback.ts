import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import { fetchParsedAnimations, getAnimationsForElement } from "./useGsapTweenCache";

export function useGsapAnimationFetchFallback(projectId: string | null, gsapSourceFile: string) {
  return useCallback(
    (selection: DomEditSelection) => async () => {
      const pid = projectId;
      if (!pid) return [];
      const parsed = await fetchParsedAnimations(pid, gsapSourceFile);
      if (!parsed) return [];
      return getAnimationsForElement(parsed.animations, {
        id: selection.id ?? null,
        selector: selection.selector ?? null,
      });
    },
    [projectId, gsapSourceFile],
  );
}
