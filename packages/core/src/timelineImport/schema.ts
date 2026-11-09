import type { ClipFact } from "../clipFacts.js";
import { parseFps, type Fps } from "../fps.js";

/**
 * A flat editing timeline that a converter writes and `hyperframes init --timeline` reads. Each
 * clip is a `ClipFact`, the same per-clip shape `hyperframes timeline --json` prints, plus the
 * source in-point. The format knows nothing of any editor's own: whatever a converter reads, it
 * writes this. The published JSON Schema is `schemas/timeline-import.json`.
 */
export const TIMELINE_IMPORT_SCHEMA = "hyperframes-timeline/1";

/** Where the JSON Schema for this format is published; the schema's own `$id` is the same URL. */
export const TIMELINE_IMPORT_SCHEMA_URL =
  "https://hyperframes.heygen.com/schema/timeline-import.json";

export type ImportClipKind = "video" | "audio" | "image";

/** The image files a clip plays, as a plain list: one entry per frame, in play order. */
export interface ImportSequence {
  /** Frames per second the images are played at. */
  rate: number;
  /** A path or `file://` URL per frame; an image shown for several frames is listed that often. */
  images: string[];
}

export interface ImportClip extends Pick<
  ClipFact,
  "id" | "label" | "start" | "duration" | "end" | "trackIndex" | "volume" | "playbackRate"
> {
  kind: ImportClipKind;
  /** Media location as written by the source timeline; the importer maps it into `assets/`. */
  src: string;
  /**
   * Where the clip's first frame sits on its source's own clock, in seconds: the file's start
   * timecode for a file that carries one, seconds into the file for one that does not.
   * `init` subtracts the file's own start timecode.
   */
  mediaStart: number;
  /**
   * Where on that same clock the program that wrote the file believes the media file starts, or
   * null. A hint, used only when the media file's own timecode would put `mediaStart` outside it.
   */
  mediaOrigin: number | null;
  /** A video clip keeps its own sound only when true. */
  hasAudio: boolean;
  /** Hold the frame at `mediaStart` for the whole clip (a freeze frame or a 0x speed). */
  freeze: boolean;
  /** Set when the clip plays an image sequence, which the importer encodes into a video. */
  sequence: ImportSequence | null;
}

export interface ImportTransition {
  /** The outgoing clip id, or `null` for a fade from nothing (a gap or the start of the track). */
  from: string | null;
  /** The incoming clip id, or `null` for a fade to nothing. */
  to: string | null;
  /** `inOffset + outOffset`: how long the transition runs. */
  duration: number;
  /** Seconds the transition runs before the cut, so clip `to` starts this early. */
  inOffset: number;
  /** Seconds it runs after the cut, so clip `from` plays this long past its end. */
  outOffset: number;
  /** `dissolve` (alias `crossfade`) is applied; anything else is imported as a hard cut. */
  kind: string;
}

export interface ImportTimeline {
  schema: typeof TIMELINE_IMPORT_SCHEMA;
  fps: Fps;
  width: number | null;
  height: number | null;
  duration: number;
  /** Folder that relative clip paths resolve from (an unpacked bundle), when the source names one. */
  mediaRoot: string | null;
  clips: ImportClip[];
  transitions: ImportTransition[];
  warnings: string[];
}

export type ParseTimelineResult =
  | { ok: true; value: ImportTimeline }
  | { ok: false; error: string };

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isKind = (v: unknown): v is ImportClipKind => v === "video" || v === "audio" || v === "image";

function nullableNum(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return null;
  return isNum(v) ? v : undefined;
}

function parseSequence(raw: unknown, at: string): ImportSequence | null | string {
  if (raw === undefined || raw === null) return null;
  if (!isRec(raw)) return `${at}.sequence is not an object`;
  const { rate, images } = raw;
  if (!isNum(rate) || rate <= 0) return `${at}.sequence.rate must be a number > 0`;
  if (!Array.isArray(images) || images.length === 0) {
    return `${at}.sequence.images must be a non-empty array`;
  }
  if (!images.every((image): image is string => isStr(image) && image !== "")) {
    return `${at}.sequence.images must be non-empty strings`;
  }
  return { rate, images };
}

