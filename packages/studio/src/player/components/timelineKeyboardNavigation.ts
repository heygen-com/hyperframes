import type { TimelineElement } from "../store/playerStore";

export type TimelineNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function isTimelineNavigationKey(key: string): key is TimelineNavigationKey {
  return NAVIGATION_KEYS.has(key);
}

function midpoint(element: TimelineElement): number {
  return element.start + element.duration / 2;
}

function sorted(elements: readonly TimelineElement[]): TimelineElement[] {
  return [...elements].sort(
    (left, right) => left.start - right.start || midpoint(left) - midpoint(right),
  );
}

/** Model-first roving navigation; mounted DOM is never queried for the destination. */
export function resolveTimelineKeyboardTarget(
  tracks: readonly [number, TimelineElement[]][],
  displayTrackOrder: readonly number[],
  currentIdentity: string,
  key: TimelineNavigationKey,
  pageRows = 6,
): TimelineElement | null {
  const trackMap = new Map(tracks);
  const currentTrackIndex = displayTrackOrder.findIndex((track) =>
    (trackMap.get(track) ?? []).some((element) => (element.key ?? element.id) === currentIdentity),
  );
  if (currentTrackIndex < 0) return null;
  const currentTrack = displayTrackOrder[currentTrackIndex];
  if (currentTrack === undefined) return null;
  const row = sorted(trackMap.get(currentTrack) ?? []);
  const currentIndex = row.findIndex((element) => (element.key ?? element.id) === currentIdentity);
  const current = row[currentIndex];
  if (!current) return null;

  if (key === "Home") return row[0] ?? null;
  if (key === "End") return row.at(-1) ?? null;
  if (key === "ArrowLeft") return row[Math.max(0, currentIndex - 1)] ?? current;
  if (key === "ArrowRight") return row[Math.min(row.length - 1, currentIndex + 1)] ?? current;

  const direction = key === "ArrowUp" || key === "PageUp" ? -1 : 1;
  const distance = key === "PageUp" || key === "PageDown" ? pageRows : 1;
  let destinationIndex = Math.max(
    0,
    Math.min(displayTrackOrder.length - 1, currentTrackIndex + direction * distance),
  );
  while (destinationIndex >= 0 && destinationIndex < displayTrackOrder.length) {
    const destinationTrack = displayTrackOrder[destinationIndex];
    const candidates = destinationTrack === undefined ? [] : (trackMap.get(destinationTrack) ?? []);
    if (candidates.length > 0) {
      return candidates.reduce((nearest, candidate) =>
        Math.abs(midpoint(candidate) - midpoint(current)) <
        Math.abs(midpoint(nearest) - midpoint(current))
          ? candidate
          : nearest,
      );
    }
    destinationIndex += direction;
  }
  return current;
}
