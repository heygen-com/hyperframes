/**
 * Authored safe-frame crop windows.
 *
 * `data-safe-frames` on the composition root names crop rectangles as
 * fractions of the authored frame. Rendering `--crop-pack` crops the
 * already-encoded master to those windows — it does not reflow layout.
 *
 * Pixel sizes are snapped in {@link pixelRect} so a 9:16 window whose
 * fractional width rounds to 478.something on a 1920×1080 master still
 * matches the named ratio within one pixel on each side. Lint, render,
 * Studio, and the player all use this function so they cannot drift.
 */

import { COMPOSITION_ATTRIBUTES } from "./compositionContract.js";

export const SAFE_FRAME_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type SafeFrameRatio = (typeof SAFE_FRAME_RATIOS)[number];

export const SAFE_FRAME_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export interface SafeFrame {
  id: string;
  ratio: SafeFrameRatio;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SafeFrameParseErrorCode =
  | "safe_frames_invalid_json"
  | "safe_frame_bad_id"
  | "safe_frame_bad_rect";

export type SafeFrameParseResult =
  | { ok: true; frames: SafeFrame[] }
  | {
      ok: false;
      code: SafeFrameParseErrorCode;
      message: string;
      index?: number;
      id?: string;
    };

export interface SafeFrameAttributeReader {
  getAttribute(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

const RATIO_PARTS: Record<SafeFrameRatio, { rw: number; rh: number }> = {
  "16:9": { rw: 16, rh: 9 },
  "9:16": { rw: 9, rh: 16 },
  "1:1": { rw: 1, rh: 1 },
};

export function isSafeFrameRatio(value: string): value is SafeFrameRatio {
  return (SAFE_FRAME_RATIOS as readonly string[]).includes(value);
}

export function parseRatioParts(ratio: SafeFrameRatio): { rw: number; rh: number } {
  return RATIO_PARTS[ratio];
}

function isFiniteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Snap rounded pixel size onto the named ratio.
 *
 * After `round(fraction * authoredDimension)` the integer pair can sit a
 * fraction of a pixel off the named aspect (a 1920×1080 9:16 window whose
 * width rounds through 478.something). Adjust width or height by at most
 * 1px so both sides match the ratio within one pixel. A larger miss is a
 * ratio error, not rounding — callers must reject it rather than invent a
 * different rect.
 */
export function snapPixelSizeToRatio(
  width: number,
  height: number,
  ratio: SafeFrameRatio,
): { width: number; height: number } | null {
  const { rw, rh } = RATIO_PARTS[ratio];
  if (width <= 0 || height <= 0) return null;
  const widthFromHeight = (height * rw) / rh;
  const heightFromWidth = (width * rh) / rw;
  const dw = Math.abs(width - widthFromHeight);
  const dh = Math.abs(height - heightFromWidth);
  if (dw > 1 && dh > 1) return null;
  if (dw <= dh) {
    const snappedWidth = Math.round(widthFromHeight);
    if (Math.abs(snappedWidth - width) > 1 || snappedWidth <= 0) return null;
    return { width: snappedWidth, height };
  }
  const snappedHeight = Math.round(heightFromWidth);
  if (Math.abs(snappedHeight - height) > 1 || snappedHeight <= 0) return null;
  return { width, height: snappedHeight };
}

/**
 * Convert an authored fractional frame to integer pixels in the composition
 * coordinate space (origin top-left). Snaps the last pixel onto the named
 * ratio. Throws if the snapped rect would leave the authored frame.
 */
export function pixelRect(frame: SafeFrame, width: number, height: number): PixelRect {
  const resolved = tryPixelRect(frame, width, height);
  if (!resolved) {
    throw new Error(
      `Safe frame "${frame.id}" ${frame.width}*${width}×${frame.height}*${height} does not match ratio ${frame.ratio} after snap.`,
    );
  }
  return resolved;
}

export function tryPixelRect(frame: SafeFrame, width: number, height: number): PixelRect | null {
  if (!(width > 0) || !(height > 0)) return null;
  const x = Math.round(frame.x * width);
  const y = Math.round(frame.y * height);
  const rawWidth = Math.round(frame.width * width);
  const rawHeight = Math.round(frame.height * height);
  const snapped = snapPixelSizeToRatio(rawWidth, rawHeight, frame.ratio);
  if (!snapped) return null;
  if (x < 0 || y < 0) return null;
  if (x + snapped.width > width || y + snapped.height > height) return null;
  if (snapped.width <= 0 || snapped.height <= 0) return null;
  return { x, y, width: snapped.width, height: snapped.height };
}

/**
 * Largest integer output that fits `ratio` and does not upscale past the
 * cropped source. A 844×1080 crop from a 1920×1080 9:16 window stays
 * 844×1080 — cropping is not letterboxing or a second capture.
 */
export function outputSizeForCrop(crop: PixelRect, ratio: SafeFrameRatio): PixelRect {
  const snapped = snapPixelSizeToRatio(crop.width, crop.height, ratio);
  const width = snapped?.width ?? crop.width;
  const height = snapped?.height ?? crop.height;
  return {
    x: 0,
    y: 0,
    width: Math.min(width, crop.width),
    height: Math.min(height, crop.height),
  };
}

/**
 * Parse `data-safe-frames` JSON. When `dimensions` are given, pixel sizes
 * must match the named ratio after snap.
 */
// fallow-ignore-next-line complexity
export function parseSafeFramesAttribute(
  raw: string | null,
  dimensions?: { width: number; height: number },
): SafeFrameParseResult {
  if (raw === null) return { ok: true, frames: [] };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, frames: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      code: "safe_frames_invalid_json",
      message: "data-safe-frames must be a JSON array of objects.",
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      code: "safe_frames_invalid_json",
      message: "data-safe-frames must be a JSON array of objects.",
    };
  }
  const frames: SafeFrame[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (!isPlainObject(entry)) {
      return {
        ok: false,
        code: "safe_frames_invalid_json",
        message: `data-safe-frames[${index}] is not an object.`,
        index,
      };
    }
    const id = entry.id;
    if (typeof id !== "string" || !SAFE_FRAME_ID_PATTERN.test(id)) {
      return {
        ok: false,
        code: "safe_frame_bad_id",
        message: `data-safe-frames[${index}] has a missing or illegal id (expected [a-z][a-z0-9-]{0,31}).`,
        index,
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        code: "safe_frame_bad_id",
        message: `data-safe-frames id "${id}" is duplicated.`,
        index,
        id,
      };
    }
    seen.add(id);
    const ratio = entry.ratio;
    if (typeof ratio !== "string" || !isSafeFrameRatio(ratio)) {
      return {
        ok: false,
        code: "safe_frame_bad_rect",
        message: `data-safe-frames "${id}" ratio must be 16:9, 9:16, or 1:1.`,
        index,
        id,
      };
    }
    const x = entry.x;
    const y = entry.y;
    const width = entry.width;
    const height = entry.height;
    if (!isFiniteUnit(x) || !isFiniteUnit(y) || !isFiniteUnit(width) || !isFiniteUnit(height)) {
      return {
        ok: false,
        code: "safe_frame_bad_rect",
        message: `data-safe-frames "${id}" x, y, width, and height must be finite numbers.`,
        index,
        id,
      };
    }
    if (
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x > 1 ||
      y > 1 ||
      width > 1 ||
      height > 1 ||
      x + width > 1 + Number.EPSILON ||
      y + height > 1 + Number.EPSILON
    ) {
      return {
        ok: false,
        code: "safe_frame_bad_rect",
        message: `data-safe-frames "${id}" fractions must stay inside [0, 1] with x+width ≤ 1 and y+height ≤ 1.`,
        index,
        id,
      };
    }
    const frame: SafeFrame = { id, ratio, x, y, width, height };
    if (dimensions && !tryPixelRect(frame, dimensions.width, dimensions.height)) {
      return {
        ok: false,
        code: "safe_frame_bad_rect",
        message: `data-safe-frames "${id}" pixel size does not match ratio ${ratio} after snap.`,
        index,
        id,
      };
    }
    frames.push(frame);
  }
  return { ok: true, frames };
}

export function readCompositionDimensions(
  root: SafeFrameAttributeReader,
): { width: number; height: number } | null {
  const width = Number.parseFloat(root.getAttribute("data-width") ?? "");
  const height = Number.parseFloat(root.getAttribute("data-height") ?? "");
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

export function parseSafeFrames(root: SafeFrameAttributeReader): SafeFrameParseResult {
  const raw = root.getAttribute(COMPOSITION_ATTRIBUTES.safeFrames);
  return parseSafeFramesAttribute(raw, readCompositionDimensions(root) ?? undefined);
}

export function parseSafeCriticalIds(raw: string | null): "all" | string[] | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "true") return "all";
  const ids = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : "all";
}

