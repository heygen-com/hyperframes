import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "./mediaTypes";
import { roundToCenti } from "./rounding";
import {
  findRootOpenTag,
  patchRootCompositionDuration,
  readDocumentRootDuration,
  readRootCompositionDuration,
} from "./rootDuration";
import {
  furthestClipEndFromDocument,
  furthestClipEndFromSource,
  parseCompositionSource,
} from "../player/lib/timelineElementHelpers";

export const TIMELINE_ASSET_MIME = "application/x-hyperframes-asset";
export const TIMELINE_BLOCK_MIME = "application/x-hyperframes-block";
const FALLBACK_TIMELINE_FILE_DROP_DURATION = 5;

export type TimelineAssetKind = "image" | "video" | "audio";

export function getTimelineAssetKind(assetPath: string): TimelineAssetKind | null {
  if (IMAGE_EXT.test(assetPath)) return "image";
  if (VIDEO_EXT.test(assetPath)) return "video";
  if (AUDIO_EXT.test(assetPath)) return "audio";
  return null;
}

export function buildTimelineAssetId(assetPath: string, existingIds: Iterable<string>): string {
  const baseName = assetPath.split("/").pop() ?? "asset";
  const normalized = baseName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const baseId = normalized || "asset";
  const ids = new Set(existingIds);
  if (!ids.has(baseId)) return baseId;
  let suffix = 2;
  while (ids.has(`${baseId}_${suffix}`)) suffix += 1;
  return `${baseId}_${suffix}`;
}

export function resolveTimelineAssetSrc(targetPath: string, assetPath: string): string {
  const targetDir = targetPath.includes("/")
    ? targetPath.slice(0, targetPath.lastIndexOf("/"))
    : "";
  if (!targetDir) return assetPath;

  const fromParts = targetDir.split("/").filter(Boolean);
  const toParts = assetPath.split("/").filter(Boolean);
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }

  const up = fromParts.map(() => "..");
  const relative = [...up, ...toParts].join("/");
  return relative || assetPath.split("/").pop() || assetPath;
}

/**
 * Sequence one or more dropped files end-to-end starting at the drop point, all on
 * the track the user dropped onto. The clip lands where the ghost showed it — we do
 * NOT bump to a different track on overlap (that produced surprise "new tracks" and,
 * because it jumped past high indices like a grain-overlay track, wild numbers).
 * HyperFrames allows time-overlap on a track; the user can nudge if they want a gap.
 */
export function buildTimelineFileDropPlacements(
  placement: { start: number; track: number },
  durations: number[],
): Array<{ start: number; track: number }> {
  let nextStart = roundToCenti(Math.max(0, placement.start));
  return durations.map((rawDuration) => {
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : FALLBACK_TIMELINE_FILE_DROP_DURATION;
    const start = nextStart;
    nextStart = roundToCenti(nextStart + duration);
    return { start, track: placement.track };
  });
}

