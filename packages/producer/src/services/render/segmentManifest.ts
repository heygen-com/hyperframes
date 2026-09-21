/**
 * Segment manifest and resume bookkeeping (spec §5 Phase 2 item 3).
 *
 * A resumed render reuses encoded segments from a previous attempt, so a
 * wrong reuse silently corrupts the output rather than failing. Two things
 * guard that: the plan hash covers everything that determines segment bytes,
 * and every reused segment is re-validated on disk before it is skipped.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SegmentManifestEntry {
  index: number;
  startFrame: number;
  endFrame: number;
  path: string;
  bytes: number;
  completedAt: string;
}

export interface SegmentManifest {
  version: 1;
  planHash: string;
  totalFrames: number;
  segmentFrames: number;
  completed: SegmentManifestEntry[];
}

export interface SegmentPlanHashInput {
  compositionHash: string;
  cliVersion: string;
  totalFrames: number;
  segmentFrames: number;
  fps: { num: number; den: number };
  width: number;
  height: number;
  codec: string;
  preset: string;
  quality: number | undefined;
  bitrate: string | undefined;
  pixelFormat: string | undefined;
  imageFormat: string;
  /** Hardware encoder or not: h264_nvenc and libx264 both report codec "h264" but produce different bytes. */
  useGpu: boolean;
  /** Device-scaled capture size; `width`/`height` are the composition's CSS size. */
  outputWidth: number;
  outputHeight: number;
  /** Serialised motion-blur options, or "" when off; sample count and shutter change every pixel. */
  motionBlur: string;
}

const MANIFEST_FILENAME = "segments.json";

/** Everything that determines segment bytes. Key order is fixed by construction. */
export function computeSegmentPlanHash(input: SegmentPlanHashInput): string {
  const ordered = [
    input.compositionHash,
    input.cliVersion,
    String(input.totalFrames),
    String(input.segmentFrames),
    `${input.fps.num}/${input.fps.den}`,
    `${input.width}x${input.height}`,
    input.codec,
    input.preset,
    input.quality === undefined ? "" : String(input.quality),
    input.bitrate ?? "",
    input.pixelFormat ?? "",
    input.imageFormat,
    input.useGpu ? "gpu" : "cpu",
    `${input.outputWidth}x${input.outputHeight}`,
    input.motionBlur,
  ].join(" ");
  return createHash("sha256").update(ordered).digest("hex").slice(0, 16);
}

export function segmentDirFor(projectRendersDir: string, planHash: string): string {
  return join(projectRendersDir, ".hf-segments", planHash);
}

function hasNumber(value: object, key: string): boolean {
  return key in value && typeof Reflect.get(value, key) === "number";
}

function hasString(value: object, key: string): boolean {
  return key in value && typeof Reflect.get(value, key) === "string";
}

function isEntry(value: unknown): value is SegmentManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  return (
    hasNumber(value, "index") &&
    hasNumber(value, "startFrame") &&
    hasNumber(value, "endFrame") &&
    hasString(value, "path") &&
    hasNumber(value, "bytes") &&
    hasString(value, "completedAt")
  );
}

function isManifest(value: unknown): value is SegmentManifest {
  if (typeof value !== "object" || value === null) return false;
  const completed: unknown = Reflect.get(value, "completed");
  return (
    Reflect.get(value, "version") === 1 &&
    hasString(value, "planHash") &&
    hasNumber(value, "totalFrames") &&
    hasNumber(value, "segmentFrames") &&
    Array.isArray(completed) &&
    completed.every(isEntry)
  );
}

export function readSegmentManifest(segmentDir: string): SegmentManifest | null {
  const path = join(segmentDir, MANIFEST_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isManifest(parsed) ? parsed : null;
  } catch {
    // A truncated or hand-edited manifest means "no resume", never a crash:
    // the render still has every frame it needs to capture from scratch.
    return null;
  }
}

/** Atomic: write to a temp name, then rename over the manifest. */
export function writeSegmentManifest(segmentDir: string, manifest: SegmentManifest): void {
  mkdirSync(segmentDir, { recursive: true });
  const tmp = join(segmentDir, `${MANIFEST_FILENAME}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  renameSync(tmp, join(segmentDir, MANIFEST_FILENAME));
}

/**
 * Frame count of a finished segment, derived from its probed duration and
 * frame rate. There is no exact-count reader in the engine's ffprobe utils
 * and `-count_frames` decodes the whole file; duration is enough here because
 * the only failure this has to catch is a segment that is missing frames,
 * which shortens the duration. Rounding can only reject a good segment, and
 * the cost of that is re-capturing it.
 */
export async function probeSegmentFrameCount(
  path: string,
  probe: (path: string) => Promise<{ videoStreamDurationSeconds: number; fps: number }>,
): Promise<number | null> {
  try {
    const meta = await probe(path);
    if (!Number.isFinite(meta.videoStreamDurationSeconds) || !Number.isFinite(meta.fps))
      return null;
    if (meta.fps <= 0) return null;
    return Math.round(meta.videoStreamDurationSeconds * meta.fps);
  } catch {
    // Unprobeable means unusable: the segment is re-captured.
    return null;
  }
}

/**
 * Indices safe to skip on resume. A segment counts only if the hash matches,
 * the file exists at the recorded size, and its frame count equals the slice
 * length. Anything else re-captures — the cost of re-capturing a good segment
 * is minutes; the cost of reusing a bad one is a silently wrong video.
 */
export async function validateCompletedSegments(
  manifest: SegmentManifest,
  expectedHash: string,
  probeFrames: (path: string) => Promise<number | null>,
): Promise<Set<number>> {
  const ok = new Set<number>();
  if (manifest.planHash !== expectedHash) return ok;
  for (const entry of manifest.completed) {
    if (!existsSync(entry.path)) continue;
    const size = statSync(entry.path).size;
    if (size <= 0 || size !== entry.bytes) continue;
    const frames = await probeFrames(entry.path);
    if (frames !== entry.endFrame - entry.startFrame) continue;
    ok.add(entry.index);
  }
  return ok;
}
