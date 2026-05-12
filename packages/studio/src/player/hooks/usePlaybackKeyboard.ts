/**
 * Keyboard shortcut handler for playback (Space/JKL/Arrow keys) and
 * iframe shortcut listener setup.
 *
 * Accepts stable playback callbacks and returns the keyboard event handlers
 * and iframe listener setup function. Has no side effects of its own.
 */

import { useRef, useCallback } from "react";
import { useCaptionStore } from "../../captions/store";
import { shouldIgnorePlaybackShortcutEvent, SHUTTLE_SPEEDS } from "../lib/playbackShortcuts";
import { usePlayerStore } from "../store/playerStore";
import { stepFrameTime, STUDIO_PREVIEW_FPS } from "../lib/time";
import type { PlaybackAdapter } from "../lib/playbackTypes";

interface UsePlaybackKeyboardParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  shuttleDirectionRef: React.MutableRefObject<"forward" | "backward" | null>;
  shuttleSpeedIndexRef: React.MutableRefObject<number>;
  iframeShortcutCleanupRef: React.MutableRefObject<(() => void) | null>;
  getAdapter: () => PlaybackAdapter | null;
  play: () => void;
  playBackward: (rate: number) => void;
  pause: () => void;
  seek: (time: number) => void;
}

export function usePlaybackKeyboard({
  iframeRef,
  shuttleDirectionRef,
  shuttleSpeedIndexRef,
  iframeShortcutCleanupRef,
  getAdapter,
  play,
  playBackward,
  pause,
  seek,
}: UsePlaybackKeyboardParams) {
  const pressedCodesRef = useRef(new Set<string>());
  const playbackKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const playbackKeyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const stepFrames = useCallback(
    (deltaFrames: number) => {
      const adapter = getAdapter();
      const currentTime = adapter?.getTime() ?? usePlayerStore.getState().currentTime;
      seek(stepFrameTime(currentTime, deltaFrames, STUDIO_PREVIEW_FPS));
    },
    [getAdapter, seek],
  );

  const shuttle = useCallback(
    (direction: "forward" | "backward") => {
      if (shuttleDirectionRef.current === direction) {
        shuttleSpeedIndexRef.current = Math.min(
          shuttleSpeedIndexRef.current + 1,
          SHUTTLE_SPEEDS.length - 1,
        );
      } else {
        shuttleSpeedIndexRef.current = 0;
      }
      const speed = SHUTTLE_SPEEDS[shuttleSpeedIndexRef.current];
      usePlayerStore.getState().setPlaybackRate(speed);
      if (direction === "forward") {
        play();
      } else {
        playBackward(speed);
      }
    },
    [play, playBackward, shuttleDirectionRef, shuttleSpeedIndexRef],
  );

  const togglePlay = useCallback(() => {
    if (usePlayerStore.getState().isPlaying) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  const handlePlaybackKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const captionState = useCaptionStore.getState();
      if (
        shouldIgnorePlaybackShortcutEvent(e, {
          isCaptionEditMode: captionState.isEditMode,
          selectedCaptionSegmentCount: captionState.selectedSegmentIds.size,
        })
      ) {
        return;
      }
      pressedCodesRef.current.add(e.code);
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        stepFrames(e.shiftKey ? -10 : -1);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        stepFrames(e.shiftKey ? 10 : 1);
        return;
      }
      if (e.repeat) return;
      if (e.code === "KeyK") {
        e.preventDefault();
        pause();
        return;
      }
      if (e.code === "KeyJ") {
        e.preventDefault();
        if (pressedCodesRef.current.has("KeyK")) {
          stepFrames(-1);
          return;
        }
        shuttle("backward");
        return;
      }
      if (e.code === "KeyL") {
        e.preventDefault();
        if (pressedCodesRef.current.has("KeyK")) {
          stepFrames(1);
          return;
        }
        shuttle("forward");
      }
    },
    [pause, shuttle, stepFrames, togglePlay],
  );

  const handlePlaybackKeyUp = useCallback((e: KeyboardEvent) => {
    pressedCodesRef.current.delete(e.code);
  }, []);

  playbackKeyDownRef.current = handlePlaybackKeyDown;
  playbackKeyUpRef.current = handlePlaybackKeyUp;

  const attachIframeShortcutListeners = useCallback(() => {
    iframeShortcutCleanupRef.current?.();
    iframeShortcutCleanupRef.current = null;

    const iframeWin = iframeRef.current?.contentWindow;
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeWin && !iframeDoc) return;

    const handleIframeKeyDown = (e: KeyboardEvent) => playbackKeyDownRef.current(e);
    const handleIframeKeyUp = (e: KeyboardEvent) => playbackKeyUpRef.current(e);
    iframeWin?.addEventListener("keydown", handleIframeKeyDown, true);
    iframeWin?.addEventListener("keyup", handleIframeKeyUp, true);
    iframeDoc?.addEventListener("keydown", handleIframeKeyDown, true);
    iframeDoc?.addEventListener("keyup", handleIframeKeyUp, true);
    iframeShortcutCleanupRef.current = () => {
      iframeWin?.removeEventListener("keydown", handleIframeKeyDown, true);
      iframeWin?.removeEventListener("keyup", handleIframeKeyUp, true);
      iframeDoc?.removeEventListener("keydown", handleIframeKeyDown, true);
      iframeDoc?.removeEventListener("keyup", handleIframeKeyUp, true);
    };
  }, [iframeRef, iframeShortcutCleanupRef]);

  return {
    playbackKeyDownRef,
    playbackKeyUpRef,
    attachIframeShortcutListeners,
    togglePlay,
  };
}
