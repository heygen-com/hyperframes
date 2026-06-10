/**
 * Manages gesture recording state and commit logic for the Studio.
 * Extracted from App.tsx to keep file sizes under the 600-line limit.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useGestureRecording } from "./useGestureRecording";
import { simplifyGestureSamples } from "../utils/rdpSimplify";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";

// Minimal subset of the session used by gesture commit
interface GestureSessionRef {
  domEditSelection: DomEditSelection | null;
  commitMutation?: (
    mutation: Record<string, unknown>,
    options: { label: string; softReload?: boolean },
  ) => Promise<void>;
}

interface UseGestureCommitParams {
  domEditSessionRef: React.MutableRefObject<GestureSessionRef>;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  isGestureRecordingRef: React.MutableRefObject<boolean>;
}

export interface UseGestureCommitResult {
  gestureState: "idle" | "recording";
  gestureRecording: ReturnType<typeof useGestureRecording>;
  handleToggleRecording: () => void;
}

// fallow-ignore-next-line complexity
export function useGestureCommit({
  domEditSessionRef,
  previewIframeRef,
  showToast,
  isGestureRecordingRef,
}: UseGestureCommitParams): UseGestureCommitResult {
  const gestureRecording = useGestureRecording();
  const [gestureState, setGestureState] = useState<"idle" | "recording">("idle");
  const gestureStateRef = useRef<"idle" | "recording">("idle");
  const recordingAutoStopRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const recordingStartTimeRef = useRef(0);
  const commitInFlightRef = useRef(false);

  // Unmount: clear auto-stop interval
  useEffect(() => () => clearInterval(recordingAutoStopRef.current), []);

  // fallow-ignore-next-line complexity
  const stopAndCommitRecording = useCallback(async () => {
    clearInterval(recordingAutoStopRef.current);
    if (commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    gestureStateRef.current = "idle";
    isGestureRecordingRef.current = false;
    const frozenSamples = gestureRecording.stopRecording();
    const store = usePlayerStore.getState();
    store.setIsPlaying(false);
    try {
      const liveSession = domEditSessionRef.current;
      const sel = liveSession.domEditSelection;
      if (!sel) {
        if (frozenSamples.length > 2) {
          showToast("Selection lost during recording", "error");
        }
        return;
      }
      const duration = frozenSamples.length > 0 ? frozenSamples[frozenSamples.length - 1]!.time : 0;

      if (frozenSamples.length <= 2) {
        showToast("No gesture detected — move the pointer while recording", "error");
        return;
      }
      if (duration <= 0) {
        showToast("Recording too short — try again", "error");
        return;
      }

      const simplified = simplifyGestureSamples(frozenSamples, duration, 5);
      const sortedPcts = Array.from(simplified.keys()).sort((a, b) => a - b);

      const selector = sel.id ? `#${sel.id}` : sel.selector;
      if (!selector) {
        showToast("Cannot save — element has no selector", "error");
        return;
      }
      if (liveSession.commitMutation) {
        const recStart = recordingStartTimeRef.current;
        const keyframes = sortedPcts.map((pct) => ({
          percentage: pct,
          properties: simplified.get(pct) as Record<string, number | string>,
        }));

        await liveSession.commitMutation(
          {
            type: "add-with-keyframes",
            targetSelector: selector,
            position: Math.round(recStart * 1000) / 1000,
            duration: Math.round(duration * 1000) / 1000,
            keyframes,
          },
          { label: "Gesture recording", softReload: true },
        );
      }
      showToast(`Recorded ${sortedPcts.length} keyframes`, "info");
    } finally {
      store.requestSeek(recordingStartTimeRef.current);
      gestureRecording.clearSamples();
      setGestureState("idle");
      commitInFlightRef.current = false;
    }
  }, [gestureRecording, showToast, isGestureRecordingRef, domEditSessionRef]);

  const handleToggleRecording = useCallback(() => {
    if (gestureStateRef.current === "recording") {
      void stopAndCommitRecording();
      return;
    }
    const sel = domEditSessionRef.current.domEditSelection;
    if (!sel) {
      showToast("Select an element first", "error");
      return;
    }
    const iframe = previewIframeRef.current;
    if (!iframe) {
      showToast("Preview not ready — try again", "error");
      return;
    }

    const store = usePlayerStore.getState();
    recordingStartTimeRef.current = store.currentTime;
    const elStart = Number.parseFloat(sel.dataAttributes?.start ?? "0") || 0;
    const elDur = Number.parseFloat(sel.dataAttributes?.duration ?? "0") || 0;
    const elementEnd = elDur > 0 ? elStart + elDur : undefined;
    gestureRecording.startRecording(sel.element, iframe, elementEnd);
    gestureStateRef.current = "recording";
    isGestureRecordingRef.current = true;
    setGestureState("recording");

    clearInterval(recordingAutoStopRef.current);
    const autoStopAt = elementEnd ?? Infinity;
    recordingAutoStopRef.current = setInterval(() => {
      const { currentTime: t, duration: d } = usePlayerStore.getState();
      const limit = Math.min(autoStopAt, d);
      if (limit > 0 && t >= limit - 0.05) {
        void stopAndCommitRecording();
      }
    }, 100);
  }, [
    gestureRecording,
    showToast,
    stopAndCommitRecording,
    previewIframeRef,
    domEditSessionRef,
    isGestureRecordingRef,
  ]);

  return { gestureState, gestureRecording, handleToggleRecording };
}
