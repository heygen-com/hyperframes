import { useCallback, useEffect, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { getTimelineElementLabel } from "../utils/studioHelpers";
import { trackStudioRazorSplit } from "../telemetry/events";
import { canSplitElementAt, selectSplittableElements } from "../utils/timelineElementSplit";
import { linkedMembersOf } from "../player/components/audioClipLink";
import { isLinkedSelectionOn } from "../utils/linkedClipPreferences";
import { buildAtomicCutIntents, runAtomicCutTransaction } from "../utils/razorSplitTransaction";
import {
  createRazorSplitRefreshGate,
  type QueuedRazorSplit,
  type RazorSplitRefreshGate,
} from "../utils/razorSplitRefreshGate";
import type { RecordEditInput } from "./timelineEditingHelpers";
import { useFreezeFrame } from "./useFreezeFrame";

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

const REFRESH_TIMEOUT_MS = 15_000;

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

  const synchronize = useCallback(() => {
    let failure: unknown;
    try {
      forceReloadSdkSession?.();
    } catch (error) {
      failure = error;
    }
    try {
      reloadPreview();
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }, [forceReloadSdkSession, reloadPreview]);

  const runCut = useCallback(
    async (elements: readonly TimelineElement[], splitTime: number, mode: "single" | "all") => {
      const pid = projectIdRef.current;
      if (!pid || elements.length === 0) return;
      const gate = gateRef.current;
      gate?.arm();
      try {
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
          writeProjectFile,
          recordEdit,
          observeProjectFileVersion,
          synchronize,
        });
        trackStudioRazorSplit({ mode, count: result.splitCount });
        if (result.syncFailed) {
          gate?.flushWithoutRefresh();
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
      } catch (error) {
        gate?.flushWithoutRefresh();
        throw error;
      }
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

  const splitSingle = useCallback(
    async (primary: TimelineElement, splitTime: number) => {
      try {
        const members = linkedMembersOf(
          primary,
          usePlayerStore.getState().elements,
          isLinkedSelectionOn(),
        );
        const result = await runCut(
          members.filter((member) => canSplitElementAt(member, splitTime)),
          splitTime,
          "single",
        );
        if (!result || result.syncFailed) return;
        showToast(`Split ${getTimelineElementLabel(primary)} at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split timeline clip";
        showToast(message, "error");
      }
    },
    [runCut, showToast],
  );

  const splitAll = useCallback(
    async (splitTime: number) => {
      try {
        const splittable = selectSplittableElements(usePlayerStore.getState().elements, splitTime);
        if (splittable.length === 0) return;
        const result = await runCut(splittable, splitTime, "all");
        if (!result || result.syncFailed) return;
        showToast(`Split ${result.splitCount} clips at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split clips";
        showToast(message, "error");
      }
    },
    [runCut, showToast],
  );

  const replayQueuedSplit = useCallback(
    async (item: QueuedRazorSplit) => {
      if (item.mode === "all") {
        await splitAll(item.splitTime);
        return;
      }
      const primary = usePlayerStore
        .getState()
        .elements.find(
          (element) => element.track === item.track && canSplitElementAt(element, item.splitTime),
        );
      if (!primary) return;
      await splitSingle(primary, item.splitTime);
    },
    [splitAll, splitSingle],
  );

  const replayRef = useRef(replayQueuedSplit);
  replayRef.current = replayQueuedSplit;

  const gateRef = useRef<RazorSplitRefreshGate | null>(null);
  gateRef.current ??= createRazorSplitRefreshGate({
    getElements: () => usePlayerStore.getState().elements,
    subscribe: (listener) => usePlayerStore.subscribe(listener),
    replay: (item) => replayRef.current(item),
    timeoutMs: REFRESH_TIMEOUT_MS,
  });
  useEffect(() => () => gateRef.current?.dispose(), []);

  const handleRazorSplit = useCallback(
    async (element: TimelineElement, splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      if (gateRef.current?.offer({ mode: "single", track: element.track, splitTime })) return;
      if (!canSplitElementAt(element, splitTime)) return;
      await splitSingle(element, splitTime);
    },
    [isRecordingRef, splitSingle, showToast],
  );

  const handleRazorSplitAll = useCallback(
    async (splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      if (gateRef.current?.offer({ mode: "all", splitTime })) return;
      await splitAll(splitTime);
    },
    [isRecordingRef, splitAll, showToast],
  );

  const handleFreezeFrame = useFreezeFrame({
    projectId,
    activeCompPath,
    showToast,
    writeProjectFile,
    observeProjectFileVersion,
    recordEdit,
    reloadPreview,
    forceReloadSdkSession,
    isRecordingRef,
  });

  return { handleRazorSplit, handleRazorSplitAll, handleFreezeFrame };
}
