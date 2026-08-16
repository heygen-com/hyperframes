/**
 * A group's live meter reading (0..1 RMS-ish level, whether it just clipped),
 * or null when the group is idle/unknown — never zero for "not playing yet".
 *
 * Mirrors useLivePlayheadTime's shape: the runtime posts readings at its own
 * cadence (only while playing — see `postGroupLevels` in init.ts), this just
 * throttles the re-render, it does not add its own polling loop.
 */
import { useEffect, useRef, useState } from "react";
import { groupLevels, type GroupLevelReading } from "../player/store/groupLevels";

const THROTTLE_MS = 33;

export function useGroupLevel(groupId: string): GroupLevelReading | null {
  const latestRef = useRef<GroupLevelReading | null>(groupLevels.get().get(groupId) ?? null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | 0 = 0;
    const unsubscribe = groupLevels.subscribe((levels) => {
      latestRef.current = levels.get(groupId) ?? null;
      if (!timerId) {
        timerId = setTimeout(() => {
          timerId = 0;
          forceRender((v) => v + 1);
        }, THROTTLE_MS);
      }
    });
    return () => {
      unsubscribe();
      if (timerId) clearTimeout(timerId);
    };
  }, [groupId]);

  return latestRef.current;
}
