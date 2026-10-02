/** Plain-field clip facts shared by the Ask-agent prompt, `studio_look` and `hyperframes timeline`. */

export interface ClipLane {
  /** `volume`, or `fx.<nodeId>.<param>`. */
  target: string;
  /** `t` is seconds from the start of the clip, not the composition. */
  points: { t: number; v: number }[];
}

export interface ClipFact {
  id: string;
  label: string | null;
  kind: string;
  start: number;
  duration: number;
  end: number;
  /** The `data-track-index` as written in the source file. */
  trackIndex: number;
  src: string | null;
  sourceFile: string | null;
  /** `null` when `data-volume` is not authored (the clip plays at 1). */
  volume: number | null;
  lanes: ClipLane[];
  /** `null` at normal speed: not authored, or 1 (the manifest defaults it to 1). */
  playbackRate: number | null;
  audioGroup: string | null;
  role: string | null;
}

export const byStart = (a: ClipFact, b: ClipFact) =>
  a.start - b.start || a.trackIndex - b.trackIndex;

const roundTo3 = (n: number) => Math.round(n * 1000) / 1000;

const num = (n: number) => String(roundTo3(n));

export const instantTolerance = (time: number) => 4 * Number.EPSILON * Math.max(1, Math.abs(time));

/** Float sums like 19.8 + 6.4 miss 26.2 by a rounding step; a few steps, scaled to the time, are one instant. */
export function sameInstant(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= instantTolerance(Math.max(Math.abs(a), Math.abs(b)));
}

const isBefore = (a: number, b: number) => a < b && !sameInstant(a, b);

/** For timeline lanes: a zero-length clip inside another still counts, so it gets a lane of its own. */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return isBefore(aStart, bEnd) && isBefore(bStart, aEnd);
}

export function spansShareTime(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return isBefore(Math.max(aStart, bStart), Math.min(aEnd, bEnd));
}

export const isInsideSpan = (time: number, start: number, end: number) =>
  isBefore(start, time) && isBefore(time, end);

export function formatClipLine(clip: ClipFact): string {
  const parts = [
    `${clip.kind} "${clip.id}"`,
    clip.src && `src=${clip.src}`,
    `start=${num(clip.start)}`,
    `duration=${num(clip.duration)}`,
    `end=${num(clip.end)}`,
    `track=${clip.trackIndex}`,
    clip.volume !== null && `volume=${num(clip.volume)}`,
    clip.playbackRate !== null && `rate=${num(clip.playbackRate)}`,
    clip.audioGroup && `group=${clip.audioGroup}`,
    clip.role && `role=${clip.role}`,
    clip.sourceFile && `file=${clip.sourceFile}`,
    ...clip.lanes.map(
      (lane) =>
        `${lane.target}-lane=[${lane.points.map((p) => `${num(p.t)}:${num(p.v)}`).join(", ")}]`,
    ),
  ];
  return `- ${parts.filter(Boolean).join(" ")}`;
}
