import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { getTimelineElementLabel } from "../utils/studioHelpers";
import { trackStudioRazorSplit } from "../telemetry/events";
import { canSplitElementAt, selectSplittableElements } from "../utils/timelineElementSplit";
import { buildAtomicCutIntents, runAtomicCutTransaction } from "../utils/razorSplitTransaction";
import type { RecordEditInput } from "./timelineEditingHelpers";
import type { PlacementFold } from "../player/components/timelinePlacementCommit";
import { getStudioSaveErrorMessage } from "../utils/studioSaveDiagnostics";

interface UseRazorSplitOptions {
  projectId: string | null;
  // fallow-ignore-next-line code-duplication
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  observeProjectFileVersion?: (path: string, version: string | null) => void;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  forceReloadSdkSession?: () => void;
  isRecordingRef?: React.RefObject<boolean>;
}

export function useRazorSplit({
  projectId,
  activeCompPath,
  showToast,
  writeProjectFile,
  observeProjectFileVersion,
  recordEdit,
  reloadPreview,
  forceReloadSdkSession,
  isRecordingRef,
}: UseRazorSplitOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // skipPreviewReload: true when this cut is one step folded into a drop, whose
  // own single reload (after every step lands) replaces this one — otherwise the
  // preview would show this step's DOM before the next step makes it stale.
  const synchronize = useCallback(
    (skipPreviewReload: boolean) => {
      let failure: unknown;
      try {
        forceReloadSdkSession?.();
      } catch (error) {
        failure = error;
      }
      if (!skipPreviewReload) {
        try {
          reloadPreview();
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure) throw failure;
    },
    [forceReloadSdkSession, reloadPreview],
  );

  const runCut = useCallback(
    async (
      elements: readonly TimelineElement[],
      splitTime: number,
      mode: "single" | "all",
      fold?: PlacementFold,
    ) => {
      const pid = projectIdRef.current;
      if (!pid || elements.length === 0) return;
      const intents = buildAtomicCutIntents(elements, splitTime, activeCompPath);
      const requestedCount = intents.reduce((count, file) => count + file.targets.length, 0);
      const label =
        mode === "single"
          ? "Split timeline clip"
          : `Split ${requestedCount} clips at ${splitTime.toFixed(2)}s`;

      const result = await runAtomicCutTransaction({
        projectId: pid,
        intents,
        label,
        ...fold,
        writeProjectFile,
        recordEdit,
        observeProjectFileVersion,
        synchronize: () => synchronize(Boolean(fold)),
      });
      trackStudioRazorSplit({ mode, count: result.splitCount });
      if (result.syncFailed) {
        showToast(
          "Cut was saved, but Studio could not refresh it. Reload the preview to resynchronize.",
          "error",
        );
      }
      if (result.skippedSelectors.length > 0) {
        showToast(
          `Some animations use non-ID selectors (${result.skippedSelectors.join(", ")}) and were not retargeted`,
          "info",
        );
      }
      return result;
    },
    [
      activeCompPath,
      observeProjectFileVersion,
      recordEdit,
      showToast,
      synchronize,
      writeProjectFile,
    ],
  );

  const handleRazorSplit = useCallback(
    async (element: TimelineElement, splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      if (!canSplitElementAt(element, splitTime)) return;
      try {
        const result = await runCut([element], splitTime, "single");
        if (!result) return;
        if (result.syncFailed) return;
        showToast(`Split ${getTimelineElementLabel(element)} at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split timeline clip";
        showToast(message, "error");
      }
    },
    [isRecordingRef, runCut, showToast],
  );

  /** One cut inside a clip drop: recorded under the drop's fold key, true once it landed. */
  const handlePlacementSplit = useCallback(
    async (element: TimelineElement, splitTime: number, fold: PlacementFold) => {
      try {
        return (await runCut([element], splitTime, "single", fold)) !== undefined;
      } catch (error) {
        showToast(getStudioSaveErrorMessage(error), "error");
        return false;
      }
    },
    [runCut, showToast],
  );

  const handleRazorSplitAll = useCallback(
    async (splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const splittable = selectSplittableElements(usePlayerStore.getState().elements, splitTime);
      if (splittable.length === 0) return;
      try {
        const result = await runCut(splittable, splitTime, "all");
        if (!result) return;
        if (result.syncFailed) return;
        showToast(`Split ${result.splitCount} clips at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split clips";
        showToast(message, "error");
      }
    },
    [isRecordingRef, runCut, showToast],
  );

  return { handleRazorSplit, handleRazorSplitAll, handlePlacementSplit };
}