export function resolveTimelineAssetCompositionSize(source: string): {
  width: number;
  height: number;
} {
  const width = Number.parseFloat(source.match(/\bdata-width=(["'])([^"']+)\1/i)?.[2] ?? "");
  const height = Number.parseFloat(source.match(/\bdata-height=(["'])([^"']+)\1/i)?.[2] ?? "");
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 640,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 360,
  };
}

/**
 * CapCut-style placement: natural size when it fits, scaled-to-fit when
 * oversized, always centered. Unknown natural size → full-frame.
 */
export function fitTimelineAssetGeometry(
  natural: { width: number; height: number } | null,
  comp: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { left: 0, top: 0, width: comp.width, height: comp.height };
  }
  const scale = Math.min(1, comp.width / natural.width, comp.height / natural.height);
  const width = Math.round(natural.width * scale);
  const height = Math.round(natural.height * scale);
  return {
    left: Math.round((comp.width - width) / 2),
    top: Math.round((comp.height - height) / 2),
    width,
    height,
  };
}

export function buildTimelineAssetInsertHtml(input: {
  id: string;
  hfId: string;
  assetPath: string;
  kind: TimelineAssetKind;
  start: number;
  duration: number;
  track: number;
  zIndex: number;
  geometry?: { left: number; top: number; width: number; height: number };
  /** Video only: true inserts `data-has-audio="true"` with no `muted`. Unknown or false stays muted. */
  hasAudio?: boolean;
}): string {
  const sharedAttrs = `id="${input.id}" data-hf-id="${input.hfId}" class="clip" src="${input.assetPath}" data-start="${input.start}" data-duration="${input.duration}" data-track-index="${input.track}"`;
  const geometry = input.geometry ?? { left: 0, top: 0, width: 640, height: 360 };
  const visualStyles = `position: absolute; left: ${geometry.left}px; top: ${geometry.top}px; width: ${geometry.width}px; height: ${geometry.height}px; object-fit: contain; z-index: ${input.zIndex}`;

  if (input.kind === "image") {
    return `<img ${sharedAttrs} style="${visualStyles}" />`;
  }

  if (input.kind === "video") {
    // `muted` and `data-has-audio="true"` are mutually exclusive by the lint
    // contract (video_has_audio_but_muted): an audible drop takes the latter.
    const audio = input.hasAudio ? 'data-has-audio="true"' : "muted";
    return `<video ${sharedAttrs} ${audio} playsinline style="${visualStyles}"></video>`;
  }

  return `<audio ${sharedAttrs} data-volume="1" style="z-index: ${input.zIndex}"></audio>`;
}

/**
 * Set the composition root's `data-duration` to `contentEnd` (grow OR shrink) so the
 * timeline length tracks content. No-op when `contentEnd` is not > 0, so an empty
 * timeline keeps its declared duration instead of collapsing to 0.
 */
export function setCompositionDurationToContent(source: string, contentEnd: number): string {
  if (!Number.isFinite(contentEnd) || contentEnd <= 0) return source;
  const rootDur = readRootCompositionDuration(source);
  if (rootDur == null) return source;
  const next = roundToCenti(contentEnd);
  if (rootDur === next) return source;
  return patchRootCompositionDuration(source, String(next));
}

/** The furthest clip end and the live animation end of one file. */
export interface ContentEnd {
  clips: number;
  animation: number;
}

/**
 * The length after an edit, or null to leave it. Derived (it equals the content end before
 * the edit) follows content; hand-set grows only to a clip the edit newly places past it.
 */
export function resolveRootLength(
  length: number | null,
  before: ContentEnd,
  after: ContentEnd,
): number | null {
  // An animation end that became unreadable is unknown, not zero: never cut on it.
  if (before.animation > 0 && !(after.animation > 0)) return null;
  if (
    length == null ||
    !Number.isFinite(length) ||
    roundToCenti(length) === roundToCenti(Math.max(before.clips, before.animation))
  ) {
    return Math.max(after.clips, after.animation);
  }
  const clipsEnd = roundToCenti(after.clips);
  return clipsEnd > roundToCenti(length) && clipsEnd > roundToCenti(before.clips)
    ? after.clips
    : null;
}

export function rootLengthAfterEdit(
  original: string,
  edited: string,
  animationEnd: number,
): number | null {
  const doc = parseCompositionSource(original);
  return resolveRootLength(
    readDocumentRootDuration(doc),
    { clips: furthestClipEndFromDocument(doc), animation: animationEnd },
    { clips: furthestClipEndFromSource(edited), animation: animationEnd },
  );
}

export function writeRootLength(source: string, length: number | null): string {
  return length == null ? source : setCompositionDurationToContent(source, length);
}

/** One length decision for a whole edit of `original`; an unchanged file keeps its length. */
export function syncRootLength(original: string, edited: string, animationEnd: number): string {
  if (edited === original) return edited;
  return writeRootLength(edited, rootLengthAfterEdit(original, edited, animationEnd));
}

export function insertTimelineAssetIntoSource(source: string, assetHtml: string): string {
  const match = findRootOpenTag(source);
  if (!match) {
    throw new Error("No composition root found in target source");
  }
  const insertAt = match.index + match[0].length;
  const lineStart = source.lastIndexOf("\n", match.index);
  const leadingWhitespace = source.slice(lineStart + 1, match.index).match(/^(\s*)/)?.[1] ?? "";
  const childIndent = leadingWhitespace + "  ";
  const indented = assetHtml
    .split("\n")
    .map((line, i) => (i === 0 ? line : childIndent + line))
    .join("\n");
  return `${source.slice(0, insertAt)}\n${childIndent}${indented}${source.slice(insertAt)}`;
}
