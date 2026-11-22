import type { ClipManifestClip } from "./playbackTypes";

const OPTIONAL_NUMBERS = ["zIndex", "playbackStart", "playbackRate"] as const;

export const clipNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const clipTrack = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

function wellFormedClip(clip: unknown): clip is ClipManifestClip {
  if (typeof clip !== "object" || clip === null) return false;
  const fields = clip as Record<string, unknown>;
  if (clipNumber(fields.start) === null || clipNumber(fields.duration) === null) return false;
  if (clipTrack(fields.track) === null) return false;
  return OPTIONAL_NUMBERS.every(
    (name) => fields[name] == null || clipNumber(fields[name]) !== null,
  );
}

/** A preview frame's clip list, keeping only clips whose timing and track are numbers. */
export function wellFormedClips(clips: readonly unknown[]): ClipManifestClip[] {
  return clips.filter(wellFormedClip);
}
