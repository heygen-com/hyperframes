/**
 * Manages gesture recording state and commit logic for the Studio.
 * Extracted from App.tsx to keep file sizes under the 600-line limit.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useGestureRecording } from "./useGestureRecording";
import { simplifyGestureSamples } from "../utils/rdpSimplify";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { classifyPropertyGroup } from "@hyperframes/core/gsap-parser";

// Minimal subset of the session used by gesture commit
interface GestureSessionRef {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations?: GsapAnimation[];
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
  // Capture selection at recording start so commit always targets the recorded element,
  // even if the user's selection changes mid-recording.
  const capturedSelectionRef = useRef<DomEditSelection | null>(null);

  // Unmount: clear auto-stop interval
  useEffect(() => () => clearInterval(recordingAutoStopRef.current), []);

  // fallow-ignore-next-line complexity
  const stopAndCommitRecording = useCallback(async () => {
    clearInterval(recordingAutoStopRef.current);
    if (commitInFlightRef.current) {
      return;
    }
    commitInFlightRef.current = true;
    gestureStateRef.current = "idle";
    isGestureRecordingRef.current = false;
    const frozenSamples = gestureRecording.stopRecording();
    const store = usePlayerStore.getState();
    store.setIsPlaying(false);
    try {
      const liveSession = domEditSessionRef.current;
      const sel = capturedSelectionRef.current;
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

      // Per-property epsilon: small-range properties (opacity 0–1, scale ~0.01–10)
      // need a much tighter tolerance than positional properties (x/y in px).
      const simplified = simplifyGestureSamples(frozenSamples, duration, (key) => {
        if (key === "opacity") return 0.01;
        if (key === "scale" || key === "scaleX" || key === "scaleY") return 0.01;
        return 5;
      });
      const sortedPcts = Array.from(simplified.keys()).sort((a, b) => a - b);

      // Ensure a 0% keyframe exists with the element's start-of-recording position
      if (!simplified.has(0) && frozenSamples.length > 0) {
        simplified.set(0, frozenSamples[0]!.properties);
        if (!sortedPcts.includes(0)) sortedPcts.unshift(0);
      }

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
        const hasPositionProps = keyframes.some((kf) =>
          Object.keys(kf.properties).some((k) => classifyPropertyGroup(k) === "position"),
        );
        const allAnims = liveSession.selectedGsapAnimations ?? [];
        const existingPositionTween = hasPositionProps
          ? allAnims.find((a) => a.propertyGroup === "position" && a.targetSelector === selector)
          : undefined;
        if (existingPositionTween) {
          const tweenStart = existingPositionTween.resolvedStart ?? 0;
          const tweenDur = existingPositionTween.duration ?? duration;
          const tweenEnd = tweenStart + tweenDur;
          const recEnd = recStart + duration;

          // Only merge if the recording overlaps the existing tween's time range.
          // No overlap → fall through to add-with-keyframes (creates a separate tween).
          const overlaps = recStart < tweenEnd + 0.05 && recEnd > tweenStart - 0.05;

          if (overlaps) {
            const existingKfs = existingPositionTween.keyframes?.keyframes ?? [];
            const rangeStartPct =
              tweenDur > 0 ? Math.max(0, ((recStart - tweenStart) / tweenDur) * 100) : 0;
            const rangeEndPct =
              tweenDur > 0 ? Math.min(100, ((recEnd - tweenStart) / tweenDur) * 100) : 100;

            const preserved = existingKfs
              .filter(
                (kf) => kf.percentage < rangeStartPct - 0.5 || kf.percentage > rangeEndPct + 0.5,
              )
              .map((kf) => ({
                percentage: kf.percentage,
                properties: kf.properties,
                ...(kf.ease ? { ease: kf.ease } : {}),
              }));

            const mapped = keyframes.map((kf) => ({
              percentage: rangeStartPct + (kf.percentage / 100) * (rangeEndPct - rangeStartPct),
              properties: kf.properties,
            }));

            const merged = [...preserved, ...mapped].sort((a, b) => a.percentage - b.percentage);

            await liveSession.commitMutation(
              {
                type: "replace-with-keyframes",
                animationId: existingPositionTween.id,
                targetSelector: selector,
                position:
                  typeof existingPositionTween.position === "number"
                    ? existingPositionTween.position
                    : tweenStart,
                duration: tweenDur,
                keyframes: merged,
              },
              { label: "Gesture recording (merge)", softReload: true },
            );
          } else {
            await liveSession.commitMutation(
              {
                type: "add-with-keyframes",
                targetSelector: selector,
                position: Math.round(recStart * 1000) / 1000,
                duration: Math.round(duration * 1000) / 1000,
                keyframes,
              },
              { label: "Gesture recording (new range)", softReload: true },
            );
          }
        } else {
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
      }
      showToast(`Recorded ${sortedPcts.length} keyframes`, "info");
    } catch (err) {
      console.error("[GR:error]", err);
      showToast(`Gesture commit failed: ${err}`, "error");
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
    capturedSelectionRef.current = sel;
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