// One flat check per clip field; splitting scatters the error paths.
// fallow-ignore-next-line complexity
function parseClip(raw: unknown, index: number): ImportClip | string {
  const at = `clips[${index}]`;
  if (!isRec(raw)) return `${at} is not an object`;
  const { id, label, kind, start, duration, end, trackIndex, src, mediaStart } = raw;
  if (!isStr(id) || id === "") return `${at}.id must be a non-empty string`;
  if (!isKind(kind)) return `${at}.kind must be "video", "audio" or "image"`;
  if (!isNum(start) || start < 0) return `${at}.start must be a number >= 0`;
  if (!isNum(duration) || duration <= 0) return `${at}.duration must be a number > 0`;
  if (!isStr(src) || src === "") return `${at}.src must be a non-empty string`;
  if (label !== undefined && label !== null && !isStr(label)) return `${at}.label must be a string`;
  const volume = nullableNum(raw.volume);
  if (volume === undefined || (volume !== null && volume < 0))
    return `${at}.volume must be a number >= 0`;
  const rate = nullableNum(raw.playbackRate);
  if (rate === undefined || (rate !== null && rate <= 0))
    return `${at}.playbackRate must be a number > 0`;
  if (mediaStart !== undefined && (!isNum(mediaStart) || mediaStart < 0)) {
    return `${at}.mediaStart must be a number >= 0`;
  }
  if (
    trackIndex !== undefined &&
    (!isNum(trackIndex) || !Number.isInteger(trackIndex) || trackIndex < 0)
  ) {
    return `${at}.trackIndex must be an integer >= 0`;
  }
  if (end !== undefined && !isNum(end)) return `${at}.end must be a number`;
  for (const flag of ["hasAudio", "freeze"] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") {
      return `${at}.${flag} must be true or false`;
    }
  }
  const mediaOrigin = nullableNum(raw.mediaOrigin);
  if (mediaOrigin === undefined || (mediaOrigin !== null && mediaOrigin < 0)) {
    return `${at}.mediaOrigin must be a number >= 0 or null`;
  }
  const sequence = parseSequence(raw.sequence, at);
  if (typeof sequence === "string") return sequence;
  if (sequence !== null && kind !== "video") return `${at}.sequence only applies to a video clip`;
  return {
    id,
    label: isStr(label) ? label : null,
    kind,
    start,
    duration,
    end: isNum(end) ? end : start + duration,
    trackIndex: isNum(trackIndex) ? trackIndex : 0,
    src,
    mediaStart: isNum(mediaStart) ? mediaStart : 0,
    mediaOrigin,
    volume,
    playbackRate: rate,
    hasAudio: raw.hasAudio === true,
    freeze: raw.freeze === true,
    sequence,
  };
}

// One flat check per transition field.
// fallow-ignore-next-line complexity
function parseTransition(raw: unknown, index: number): ImportTransition | string {
  const at = `transitions[${index}]`;
  if (!isRec(raw)) return `${at} is not an object`;
  const { from, to, duration, kind } = raw;
  const fromId = from === null || from === undefined ? null : from;
  const toId = to === null || to === undefined ? null : to;
  if ((fromId !== null && !isStr(fromId)) || (toId !== null && !isStr(toId))) {
    return `${at}.from and ${at}.to must be clip ids or null`;
  }
  if (fromId === null && toId === null) return `${at} needs a clip on at least one side`;
  const inOffset = nullableNum(raw.inOffset);
  const outOffset = nullableNum(raw.outOffset);
  if (
    inOffset === undefined ||
    outOffset === undefined ||
    (inOffset ?? 0) < 0 ||
    (outOffset ?? 0) < 0
  ) {
    return `${at}.inOffset and ${at}.outOffset must be numbers >= 0`;
  }
  const hasOffsets = raw.inOffset !== undefined || raw.outOffset !== undefined;
  if (duration !== undefined && (!isNum(duration) || duration < 0)) {
    return `${at}.duration must be a number >= 0`;
  }
  if (kind !== undefined && !isStr(kind)) return `${at}.kind must be a string`;
  if (!hasOffsets && !isNum(duration)) {
    return `${at}.duration must be a number >= 0`;
  }
  // Without offsets the transition is centred on the cut, as editors write it.
  const half = isNum(duration) ? duration / 2 : 0;
  const before = hasOffsets ? (inOffset ?? 0) : half;
  const after = hasOffsets ? (outOffset ?? 0) : half;
  return {
    from: fromId,
    to: toId,
    duration: before + after,
    inOffset: before,
    outOffset: after,
    kind: isStr(kind) ? kind : "dissolve",
  };
}

