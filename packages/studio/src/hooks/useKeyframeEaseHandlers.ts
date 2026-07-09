import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { CommitMutation } from "./gsapScriptCommitTypes";

export function useKeyframeEaseHandlers({
  domEditSelectionRef,
  commitMutation,
  tryUpdateAnimeKeyframeEase,
}: {
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  commitMutation: CommitMutation;
  tryUpdateAnimeKeyframeEase?: (animationId: string, percentage: number, ease: string) => boolean;
}) {
  const handleUpdateKeyframeEase = useCallback(
    (animationId: string, percentage: number, ease: string) => {
      if (tryUpdateAnimeKeyframeEase?.(animationId, percentage, ease)) return;
      const sel = domEditSelectionRef.current;
      if (!sel) return;
      commitMutation(
        sel,
        {
          type: "update-keyframe",
          animationId,
          percentage,
          properties: {},
          ease,
        },
        { label: "Update keyframe ease", softReload: true },
      );
    },
    [commitMutation, domEditSelectionRef, tryUpdateAnimeKeyframeEase],
  );

  // Apply one ease to every segment at once (AE select-all + F9): set easeEach
  // and strip per-keyframe overrides in a single mutation.
  const handleSetAllKeyframeEases = useCallback(
    (animationId: string, ease: string) => {
      const sel = domEditSelectionRef.current;
      if (!sel) return;
      commitMutation(
        sel,
        {
          type: "update-meta",
          animationId,
          updates: { easeEach: ease, resetKeyframeEases: true },
        },
        { label: "Apply ease to all segments", softReload: true },
      );
    },
    [commitMutation, domEditSelectionRef],
  );

  return { handleUpdateKeyframeEase, handleSetAllKeyframeEases };
}
