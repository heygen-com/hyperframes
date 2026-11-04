import { setFrameField } from "./editStoryboard.js";
import { parseStoryboard } from "./parseStoryboard.js";
import type { StoryboardManifest } from "./types.js";

export const STORYBOARD_FRAME_ID_RE = /^[0-9a-f]{32}$/;

export function assertFrameIdentities(manifest: StoryboardManifest, requireAll = true): void {
  if (manifest.warnings.some((warning) => warning.code !== undefined)) {
    throw new Error("Invalid or duplicate storyboard frame_id metadata");
  }
  const seen = new Set<string>();
  for (const frame of manifest.frames) {
    if (frame.frameId === undefined && !requireAll) continue;
    if (!frame.frameId || !STORYBOARD_FRAME_ID_RE.test(frame.frameId) || seen.has(frame.frameId)) {
      throw new Error(`Frame ${frame.index} needs a unique persisted frame_id`);
    }
    seen.add(frame.frameId);
  }
}

/** The caller must persist the returned Markdown before using its IDs for review. */
export function assignMissingFrameIds(source: string, createId: () => string): string {
  const manifest = parseStoryboard(source);
  assertFrameIdentities(manifest, false);
  const ids = new Set(manifest.frames.flatMap((frame) => (frame.frameId ? [frame.frameId] : [])));
  let updated = source;
  for (const frame of manifest.frames) {
    if (frame.frameId !== undefined) continue;
    const id = createId();
    if (!STORYBOARD_FRAME_ID_RE.test(id) || ids.has(id))
      throw new Error("Frame ID generator returned an invalid or duplicate ID");
    ids.add(id);
    updated = setFrameField(updated, frame.index, "frame_id", id);
  }
  return updated;
}

export function setFrameFieldById(
  source: string,
  frameId: string,
  key: string,
  value: string,
): string {
  const manifest = parseStoryboard(source);
  assertFrameIdentities(manifest, false);
  if (!/^[a-z_][a-z0-9_-]*$/i.test(key)) throw new Error("Invalid storyboard metadata key");
  if (key.toLowerCase() === "frame_id") throw new Error("Frame identity cannot be edited in place");
  const frame = manifest.frames.find((item) => item.frameId === frameId);
  if (!frame) throw new Error(`Storyboard frame ${frameId} not found`);
  return setFrameField(source, frame.index, key, value);
}
