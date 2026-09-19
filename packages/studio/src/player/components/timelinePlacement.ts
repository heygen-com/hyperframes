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

export interface PlacementResult {
  track: number;
  start: number;
  cuts: PlacementCut[];
  shifts: PlacementShift[];
}

export interface PlaceClipInput {
  /** Clips already on the target track, the dragged clip excluded. */
  clips: readonly PlacementClip[];
  track: number;
  /** Already snapped; this function never snaps. */
  start: number;
  duration: number;
  mode: PlacementMode;
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/**
 * Premiere's drop rules: an overwrite cuts away the range the clip covers,
 * an insert splits a straddled clip at the drop point and pushes what follows.
 * Nothing moves to another track and nothing is left hidden.
 */
export function placeClip({
  clips,
  track,
  start,
  duration,
  mode,
}: PlaceClipInput): PlacementResult {
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
    if (!overlaps(from, to, clip.start, end)) continue;
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
  return { track, start: from, cuts, shifts };
}
