/** Plain-field clip facts from the player store; feeds the Ask-agent prompt and `studio_look`. */
import type { TimelineElement } from "../store/playerStore";
import { elementAutomationLanes } from "../components/automationLaneData";
import { roundTo3 } from "../../utils/rounding";

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

/** The store holds preview URLs; the agent edits project files, so drop the origin and preview prefix. */
function projectRelativeSrc(src: string): string {
  return src.replace(/^https?:\/\/[^/]+/, "").replace(/^\/api\/projects\/[^/]+\/preview\//, "");
}

export function describeClip(element: TimelineElement): ClipFact {
  return {
    id: element.domId ?? element.id,
    label: element.label ?? null,
    kind: element.kind ?? element.tag.toLowerCase(),
    start: element.start,
    duration: element.duration,
    end: element.start + element.duration,
    trackIndex: element.authoredTrack ?? element.track,
    src: element.src ? projectRelativeSrc(element.src) : null,
    sourceFile: element.sourceFile ?? null,
    volume: element.volume ?? null,
    lanes: elementAutomationLanes(element).map((lane) => ({
      target: lane.target,
      points: lane.points.map(({ t, v }) => ({ t, v })),
    })),
    playbackRate: element.playbackRate === 1 ? null : (element.playbackRate ?? null),
    audioGroup: element.audioGroup ?? null,
    role: element.timelineRole ?? null,
  };
}

export const byStart = (a: ClipFact, b: ClipFact) =>
  a.start - b.start || a.trackIndex - b.trackIndex;

export function describeClips(elements: readonly TimelineElement[]): ClipFact[] {
  return elements.map(describeClip).sort(byStart);
}

const num = (n: number) => String(roundTo3(n));

function formatClipLine(clip: ClipFact): string {
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

const PROMPT_CLIP_CAP = 200;

/** The Ask-agent prompt's Timeline block; empty when the timeline has no clips. */
export function formatTimelineBlock(elements: readonly TimelineElement[]): string {
  const clips = describeClips(elements);
  if (clips.length === 0) return "";
  const shown = clips.slice(0, PROMPT_CLIP_CAP).map(formatClipLine);
  const more = clips.length - shown.length;
  return [
    "Timeline (composition seconds; lane points are seconds from the clip start):",
    ...shown,
    ...(more > 0 ? [`(${more} more clips not listed)`] : []),
  ].join("\n");
}
