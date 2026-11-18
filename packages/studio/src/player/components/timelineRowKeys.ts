import type { TimelineElement } from "../store/playerStore";
import { resolveElementTrack } from "../../utils/studioHelpers";
import { classifyZone } from "./timelineZones";

type Tracks = readonly (readonly [number, readonly TimelineElement[]])[];
const NO_CLIPS: readonly TimelineElement[] = [];

/** Each row's clips, and its React key: the clips' zone and authored track, which adding a track does not renumber
 * as it does display lanes. Rows sharing one (overlap sub-lanes, expanded children) take a #n suffix in row order. */
export function timelineRows(tracks: Tracks) {
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  const clips = new Map<number, readonly TimelineElement[]>();
  for (const [track, els] of tracks) {
    const base = els[0]
      ? `${classifyZone(els[0])}:${resolveElementTrack(els[0])}`
      : `lane:${track}`;
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    keys.set(track, repeat ? `${base}#${repeat}` : base);
    clips.set(track, els);
  }
  return {
    reactKey: (track: number) => keys.get(track) ?? `lane:${track}`,
    clips: (track: number) => clips.get(track) ?? NO_CLIPS,
  };
}
