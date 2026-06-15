import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { executeOptimistic } from "../utils/optimisticUpdate";
import { sdkGsapKeyframePersist } from "../utils/sdkCutover";
import type { KeyframeCacheEntry } from "../player/store/playerStore";
import { commitKeyframeAtTimeImpl } from "./gsapKeyframeCommit";
import { readKeyframeSnapshot, writeKeyframeCache } from "./gsapKeyframeCacheHelpers";
import type {
  CommitMutation,
  SafeGsapCommitMutation,
  TrackGsapSaveFailure,
} from "./gsapScriptCommitTypes";
import type { EditHistoryKind } from "../utils/editHistory";

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
  writeProjectFile?: (path: string, content: string) => Promise<void>;
  editHistory?: {
    recordEdit: (entry: {
      label: string;
      kind: EditHistoryKind;
      coalesceKey?: string;
      files: Record<string, { before: string; after: string }>;
    }) => Promise<void>;
  };
  reloadPreview?: () => void;
  domEditSaveTimestampRef?: React.MutableRefObject<number>;
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
  writeProjectFile,
  editHistory,
  reloadPreview,
  domEditSaveTimestampRef,
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
        persist: async () => {
          if (
            sdkSession &&
            writeProjectFile &&
            editHistory &&
            reloadPreview &&
            domEditSaveTimestampRef
          ) {
            const handled = await sdkGsapKeyframePersist(
              sourceFile,
              animationId,
              percentage,
              { [property]: value },
              sdkSession,
              { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
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
    [
      activeCompPath,
      commitMutation,
      trackGsapSaveFailure,
      sdkSession,
      writeProjectFile,
      editHistory,
      reloadPreview,
      domEditSaveTimestampRef,
    ],
  );

  const addKeyframeBatch = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      percentage: number,
      properties: Record<string, number | string>,
    ) => {
      if (
        sdkSession &&
        writeProjectFile &&
        editHistory &&
        reloadPreview &&
        domEditSaveTimestampRef
      ) {
        const sourceFile = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapKeyframePersist(
          sourceFile,
          animationId,
          percentage,
          properties,
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
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
    [
      commitMutation,
      activeCompPath,
      sdkSession,
      writeProjectFile,
      editHistory,
      reloadPreview,
      domEditSaveTimestampRef,
    ],
  );

  const removeKeyframe = useCallback(
    (selection: DomEditSelection, animationId: string, percentage: number) => {
      // ponytail: SDK removeGsapKeyframe uses keyframeIndex (not percentage); mismatch with
      // Studio's percentage-based API. Resolving index requires parsing GSAP state at call
      // time — deferred. removeKeyframe stays server-authoritative.
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
      // ponytail: no SDK equivalent; convertToKeyframes stays server-authoritative (T6f scope)
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
      // ponytail: no SDK equivalent for remove-all-keyframes; stays server-authoritative
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
