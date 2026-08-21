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
import { canvasNudgeKeysClaimed } from "../../utils/canvasNudgeGate";
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
  seek: (time: number, options?: { keepPlaying?: boolean }) => void;
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
  const pressedKeysRef = useRef(new Set<string>());
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
      const key = e.key.toLowerCase();
      pressedKeysRef.current.add(key);
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      // A nudgeable canvas selection owns the arrow keys (DomEditOverlay moves
      // the element); frame-stepping would double-handle the same keystroke.
      const arrowStep = e.code === "ArrowLeft" || e.code === "ArrowRight";
      if (arrowStep && canvasNudgeKeysClaimed()) return;
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
      if (key === "m") {
        e.preventDefault();
        const state = usePlayerStore.getState();
        state.setAudioMuted(!state.audioMuted);
        return;
      }
      if (key === "l" && e.shiftKey) {
        e.preventDefault();
        const state = usePlayerStore.getState();
        state.setLoopEnabled(!state.loopEnabled);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        pause();
        return;
      }
      if (key === "j") {
        e.preventDefault();
        if (pressedKeysRef.current.has("k")) {
          stepFrames(-1);
          return;
        }
        shuttle("backward");
        return;
      }
      if (key === "l") {
        e.preventDefault();
        if (pressedKeysRef.current.has("k")) {
          stepFrames(1);
          return;
        }
        shuttle("forward");
        return;
      }
      if (key === "i") {
        e.preventDefault();
        const t = getAdapter()?.getTime() ?? usePlayerStore.getState().currentTime;
        usePlayerStore.getState().setInPoint(e.shiftKey ? null : t);
        return;
      }
      if (key === "o") {
        e.preventDefault();
        const t = getAdapter()?.getTime() ?? usePlayerStore.getState().currentTime;
        usePlayerStore.getState().setOutPoint(e.shiftKey ? null : t);
        return;
      }
      if (key === "a") {
        e.preventDefault();
        seek(usePlayerStore.getState().inPoint ?? 0, { keepPlaying: true });
        return;
      }
      if (key === "e") {
        e.preventDefault();
        const { outPoint } = usePlayerStore.getState();
        seek(outPoint ?? getAdapter()?.getDuration() ?? usePlayerStore.getState().duration, {
          keepPlaying: true,
        });
        return;
      }
    },
    [pause, shuttle, stepFrames, togglePlay, getAdapter, seek],
  );

  const handlePlaybackKeyUp = useCallback((e: KeyboardEvent) => {
    pressedKeysRef.current.delete(e.key.toLowerCase());
  }, []);

  playbackKeyDownRef.current = handlePlaybackKeyDown;
  playbackKeyUpRef.current = handlePlaybackKeyUp;

  // fallow-ignore-next-line complexity
  const attachIframeShortcutListeners = useCallback(() => {
    iframeShortcutCleanupRef.current?.();
    iframeShortcutCleanupRef.current = null;

    let iframeWin: Window | null = null;
    let iframeDoc: Document | null = null;
    try {
      iframeWin = iframeRef.current?.contentWindow ?? null;
      iframeDoc = iframeRef.current?.contentDocument ?? null;
    } catch {
      return;
    }
    if (!iframeWin && !iframeDoc) return;

    const handleIframeKeyDown = (e: KeyboardEvent) => playbackKeyDownRef.current(e);
    const handleIframeKeyUp = (e: KeyboardEvent) => playbackKeyUpRef.current(e);
    try {
      iframeWin?.addEventListener("keydown", handleIframeKeyDown, true);
      iframeWin?.addEventListener("keyup", handleIframeKeyUp, true);
    } catch {
      /* cross-origin iframe */
    }
    iframeDoc?.addEventListener("keydown", handleIframeKeyDown, true);
    iframeDoc?.addEventListener("keyup", handleIframeKeyUp, true);
    iframeShortcutCleanupRef.current = () => {
      try {
        iframeWin?.removeEventListener("keydown", handleIframeKeyDown, true);
        iframeWin?.removeEventListener("keyup", handleIframeKeyUp, true);
      } catch {
        /* cross-origin iframe */
      }
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
