import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { executeOptimistic } from "../utils/optimisticUpdate";
import type { KeyframeCacheEntry } from "../player/store/playerStore";
import { commitKeyframeAtTimeImpl } from "./gsapKeyframeCommit";
import { readKeyframeSnapshot, writeKeyframeCache } from "./gsapKeyframeCacheHelpers";
import type {
  CommitMutation,
  SafeGsapCommitMutation,
  TrackGsapSaveFailure,
} from "./gsapScriptCommitTypes";

function executeOptimisticKeyframeCacheUpdate(options: {
  sourceFile: string;
  elementId: string | null | undefined;
  apply: (entry: KeyframeCacheEntry) => KeyframeCacheEntry;
  persist: () => Promise<void>;
}): Promise<void> {
  return executeOptimistic<KeyframeCacheEntry | undefined>({
    apply: () => {
      const prev = readKeyframeSnapshot(options.sourceFile, options.elementId);
      if (prev) writeKeyframeCache(options.sourceFile, options.elementId, options.apply(prev));
      return prev;
    },
    persist: options.persist,
    rollback: (prev) => {
      writeKeyframeCache(options.sourceFile, options.elementId, prev);
    },
  });
}

interface GsapKeyframeOpsParams {
  activeCompPath: string | null;
  commitMutation: CommitMutation;
  commitMutationSafely: SafeGsapCommitMutation;
  trackGsapSaveFailure: TrackGsapSaveFailure;
}

export function useGsapKeyframeOps({
  activeCompPath,
  commitMutation,
  commitMutationSafely,
  trackGsapSaveFailure,
}: GsapKeyframeOpsParams) {
  const addKeyframe = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      percentage: number,
      property: string,
      value: number | string,
    ) => {
      const sourceFile = selection.sourceFile || activeCompPath || "index.html";
      const mutation = {
        type: "add-keyframe",
        animationId,
        percentage,
        properties: { [property]: value },
      };
      void executeOptimisticKeyframeCacheUpdate({
        sourceFile,
        elementId: selection.id,
        apply: (prev) => ({
          ...prev,
          keyframes: [...prev.keyframes, { percentage, properties: { [property]: value } }].sort(
            (a, b) => a.percentage - b.percentage,
          ),
        }),
        persist: () =>
          commitMutation(selection, mutation, {
            label: `Add keyframe at ${percentage}%`,
            softReload: true,
          }),
      }).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, `Add keyframe at ${percentage}%`);
      });
    },
    [activeCompPath, commitMutation, trackGsapSaveFailure],
  );

  const addKeyframeBatch = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      percentage: number,
      properties: Record<string, number | string>,
    ) => {
      return commitMutation(
        selection,
        { type: "add-keyframe", animationId, percentage, properties },
        { label: `Add keyframe at ${percentage}%`, softReload: true },
      );
    },
    [commitMutation],
  );

  const removeKeyframe = useCallback(
    (selection: DomEditSelection, animationId: string, percentage: number) => {
      const sourceFile = selection.sourceFile || activeCompPath || "index.html";
      const mutation = { type: "remove-keyframe", animationId, percentage };
      void executeOptimisticKeyframeCacheUpdate({
        sourceFile,
        elementId: selection.id,
        apply: (prev) => ({
          ...prev,
          keyframes: prev.keyframes.filter(
            (kf) => Math.abs((kf.tweenPercentage ?? kf.percentage) - percentage) > 0.2,
          ),
        }),
        persist: () =>
          commitMutation(selection, mutation, {
            label: `Remove keyframe at ${percentage}%`,
            softReload: true,
          }),
      }).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, `Remove keyframe at ${percentage}%`);
      });
    },
    [activeCompPath, commitMutation, trackGsapSaveFailure],
  );

  const convertToKeyframes = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      resolvedFromValues?: Record<string, number | string>,
    ) => {
      return commitMutation(
        selection,
        { type: "convert-to-keyframes", animationId, resolvedFromValues },
        { label: "Convert to keyframes" },
      );
    },
    [commitMutation],
  );

  const removeAllKeyframes = useCallback(
    (selection: DomEditSelection, animationId: string) => {
      commitMutationSafely(
        selection,
        { type: "remove-all-keyframes", animationId },
        { label: "Remove all keyframes", softReload: true },
      );
    },
    [commitMutationSafely],
  );

  const commitKeyframeAtTime = useCallback(
    (
      selection: DomEditSelection,
      absoluteTime: number,
      animations: GsapAnimation[],
      properties: Record<string, number | string>,
    ) => commitKeyframeAtTimeImpl(selection, absoluteTime, animations, properties, commitMutation),
    [commitMutation],
  );

  return {
    addKeyframe,
    addKeyframeBatch,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
    commitKeyframeAtTime,
  };
}
