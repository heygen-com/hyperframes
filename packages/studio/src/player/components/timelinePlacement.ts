import { timeRangesOverlap } from "./timelineCollision";

export interface PlacementClip {
  key: string;
  start: number;
  duration: number;
}

export type PlacementMode = "overwrite" | "insert";

/** What placing a clip does to a clip already on the target track. Times are final, in seconds. */
export type PlacementCut =
  | { kind: "remove"; key: string }
  | { kind: "trim-head"; key: string; start: number; duration: number; sourceShift: number }
  | { kind: "trim-tail"; key: string; duration: number }
  | {
      kind: "split";
      key: string;
      headDuration: number;
      tail: { start: number; duration: number; sourceShift: number };
    };

export interface PlacementShift {
  key: string;
  start: number;
}

export interface PlaceClipResult {
  start: number;
  cuts: PlacementCut[];
  shifts: PlacementShift[];
}

export interface PlaceClipInput {
  /** Clips already on the target track, the dragged clip excluded. */
  clips: readonly PlacementClip[];
  /** Already snapped; this function never snaps. */
  start: number;
  duration: number;
  mode: PlacementMode;
}

/**
 * Premiere's drop rules: an overwrite cuts away the range the clip covers, an insert splits
 * a straddled clip at the drop point and pushes what follows. Nothing changes track or hides.
 */
export function placeClip({ clips, start, duration, mode }: PlaceClipInput): PlaceClipResult {
  const from = Math.max(0, start);
  const to = from + duration;
  const cuts: PlacementCut[] = [];
  const shifts: PlacementShift[] = [];

  for (const clip of clips) {
    const end = clip.start + clip.duration;
    if (mode === "insert") {
      if (clip.start >= from) {
        shifts.push({ key: clip.key, start: clip.start + duration });
      } else if (end > from) {
        cuts.push({
          kind: "split",
          key: clip.key,
          headDuration: from - clip.start,
          tail: { start: to, duration: end - from, sourceShift: from - clip.start },
        });
      }
      continue;
    }
    if (!timeRangesOverlap(from, to, clip.start, end)) continue;
    const headKept = clip.start < from;
    const tailKept = end > to;
    if (headKept && tailKept) {
      cuts.push({
        kind: "split",
        key: clip.key,
        headDuration: from - clip.start,
        tail: { start: to, duration: end - to, sourceShift: to - clip.start },
      });
    } else if (headKept) {
      cuts.push({ kind: "trim-tail", key: clip.key, duration: from - clip.start });
    } else if (tailKept) {
      cuts.push({
        kind: "trim-head",
        key: clip.key,
        start: to,
        duration: end - to,
        sourceShift: to - clip.start,
      });
    } else {
      cuts.push({ kind: "remove", key: clip.key });
    }
  }
  return { start: from, cuts, shifts };
}
