/**
 * Segment manifest and resume bookkeeping (spec §5 Phase 2 item 3).
 *
 * A resumed render reuses encoded segments from a previous attempt, so a
 * wrong reuse silently corrupts the output rather than failing. Two things
 * guard that: the plan hash covers everything that determines segment bytes,
 * and every reused segment is re-validated on disk before it is skipped.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensurePrivateCacheDir, trustedCacheRoot } from "@hyperframes/core/cache-dir";
import { isSafePath, realpath } from "@hyperframes/core/safe-path";
import { isPathInside } from "@hyperframes/parsers/asset-paths";
import { planSegments, segmentOutputPath } from "./segmentPlan.js";
import { renameWithRetry } from "@hyperframes/engine";

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
  maxBitrate: string | undefined;
  bufferSize: string | undefined;
  gopSize: number | undefined;
  pixelFormat: string | undefined;
  imageFormat: string;
  /** Hardware encoder or not: h264_nvenc and libx264 both report codec "h264" but produce different bytes. */
  useGpu: boolean;
  /** Device-scaled capture size; `width`/`height` are the composition's CSS size. */
  outputWidth: number;
  outputHeight: number;
  /** Serialised motion-blur options, or "" when off; sample count and shutter change every pixel. */
  motionBlur: string;
  pageMotionBlur: "off" | undefined;
  captureQuality: number | undefined;
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
    input.pageMotionBlur ?? "",
    input.captureQuality === undefined ? "" : String(input.captureQuality),
  ];
  const delivery = [input.maxBitrate, input.bufferSize, input.gopSize].map((v) => v ?? "");
  if (delivery.some((v) => v !== "")) ordered.push(...delivery.map(String));
  return createHash("sha256").update(ordered.join(" ")).digest("hex").slice(0, 16);
}

export function segmentDirFor(projectDir: string, planHash: string): string {
  const root = trustedCacheRoot();
  const projectKey = createHash("sha256").update(realpath(projectDir)).digest("hex");
  const parent = join(root, "segments", projectKey);
  const dir = join(parent, planHash);
  if (
    isPathInside(root, projectDir) ||
    isSafePath(projectDir, root) ||
    isSafePath(projectDir, parent) ||
    isSafePath(projectDir, dir)
  ) {
    throw new Error("Segmented capture requires HYPERFRAMES_CACHE_DIR outside the project.");
  }
  ensurePrivateCacheDir(parent, root);
  if (!isSafePath(parent, dir) || lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("Invalid segment cache directory");
  }
  return dir;
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
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.nlink !== 1) return null;
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
  renameWithRetry(tmp, join(segmentDir, MANIFEST_FILENAME));
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
  segmentDir: string,
  plan: Pick<SegmentManifest, "planHash" | "segmentFrames" | "totalFrames">,
  probeFrames: (path: string) => Promise<number | null>,
): Promise<Set<number>> {
  const ok = new Set<number>();
  if (
    manifest.planHash !== plan.planHash ||
    manifest.totalFrames !== plan.totalFrames ||
    manifest.segmentFrames !== plan.segmentFrames
  )
    return ok;
  const slices = planSegments(plan.totalFrames, plan.segmentFrames);
  for (const entry of manifest.completed) {
    if (!Number.isSafeInteger(entry.index)) continue;
    const slice = slices[entry.index];
    if (!slice || slice.startFrame !== entry.startFrame || slice.endFrame !== entry.endFrame)
      continue;
    const path = segmentOutputPath(segmentDir, slice.index);
    if (entry.path !== path) continue;
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size !== entry.bytes)
      continue;
    if ((await probeFrames(path)) !== slice.endFrame - slice.startFrame) continue;
    ok.add(entry.index);
  }
  return ok;
}
