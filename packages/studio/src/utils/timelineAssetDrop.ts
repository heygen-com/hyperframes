import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "./mediaTypes";

export const TIMELINE_ASSET_MIME = "application/x-hyperframes-asset";

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
  count: number,
): Array<{ start: number; track: number }> {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    start: placement.start,
    track: placement.track + index,
  }));
}

export function buildTimelineAssetInsertHtml(input: {
  id: string;
  assetPath: string;
  kind: TimelineAssetKind;
  start: number;
  duration: number;
  track: number;
  zIndex: number;
}): string {
  const sharedAttrs = `id="${input.id}" class="clip" src="${input.assetPath}" data-start="${input.start}" data-duration="${input.duration}" data-track-index="${input.track}"`;

  if (input.kind === "image") {
    return `<img ${sharedAttrs} style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; z-index: ${input.zIndex}" />`;
  }

  if (input.kind === "video") {
    return `<video ${sharedAttrs} muted playsinline style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; z-index: ${input.zIndex}"></video>`;
  }

  return `<audio ${sharedAttrs} style="z-index: ${input.zIndex}"></audio>`;
}

export function insertTimelineAssetIntoSource(source: string, assetHtml: string): string {
  const rootOpenTag = /<[^>]*data-composition-id="[^"]+"[^>]*>/i;
  const match = rootOpenTag.exec(source);
  if (!match || match.index == null) {
    throw new Error("No composition root found in target source");
  }
  const insertAt = match.index + match[0].length;
  return `${source.slice(0, insertAt)}${assetHtml}${source.slice(insertAt)}`;
}