// One flat check per top-level field.
// fallow-ignore-next-line complexity
export function parseTimelineImport(input: unknown): ParseTimelineResult {
  if (!isRec(input)) return { ok: false, error: "timeline must be a JSON object" };
  if (input.schema !== TIMELINE_IMPORT_SCHEMA) {
    return {
      ok: false,
      error: `unsupported schema ${JSON.stringify(input.schema)}; expected "${TIMELINE_IMPORT_SCHEMA}"`,
    };
  }
  const fpsRaw = input.fps;
  let fps: Fps | undefined;
  if (isRec(fpsRaw) && isNum(fpsRaw.num) && isNum(fpsRaw.den) && fpsRaw.den > 0) {
    const parsed = parseFps(`${fpsRaw.num}/${fpsRaw.den}`);
    if (parsed.ok) fps = parsed.value;
  }
  if (!fps) return { ok: false, error: "fps must be {num, den} within the supported range" };

  const width = nullableNum(input.width);
  const height = nullableNum(input.height);
  if (width === undefined || height === undefined || (width ?? 1) <= 0 || (height ?? 1) <= 0) {
    return { ok: false, error: "width and height must be numbers > 0 when present" };
  }
  if (!Array.isArray(input.clips) || input.clips.length === 0) {
    return { ok: false, error: "clips must be a non-empty array" };
  }

  const clips: ImportClip[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of input.clips.entries()) {
    const clip = parseClip(raw, i);
    if (typeof clip === "string") return { ok: false, error: clip };
    if (seen.has(clip.id)) return { ok: false, error: `duplicate clip id "${clip.id}"` };
    seen.add(clip.id);
    clips.push(clip);
  }

  const transitions: ImportTransition[] = [];
  const rawTransitions = input.transitions === undefined ? [] : input.transitions;
  if (!Array.isArray(rawTransitions)) return { ok: false, error: "transitions must be an array" };
  for (const [i, raw] of rawTransitions.entries()) {
    const t = parseTransition(raw, i);
    if (typeof t === "string") return { ok: false, error: t };
    transitions.push(t);
  }

  if (input.mediaRoot !== undefined && input.mediaRoot !== null && !isStr(input.mediaRoot)) {
    return { ok: false, error: "mediaRoot must be a string" };
  }
  const rawWarnings = input.warnings === undefined ? [] : input.warnings;
  if (!Array.isArray(rawWarnings) || !rawWarnings.every(isStr)) {
    return { ok: false, error: "warnings must be an array of strings" };
  }

  const longest = Math.max(...clips.map((c) => c.end));
  const duration = input.duration === undefined ? longest : input.duration;
  if (!isNum(duration) || duration <= 0)
    return { ok: false, error: "duration must be a number > 0" };

  return {
    ok: true,
    value: {
      schema: TIMELINE_IMPORT_SCHEMA,
      fps,
      width,
      height,
      duration: Math.max(duration, longest),
      mediaRoot: isStr(input.mediaRoot) ? input.mediaRoot : null,
      clips,
      transitions,
      warnings: rawWarnings,
    },
  };
}
