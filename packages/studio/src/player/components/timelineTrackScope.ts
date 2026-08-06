import type { TimelineElement } from "../store/playerStore";

/**
 * The stretch of time a selected track covers, and where to anchor a composer
 * over it.
 *
 * Picking a track is itself the request to work on that track, so it opens the
 * composer rather than leaving the user to find a second gesture. With no
 * narrower time asked for, "this track" means all of it: the first clip's start
 * to the last one's end.
 */

export interface TimelineTrackScope {
  start: number;
  end: number;
  anchorX: number;
  anchorY: number;
}

export function trackScopeRange(
  lane: number | null,
  elements: readonly TimelineElement[],
  /** Where the composer opens, when the caller knows better than the middle. */
  anchor?: { x: number; y: number },
): TimelineTrackScope | null {
  if (lane === null) return null;

  const onTrack = elements.filter((element) => element.track === lane);
  // A track with nothing on it is still a place to add something, so it scopes
  // to the composition's own length rather than to nothing.
  const start = onTrack.length > 0 ? Math.min(...onTrack.map((el) => el.start)) : 0;
  const end =
    onTrack.length > 0
      ? Math.max(...onTrack.map((el) => el.start + el.duration))
      : Math.max(start + 1, ...elements.map((el) => el.start + el.duration), 1);

  return {
    start,
    end,
    anchorX: anchor?.x ?? viewportCentre().x,
    anchorY: anchor?.y ?? viewportCentre().y,
  };
}

/** The composer places itself around this; the middle is a safe default. */
function viewportCentre(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
}
