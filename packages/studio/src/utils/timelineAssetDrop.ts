import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "./mediaTypes";
import { patchRootCompositionDuration, readRootCompositionDuration } from "./rootDuration";
import { roundToCenti } from "./rounding";
import { COMPOSITION_ROOT_OPEN_TAG_RE } from "./compositionPatterns";

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

export function buildTimelineFileDropPlacements(
  placement: { start: number; track: number },
  durations: number[],
  occupiedClips: Array<{ start: number; duration: number; track: number }> = [],
): Array<{ start: number; track: number }> {
  let nextStart = roundToCenti(Math.max(0, placement.start));
  const sequenceStart = nextStart;
  const resolvedDurations = durations.map((duration) =>
    Number.isFinite(duration) && duration > 0 ? duration : FALLBACK_TIMELINE_FILE_DROP_DURATION,
  );
  const sequenceEnd = resolvedDurations.reduce(
    (end, duration) => roundToCenti(end + duration),
    sequenceStart,
  );
  const overlapsDropTrack = occupiedClips.some((clip) => {
    if (clip.track !== placement.track) return false;
    const clipStart = Math.max(0, clip.start);
    const clipEnd = clipStart + Math.max(0, clip.duration);
    return sequenceStart < clipEnd && sequenceEnd > clipStart;
  });
  const track = overlapsDropTrack
    ? Math.max(placement.track, ...occupiedClips.map((clip) => clip.track)) + 1
    : placement.track;

  return resolvedDurations.map((duration) => {
    const start = nextStart;
    nextStart = roundToCenti(nextStart + duration);
    return { start, track };
  });
}

export function resolveTimelineAssetInitialGeometry(source: string): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const width = Number.parseFloat(source.match(/\bdata-width=(["'])([^"']+)\1/i)?.[2] ?? "");
  const height = Number.parseFloat(source.match(/\bdata-height=(["'])([^"']+)\1/i)?.[2] ?? "");

  return {
    left: 0,
    top: 0,
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 640,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 360,
  };
}

export function buildTimelineAssetInsertHtml(input: {
  id: string;
  /** Stable hf-id stamped as data-hf-id by the NLE drop path (optional in the legacy path). */
  hfId?: string;
  assetPath: string;
  kind: TimelineAssetKind;
  start: number;
  duration: number;
  track: number;
  zIndex: number;
  geometry?: { left: number; top: number; width: number; height: number };
}): string {
  const sharedAttrs = `id="${input.id}" class="clip" src="${input.assetPath}" data-start="${input.start}" data-duration="${input.duration}" data-track-index="${input.track}"`;
  const geometry = input.geometry ?? { left: 0, top: 0, width: 640, height: 360 };
  const visualStyles = `position: absolute; left: ${geometry.left}px; top: ${geometry.top}px; width: ${geometry.width}px; height: ${geometry.height}px; object-fit: contain; z-index: ${input.zIndex}`;

  if (input.kind === "image") {
    return `<img ${sharedAttrs} style="${visualStyles}" />`;
  }

  if (input.kind === "video") {
    return `<video ${sharedAttrs} muted playsinline style="${visualStyles}"></video>`;
  }

  return `<audio ${sharedAttrs} style="z-index: ${input.zIndex}"></audio>`;
}

export function insertTimelineAssetIntoSource(source: string, assetHtml: string): string {
  const match = COMPOSITION_ROOT_OPEN_TAG_RE.exec(source);
  if (!match || match.index == null) {
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

/**
 * Set the composition root's `data-duration` to `contentEnd` (grow OR shrink) so the
 * timeline length tracks content — the content-driven counterpart to
 * extendCompositionDurationIfNeeded's grow-only ratchet. Used after edits that can
 * reduce the furthest clip end (delete/trim). No-op when `contentEnd` is not > 0, so
 * an empty timeline keeps its declared duration instead of collapsing to 0.
 */
export function setCompositionDurationToContent(source: string, contentEnd: number): string {
  if (!Number.isFinite(contentEnd) || contentEnd <= 0) return source;
  const rootDur = readRootCompositionDuration(source);
  if (rootDur == null) return source;
  const next = roundToCenti(contentEnd);
  if (rootDur === next) return source;
  return patchRootCompositionDuration(source, String(next));
}

export function extendCompositionDurationIfNeeded(source: string, requiredEnd: number): string {
  const rootDur = readRootCompositionDuration(source);
  if (rootDur == null || !Number.isFinite(rootDur) || requiredEnd <= rootDur) return source;
  return patchRootCompositionDuration(source, String(roundToCenti(requiredEnd)));
}

/**
 * Set the composition root's `data-duration` to `contentEnd` (grow OR shrink) so the
 * timeline length tracks content — the content-driven counterpart to
 * extendCompositionDurationIfNeeded's grow-only ratchet. Used after edits that can
 * reduce the furthest clip end (delete/trim). No-op when `contentEnd` is not > 0, so
 * an empty timeline keeps its declared duration instead of collapsing to 0.
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
