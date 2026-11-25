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

export {
  instantTolerance,
  isInsideSpan,
  sameInstant,
  spansOverlap,
  spansShareTime,
} from "@hyperframes/parsers/time-spans";

const CONTROL_BIDI_OR_LINE_SEPARATOR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export const PROMPT_LABEL_MAX = 160;

const escaped = (character: string) =>
  Array.from(
    { length: character.length },
    (_, i) => `\\u${character.charCodeAt(i).toString(16).padStart(4, "0")}`,
  ).join("");

/** A project value as one quoted line that reads back to exactly the value, so text around it cannot be imitated. */
export function promptField(value: string): string {
  return JSON.stringify(value).replace(CONTROL_BIDI_OR_LINE_SEPARATOR, escaped);
}

/** A display label as one quoted line, its whitespace collapsed and its length capped. */
export function promptLabel(value: string): string {
  const flat = Array.from(
    value.replace(CONTROL_BIDI_OR_LINE_SEPARATOR, " ").replace(/\s+/g, " ").trim(),
  );
  const kept =
    flat.length > PROMPT_LABEL_MAX
      ? `${flat.slice(0, PROMPT_LABEL_MAX - 1).join("")}…`
      : flat.join("");
  return JSON.stringify(kept);
}

export function formatClipLine(clip: ClipFact): string {
  const parts = [
    `${promptField(clip.kind)} ${promptField(clip.id)}`,
    clip.src && `src=${promptField(clip.src)}`,
    `start=${num(clip.start)}`,
    `duration=${num(clip.duration)}`,
    `end=${num(clip.end)}`,
    `track=${clip.trackIndex}`,
    clip.volume !== null && `volume=${num(clip.volume)}`,
    clip.playbackRate !== null && `rate=${num(clip.playbackRate)}`,
    clip.audioGroup && `group=${promptField(clip.audioGroup)}`,
    clip.role && `role=${promptField(clip.role)}`,
    clip.sourceFile && `file=${promptField(clip.sourceFile)}`,
    ...clip.lanes.map(
      (lane) =>
        `lane ${promptField(lane.target)}=[${lane.points.map((p) => `${num(p.t)}:${num(p.v)}`).join(", ")}]`,
    ),
  ];
  return `- ${parts.filter(Boolean).join(" ")}`;
}