/**
 * True when `el` is marked `data-safe-critical` for `frameId`.
 * A boolean attribute (empty / "true") requires every named frame.
 * `data-safe-critical="vertical,square"` limits the requirement to those ids.
 */
export function elementRequiresFrame(el: SafeFrameAttributeReader, frameId: string): boolean {
  const attr = COMPOSITION_ATTRIBUTES.safeCritical;
  const raw = el.getAttribute(attr);
  if (raw === null) {
    if (el.hasAttribute?.(attr)) return true;
    return false;
  }
  const parsed = parseSafeCriticalIds(raw);
  if (parsed === null) return false;
  if (parsed === "all") return true;
  return parsed.includes(frameId);
}

export function resolveCropPackSelection(
  frames: SafeFrame[],
  request: "all" | string[],
): { ok: true; members: SafeFrame[] } | { ok: false; unknownIds: string[] } {
  if (request === "all") return { ok: true, members: [...frames] };
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const members: SafeFrame[] = [];
  const unknownIds: string[] = [];
  const seen = new Set<string>();
  for (const id of request) {
    if (seen.has(id)) continue;
    seen.add(id);
    const frame = byId.get(id);
    if (!frame) unknownIds.push(id);
    else members.push(frame);
  }
  if (unknownIds.length > 0) return { ok: false, unknownIds };
  return { ok: true, members };
}

export function parseCropPackFlag(raw: string): "all" | string[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "all") return "all";
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function cropPackOutputPath(masterPath: string, id: string): string {
  const slash = Math.max(masterPath.lastIndexOf("/"), masterPath.lastIndexOf("\\"));
  const basenameStart = slash >= 0 ? slash + 1 : 0;
  const basename = masterPath.slice(basenameStart);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return `${masterPath}.${id}`;
  const dir = slash >= 0 ? masterPath.slice(0, slash + 1) : "";
  const stem = basename.slice(0, dot);
  const ext = basename.slice(dot);
  return `${dir}${stem}.${id}${ext}`;
}
