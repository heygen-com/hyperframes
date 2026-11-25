import { TRANSITION_LABEL_PREFIX } from "@hyperframes/core/studio-preview-mark";
import type { ClipManifestClip } from "./playbackTypes";

const MAX_TRANSITION_LABEL = 200;
const MAX_CLIP_ID = 512;
const MAX_CLIP_LABEL = 200;

const ID_FIELDS = [
  "id",
  "kind",
  "tagName",
  "compositionId",
  "parentCompositionId",
  "compositionSrc",
  "stackingContextId",
] as const;

const boundedId = (value: unknown): boolean =>
  value == null || (typeof value === "string" && value.length <= MAX_CLIP_ID);

const stringsOnly = (fields: Record<string, unknown>): boolean =>
  ID_FIELDS.every((name) => boundedId(fields[name])) &&
  (fields.label == null || typeof fields.label === "string") &&
  (fields.assetUrl == null || typeof fields.assetUrl === "string") &&
  (fields.compositionAncestors == null ||
    (Array.isArray(fields.compositionAncestors) &&
      fields.compositionAncestors.every(
        (ancestor) => typeof ancestor === "string" && boundedId(ancestor),
      )));

const OPTIONAL_NUMBERS = ["zIndex", "playbackStart", "playbackRate"] as const;

export const clipNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const clipTrack = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

function wellFormedClip(clip: unknown): clip is ClipManifestClip {
  if (typeof clip !== "object" || clip === null) return false;
  const fields = clip as Record<string, unknown>;
  if (clipNumber(fields.start) === null || clipNumber(fields.duration) === null) return false;
  if (clipTrack(fields.track) === null || !stringsOnly(fields)) return false;
  return OPTIONAL_NUMBERS.every(
    (name) => fields[name] == null || clipNumber(fields[name]) !== null,
  );
}

const transitionLabelOf = (value: unknown): string | undefined =>
  typeof value === "string" &&
  value.length <= MAX_TRANSITION_LABEL &&
  value.startsWith(TRANSITION_LABEL_PREFIX)
    ? value
    : undefined;

/** A preview frame's clip list: numeric timing and track, string fields of bounded length. */
export function wellFormedClips(clips: readonly unknown[]): ClipManifestClip[] {
  return clips.filter(wellFormedClip).map(({ transitionLabel, ...clip }) => {
    const label = transitionLabelOf(transitionLabel);
    const bounded =
      typeof clip.label === "string" && clip.label.length > MAX_CLIP_LABEL
        ? { ...clip, label: clip.label.slice(0, MAX_CLIP_LABEL) }
        : clip;
    return label ? { ...bounded, transitionLabel: label } : bounded;
  });
}
