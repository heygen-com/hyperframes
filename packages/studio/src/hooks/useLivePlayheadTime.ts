/**
 * The playhead in composition seconds, live while the transport runs.
 *
 * The RAF loop deliberately does not push every frame through the store — it
 * notifies `liveTime` instead, so the playhead can move without re-rendering the
 * app. A panel that wants to follow it therefore has to subscribe itself, and
 * throttle: 30 Hz reads as continuous and costs an order of magnitude less than a
 * render per frame.
 *
 * Paused, the store is the truth — a seek or a scrub lands there — so this returns
 * that instead, which is what lets a readout follow the playhead while it is being
 * dragged as well as while it is playing.
 */
import { useEffect, useState } from "react";
// The store's own module, not the `player` barrel: the barrel pulls the whole
// timeline in, and a timeline component importing this hook closes a cycle.
import { liveTime, usePlayerStore } from "../player/store/playerStore";

/** Long enough to be much cheaper than a frame, short enough to read as motion. */
const THROTTLE_MS = 33;

export function useLivePlayheadTime(): number {
  const storeTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // Null means "nothing heard from this playback run yet", which is why the
  // subscription clears it on teardown: the first frame after the transport
  // starts must never show a time left over from the last time it ran, and the
  // store is the truth up to that point anyway.
  const [runTime, setRunTime] = useState<number | null>(null);

  useEffect(() => {
    if (!isPlaying) return;
    let latest: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | 0 = 0;
    const unsubscribe = liveTime.subscribe((t) => {
      latest = t;
      if (!timerId) {
        timerId = setTimeout(() => {
          timerId = 0;
          setRunTime(latest);
        }, THROTTLE_MS);
      }
    });
    return () => {
      unsubscribe();
      if (timerId) clearTimeout(timerId);
      setRunTime(null);
    };
  }, [isPlaying]);

  return isPlaying ? (runTime ?? storeTime) : storeTime;
}
