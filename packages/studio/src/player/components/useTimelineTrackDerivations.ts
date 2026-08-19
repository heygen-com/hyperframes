import { useMemo } from "react";
import type { TimelineElement } from "../store/playerStore";
import { getTrackStyle, type TrackVisualStyle } from "./timelineIcons";

/**
 * Per-render track derivations Timeline.tsx feeds the canvas/lanes: the lane →
 * clip grouping (`tracks`, ascending), per-lane visual styles, the ascending
 * `trackOrder`, and the z-override badge set. Extracted from Timeline.tsx as a
 * cohesive unit (600-line studio cap); each memo keys on the expanded display
 * element set exactly as before.
 */
export function useTimelineTrackDerivations(expandedElements: TimelineElement[]): {
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  trackOrder: number[];
} {
  const tracks = useMemo(() => {
    const map = new Map<number, TimelineElement[]>();
    for (const el of expandedElements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [expandedElements]);

  const trackStyles = useMemo(() => {
    const map = new Map<number, TrackVisualStyle>();
    for (const [trackNum, els] of tracks) {
      map.set(trackNum, getTrackStyle(els[0]?.tag ?? ""));
    }
    return map;
  }, [tracks]);

  const trackOrder = useMemo(() => tracks.map(([trackNum]) => trackNum), [tracks]);

  return { tracks, trackStyles, trackOrder };
}
