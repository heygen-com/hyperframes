import type { ClipManifestClip } from "./playbackTypes";

const OPTIONAL_NUMBERS = ["zIndex", "playbackStart", "playbackRate"] as const;

const finiteNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value);

function wellFormedClip(clip: unknown): clip is ClipManifestClip {
  if (typeof clip !== "object" || clip === null) return false;
  const fields = clip as Record<string, unknown>;
  if (!finiteNumber(fields.start) || !finiteNumber(fields.duration)) return false;
  if (!Number.isInteger(fields.track)) return false;
  return OPTIONAL_NUMBERS.every((name) => fields[name] == null || finiteNumber(fields[name]));
}

/** A preview frame's clip list, keeping only clips whose timing and track are numbers. */
export function wellFormedClips(clips: readonly unknown[]): ClipManifestClip[] {
  return clips.filter(wellFormedClip);
}
