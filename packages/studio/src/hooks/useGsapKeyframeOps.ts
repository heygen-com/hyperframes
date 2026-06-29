import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { executeOptimistic } from "../utils/optimisticUpdate";
import {
  sdkGsapKeyframePersist,
  sdkGsapRemoveKeyframePersist,
  sdkGsapRemoveAllKeyframesPersist,
  sdkGsapConvertToKeyframesPersist,
  type CutoverDeps,
} from "../utils/sdkCutover";
import type { KeyframeCacheEntry } from "../player/store/playerStore";
import { commitKeyframeAtTimeImpl } from "./gsapKeyframeCommit";
import {
  clearKeyframeCacheForElement,
  readKeyframeSnapshot,
  writeKeyframeCache,
} from "./gsapKeyframeCacheHelpers";
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

interface SdkKeyframeDeps {
  sdkSession?: Composition | null;
  sdkDeps?: CutoverDeps | null;
}

interface GsapKeyframeOpsParams extends SdkKeyframeDeps {
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
  sdkSession,
  sdkDeps,
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
        // Merge into an existing keyframe at this percentage rather than
        // appending a duplicate — matches addKeyframeToScript, which writes one
        // keyframe per percentage (merging properties).
        apply: (prev) => {
          // Match addKeyframeToScript's merge tolerance (PCT_TOLERANCE = 2 in
          // gsapWriterAcorn): a keyframe added within 2% of an existing one
          // merges on disk, so the optimistic cache must merge it too — else the
          // UI shows a phantom keyframe that vanishes on the next reload.
          const idx = prev.keyframes.findIndex(
            (kf) => Math.abs((kf.tweenPercentage ?? kf.percentage) - percentage) <= 2,
          );
          if (idx >= 0) {
            const keyframes = prev.keyframes.slice();
            keyframes[idx] = {
              ...keyframes[idx],
              properties: { ...keyframes[idx].properties, [property]: value },
            };
            return { ...prev, keyframes };
          }
          return {
            ...prev,
            keyframes: [...prev.keyframes, { percentage, properties: { [property]: value } }].sort(
              (a, b) => a.percentage - b.percentage,
            ),
          };
        },
        persist: async () => {
          if (sdkSession && sdkDeps) {
            const handled = await sdkGsapKeyframePersist(
              sourceFile,
              animationId,
              percentage,
              { [property]: value },
              sdkSession,
              sdkDeps,
              {
                label: `Add keyframe at ${percentage}%`,
                coalesceKey: `gsap:${animationId}:kf:${percentage}`,
              },
            );
            if (handled) return;
          }
          await commitMutation(selection, mutation, {
            label: `Add keyframe at ${percentage}%`,
            softReload: true,
          });
        },
      }).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, `Add keyframe at ${percentage}%`);
      });
    },
    [activeCompPath, commitMutation, trackGsapSaveFailure, sdkSession, sdkDeps],
  );

  const addKeyframeBatch = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      percentage: number,
      properties: Record<string, number | string>,
    ) => {
      if (sdkSession && sdkDeps) {
        const sourceFile = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapKeyframePersist(
          sourceFile,
          animationId,
          percentage,
          properties,
          sdkSession,
          sdkDeps,
          { label: `Add keyframe at ${percentage}%` },
        );
        if (handled) return;
      }
      return commitMutation(
        selection,
        { type: "add-keyframe", animationId, percentage, properties },
        { label: `Add keyframe at ${percentage}%`, softReload: true },
      );
    },
    [commitMutation, activeCompPath, sdkSession, sdkDeps],
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
          // Match the writer's removal tolerance (PCT_TOLERANCE = 2 in
          // gsapWriterAcorn): removing at e.g. 49% drops a keyframe at 50% on
          // disk, so the optimistic cache must drop it too — else the stranded
          // entry is a phantom that vanishes on the next reload (mirror of the
          // add-path tolerance fix).
          keyframes: prev.keyframes.filter(
            (kf) => Math.abs((kf.tweenPercentage ?? kf.percentage) - percentage) > 2,
          ),
        }),
        persist: async () => {
          if (sdkSession && sdkDeps) {
            const handled = await sdkGsapRemoveKeyframePersist(
              sourceFile,
              animationId,
              percentage,
              sdkSession,
              sdkDeps,
              { label: `Remove keyframe at ${percentage}%` },
            );
            if (handled) return;
          }
          await commitMutation(selection, mutation, {
            label: `Remove keyframe at ${percentage}%`,
            softReload: true,
          });
        },
      }).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, `Remove keyframe at ${percentage}%`);
      });
    },
    [activeCompPath, commitMutation, trackGsapSaveFailure, sdkSession, sdkDeps],
  );

  const convertToKeyframes = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      resolvedFromValues?: Record<string, number | string>,
      duration?: number,
    ) => {
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapConvertToKeyframesPersist(
          targetPath,
          animationId,
          resolvedFromValues,
          sdkSession,
          sdkDeps,
          { label: "Convert to keyframes" },
        );
        if (handled) return;
      }
      return commitMutation(
        selection,
        // `duration` only applies when the target is a static `set` (which has
        // none) — it spans the converted keyframes across the element's clip.
        { type: "convert-to-keyframes", animationId, resolvedFromValues, duration },
        { label: "Convert to keyframes" },
      );
    },
    [commitMutation, activeCompPath, sdkSession, sdkDeps],
  );

  const removeAllKeyframes = useCallback(
    async (selection: DomEditSelection, animationId: string) => {
      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      // remove-all-keyframes collapses the tween to a static hold and the commit
      // path doesn't return parsed animations, so the keyframe cache is never
      // refreshed — clear it here so the timeline diamonds disappear immediately.
      const elementId = selection.id ?? selection.selector?.match(/^#([\w-]+)/)?.[1] ?? null;
      if (elementId) clearKeyframeCacheForElement(targetPath, elementId);
      if (sdkSession && sdkDeps) {
        const handled = await sdkGsapRemoveAllKeyframesPersist(
          targetPath,
          animationId,
          sdkSession,
          sdkDeps,
          { label: "Remove all keyframes" },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "remove-all-keyframes", animationId },
        { label: "Remove all keyframes", softReload: true },
      );
    },
    [commitMutationSafely, activeCompPath, sdkSession, sdkDeps],
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
