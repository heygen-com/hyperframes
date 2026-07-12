/**
 * The forward playback loop for the timeline player.
 *
 * Owns the requestAnimationFrame lifecycle callbacks that drive playback.
 */

import { useCallback } from "react";
import { liveTime, usePlayerStore } from "../store/playerStore";
import type { PlaybackAdapter } from "../lib/playbackTypes";

interface UseTimelinePlayerLoopParams {
  rafRef: React.MutableRefObject<number>;
  reverseRafRef: React.MutableRefObject<number>;
  getAdapter: () => PlaybackAdapter | null;
  setCurrentTime: (v: number) => void;
  setIsPlaying: (v: boolean) => void;
}

interface UseTimelinePlayerLoopResult {
  startRAFLoop: () => void;
  stopRAFLoop: () => void;
  stopReverseLoop: () => void;
}

export function useTimelinePlayerLoop({
  rafRef,
  reverseRafRef,
  getAdapter,
  setCurrentTime,
  setIsPlaying,
}: UseTimelinePlayerLoopParams): UseTimelinePlayerLoopResult {
  const stopReverseLoop = useCallback(() => {
    cancelAnimationFrame(reverseRafRef.current);
  }, [reverseRafRef]);

  const startRAFLoop = useCallback(() => {
    // fallow-ignore-next-line complexity
    const tick = () => {
      const adapter = getAdapter();
      if (adapter) {
        const rawTime = adapter.getTime();
        const dur = adapter.getDuration();
        const time = dur > 0 ? Math.min(rawTime, dur) : rawTime;
        liveTime.notify(time);
        const { inPoint, outPoint } = usePlayerStore.getState();
        const rawLoopEnd = outPoint !== null ? Math.min(outPoint, dur) : dur;
        const rawLoopStart = inPoint !== null ? inPoint : 0;
        const loopEnd = rawLoopStart < rawLoopEnd ? rawLoopEnd : dur;
        const loopStart = rawLoopStart < rawLoopEnd ? rawLoopStart : 0;
        if (time >= loopEnd) {
          if (usePlayerStore.getState().loopEnabled && dur > 0) {
            adapter.seek(loopStart, { keepPlaying: true });
            liveTime.notify(loopStart);
            adapter.play();
            setIsPlaying(true);
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          if (adapter.isPlaying()) adapter.pause();
          setCurrentTime(time);
          setIsPlaying(false);
          cancelAnimationFrame(rafRef.current);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [rafRef, getAdapter, setCurrentTime, setIsPlaying]);

  const stopRAFLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, [rafRef]);

  return { startRAFLoop, stopRAFLoop, stopReverseLoop };
}
