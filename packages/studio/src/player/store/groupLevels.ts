// ponytail: mirrors liveTime.ts's plain pub-sub — same throttle-at-the-edge shape.
/** A group's live meter reading, or absent when idle/unknown (never zero). */
export type GroupLevelReading = { level: number; clipped: boolean };

type Listener = (levels: ReadonlyMap<string, GroupLevelReading>) => void;
const listeners = new Set<Listener>();
let latest: ReadonlyMap<string, GroupLevelReading> = new Map();

export const groupLevels = {
  notify: (levels: ReadonlyMap<string, GroupLevelReading>) => {
    latest = levels;
    listeners.forEach((listener) => listener(levels));
  },
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => latest,
};

/** Turns the runtime's `group-levels` postMessage payload into the map `groupLevels.notify` wants. */
export function parseGroupLevelsMessage(
  data: unknown,
): ReadonlyMap<string, GroupLevelReading> | null {
  const levels = (data as { levels?: unknown } | null)?.levels;
  if (!Array.isArray(levels)) return null;
  return new Map(
    (levels as Array<{ groupId: string; level: number; clipped: boolean }>).map((entry) => [
      entry.groupId,
      { level: entry.level, clipped: entry.clipped },
    ]),
  );
}
