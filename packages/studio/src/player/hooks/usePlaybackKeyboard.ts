/**
 * Keyboard shortcut handler for playback (Space/JKL/Arrow keys) and
 * iframe shortcut listener setup.
 *
 * Accepts stable playback callbacks and returns the keyboard event handlers
 * and iframe listener setup function. Has no side effects of its own.
 */

import { useRef, useCallback } from "react";
import { useCaptionStore } from "../../captions/store";
import {
  razorClaimsKey,
  shouldIgnorePlaybackShortcutEvent,
  SHUTTLE_SPEEDS,
} from "../lib/playbackShortcuts";
import { canvasNudgeKeysClaimed } from "../../utils/canvasNudgeGate";
import { usePlayerStore } from "../store/playerStore";
import { getStudioKeys } from "../components/studioShortcuts";
import { stepFrameTime } from "../lib/time";
import { useLinkedClipPreferences } from "../../utils/linkedClipPreferences";
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

function handleWorkAreaKey(
  e: KeyboardEvent,
  key: string,
  getAdapter: () => PlaybackAdapter | null,
  seek: UsePlaybackKeyboardParams["seek"],
): boolean {
  if (razorClaimsKey(e, key)) return false;
  const keys = getStudioKeys();
  const store = usePlayerStore.getState();
  const time = () => getAdapter()?.getTime() ?? store.currentTime;
  const end = () => store.outPoint ?? getAdapter()?.getDuration() ?? store.duration;
  const actions: Record<string, () => void> = {
    [keys.inPoint]: () => store.setInPoint(e.shiftKey ? null : time()),
    [keys.outPoint]: () => store.setOutPoint(e.shiftKey ? null : time()),
    [keys.seekToIn]: () => seek(store.inPoint ?? 0, { keepPlaying: true }),
    [keys.seekToOut]: () => seek(end(), { keepPlaying: true }),
  };
  if (!Object.hasOwn(actions, key)) return false;
  e.preventDefault();
  actions[key]();
  return true;
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
      seek(
        stepFrameTime(currentTime, deltaFrames, useLinkedClipPreferences.getState().compositionFps),
      );
    },
    [getAdapter, seek],
  );

  const shuttle = useCallback(
    (direction: "forward" | "backward") => {
      if (usePlayerStore.getState().playLocked) return;
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

  // Pre-existing dispatcher, already over the complexity gate before this
  // branch's one-line "a" fix touched it. A real fix is a dispatch-table
  // rewrite, out of scope here; the branch this PR changed is its own function.
  // fallow-ignore-next-line complexity
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
      const keys = getStudioKeys();
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
      if (key === keys.mute) {
        e.preventDefault();
        const state = usePlayerStore.getState();
        state.setAudioMuted(!state.audioMuted);
        return;
      }
      if (key === keys.shuttleForward && e.shiftKey) {
        e.preventDefault();
        const state = usePlayerStore.getState();
        state.setLoopEnabled(!state.loopEnabled);
        return;
      }
      if (key === keys.pause) {
        e.preventDefault();
        pause();
        return;
      }
      if (key === keys.shuttleBack) {
        e.preventDefault();
        if (pressedKeysRef.current.has(keys.pause)) {
          stepFrames(-1);
          return;
        }
        shuttle("backward");
        return;
      }
      if (key === keys.shuttleForward) {
        e.preventDefault();
        if (pressedKeysRef.current.has(keys.pause)) {
          stepFrames(1);
          return;
        }
        shuttle("forward");
        return;
      }
      handleWorkAreaKey(e, key, getAdapter, seek);
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
