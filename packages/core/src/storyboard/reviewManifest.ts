import { assertFrameIdentities, STORYBOARD_FRAME_ID_RE } from "./frameIdentity.js";
import type { FrameStatus, StoryboardManifest } from "./types.js";

export interface ReviewBoardStill {
  asset_id: string;
  sha256: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

export interface ReviewBoardFrame {
  frame_id: string;
  title: string;
  display_number: number | null;
  status: FrameStatus;
  act: string | null;
  scene: string | null;
  motion: string | null;
  voiceover: string | null;
  description: string;
  planned_duration_ms: number | null;
  still: ReviewBoardStill | null;
}

export interface ReviewBoardManifest {
  schema_version: 1;
  title: string;
  frames: ReviewBoardFrame[];
}

function text(value: string, limit: number): string {
  const characters = [...value];
  const invalidUnicode = characters.some(
    (character) =>
      character.length === 1 &&
      character.charCodeAt(0) >= 0xd800 &&
      character.charCodeAt(0) <= 0xdfff,
  );
  if (characters.length > limit || invalidUnicode)
    throw new Error("Storyboard text exceeds bounds or contains invalid Unicode");
  return value;
}

function optionalText(value: string | undefined, limit: number): string | null {
  return value === undefined ? null : text(value, limit);
}

function stillForReview(still: ReviewBoardStill | undefined): ReviewBoardStill | null {
  if (!still) return null;
  if (!STORYBOARD_FRAME_ID_RE.test(still.asset_id) || !/^[0-9a-f]{64}$/.test(still.sha256))
    throw new Error("Invalid storyboard still identity");
  if (!["image/png", "image/jpeg", "image/webp"].includes(still.mime_type))
    throw new Error("Unsupported storyboard still MIME type");
  if (
    ![still.width, still.height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384) ||
    still.width * still.height > 40_000_000
  )
    throw new Error("Invalid storyboard still dimensions");
  return {
    asset_id: still.asset_id,
    sha256: still.sha256,
    mime_type: still.mime_type,
    width: still.width,
    height: still.height,
  };
}

function plannedDuration(seconds: number | undefined): number | null {
  if (seconds === undefined) return null;
  const milliseconds = Math.round(seconds * 1000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 86_400_000)
    throw new Error("Invalid planned duration");
  return milliseconds;
}

function displayNumber(number: number | undefined): number | null {
  if (number === undefined) return null;
  if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000)
    throw new Error("Invalid display number");
  return number;
}

/** Requires persisted IDs and upload receipts; does not infer still identity from local paths. */
export function createReviewBoardManifest(
  storyboard: StoryboardManifest,
  options: { title: string; stills?: ReadonlyMap<string, ReviewBoardStill> },
): ReviewBoardManifest {
  assertFrameIdentities(storyboard);
  if (storyboard.frames.length < 1 || storyboard.frames.length > 200)
    throw new Error("A review board needs 1 to 200 frames");
  const ids = new Set(storyboard.frames.map((frame) => frame.frameId));
  for (const id of options.stills?.keys() ?? []) {
    if (!ids.has(id)) throw new Error("Still receipt refers to an unknown frame");
  }
  const frames = storyboard.frames.map((frame): ReviewBoardFrame => {
    const frameId = frame.frameId;
    if (!frameId) throw new Error("Missing persisted frame_id");
    return {
      frame_id: frameId,
      title: text(frame.title ?? "", 256),
      display_number: displayNumber(frame.number),
      status: frame.status,
      act: optionalText(frame.extra.act, 256),
      scene: optionalText(frame.scene, 4096),
      motion: optionalText(frame.extra.motion, 4096),
      voiceover: optionalText(frame.voiceover, 8192),
      description: text(frame.narrative, 8192),
      planned_duration_ms: plannedDuration(frame.durationSeconds),
      still: stillForReview(options.stills?.get(frameId)),
    };
  });
  const result: ReviewBoardManifest = {
    schema_version: 1,
    title: text(options.title, 256),
    frames,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 1_048_576)
    throw new Error("Storyboard manifest exceeds 1 MiB");
  return result;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

/** Persist these exact UTF-8 bytes as storyboard.review.json before syncing a review board. */
export function serializeReviewBoardManifest(manifest: ReviewBoardManifest): string {
  return JSON.stringify(canonicalValue(manifest));
}
