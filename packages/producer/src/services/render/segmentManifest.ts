/**
 * Segment manifest and resume bookkeeping (spec §5 Phase 2 item 3).
 *
 * A resumed render reuses encoded segments from a previous attempt, so a
 * wrong reuse silently corrupts the output rather than failing. Two things
 * guard that: the plan hash covers everything that determines segment bytes,
 * and every reused segment is re-validated on disk before it is skipped.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertPrivateCachePath,
  ensurePrivateCacheDir,
  hyperframesCacheDir,
} from "@hyperframes/core/cache-dir";
import { isSafePath, realpath } from "@hyperframes/core/safe-path";
import { isPathInside } from "@hyperframes/parsers/asset-paths";
import { previewToken } from "@hyperframes/core/preview-proof";
import { planSegments, segmentOutputPath, type SegmentSlice } from "./segmentPlan.js";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";

export interface SegmentManifestEntry {
  index: number;
  startFrame: number;
  endFrame: number;
  path: string;
  bytes: number;
  /** Hex SHA-256 of the segment file, taken when it finished. */
  sha256: string;
  completedAt: string;
}

export interface SegmentManifest {
  version: 1;
  planHash: string;
  totalFrames: number;
  segmentFrames: number;
  completed: SegmentManifestEntry[];
  /** HMAC by this user's manifest key; resume trusts no manifest without a valid one. */
  mac?: string;
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
  const root = hyperframesCacheDir();
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
  assertPrivateCachePath(root, root);
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
    hasString(value, "sha256") &&
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
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) return null;
    // Windows lacks O_NOFOLLOW. Verify the directory entry still names the opened file.
    const named = lstatSync(path);
    if (!named.isFile() || named.dev !== opened.dev || named.ino !== opened.ino) return null;
    const parsed: unknown = JSON.parse(readFileSync(fd, "utf-8"));
    return isManifest(parsed) ? parsed : null;
  } catch {
    // A truncated or hand-edited manifest means "no resume", never a crash:
    // the render still has every frame it needs to capture from scratch.
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The key that signs segment manifests, derived from this user's preview token, which lives in the
 * user's home outside every project. Null when no token can be read or made; resume then reuses nothing.
 */
export function segmentManifestKey(token: string | null = previewToken()): Buffer | null {
  return token ? createHmac("sha256", token).update("segment-manifest").digest() : null;
}

function manifestMac(manifest: SegmentManifest, key: Buffer): string {
  const signed = [
    manifest.planHash,
    manifest.totalFrames,
    manifest.segmentFrames,
    manifest.completed.map((e) => [e.index, e.startFrame, e.endFrame, e.bytes, e.sha256]),
  ];
  return createHmac("sha256", key).update(JSON.stringify(signed)).digest("hex");
}

function signSegmentManifest(manifest: SegmentManifest, key: Buffer | null): SegmentManifest {
  const { version, planHash, totalFrames, segmentFrames, completed } = manifest;
  const unsigned: SegmentManifest = { version, planHash, totalFrames, segmentFrames, completed };
  return key ? { ...unsigned, mac: manifestMac(unsigned, key) } : unsigned;
}

function hasValidMac(manifest: SegmentManifest, key: Buffer | null): boolean {
  if (!key || typeof manifest.mac !== "string") return false;
  const expected = Buffer.from(manifestMac(manifest, key), "hex");
  const actual = Buffer.from(manifest.mac, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hashSegmentFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Atomic: write to a temp name, then rename over the manifest. */
export function writeSegmentManifest(
  segmentDir: string,
  manifest: SegmentManifest,
  key: Buffer | null,
): void {
  mkdirSync(segmentDir, { recursive: true });
  replaceFileAtomically(
    join(segmentDir, MANIFEST_FILENAME),
    JSON.stringify(signSegmentManifest(manifest, key), null, 2),
    0o600,
  );
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

export interface SegmentResumeCheck {
  expectedHash: string;
  segmentDir: string;
  totalFrames: number;
  segmentFrames: number;
  key: Buffer | null;
  probeFrames: (path: string) => Promise<number | null>;
}

function plannedSlice(
  entry: SegmentManifestEntry,
  plan: readonly SegmentSlice[],
): SegmentSlice | undefined {
  const slice = Number.isInteger(entry.index) ? plan[entry.index] : undefined;
  if (!slice || slice.startFrame !== entry.startFrame || slice.endFrame !== entry.endFrame) {
    return undefined;
  }
  return slice;
}

async function matchesSegmentFile(path: string, entry: SegmentManifestEntry): Promise<boolean> {
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size !== entry.bytes) {
      return false;
    }
    return (await hashSegmentFile(path)) === entry.sha256;
  } catch {
    // A checkpoint can disappear or become unreadable before hashing finishes.
    return false;
  }
}

/**
 * Indices safe to skip on resume. A segment counts only if this user's key
 * signed the manifest, the plan hash matches, the entry matches a slice of
 * this plan, and the file the join will read (the slice's own path in
 * `segmentDir`, never the manifest's `path`) is a plain file at the recorded
 * size and hash whose frame count equals the slice length. The hash is
 * checked before the prober opens the file. Anything else re-captures:
 * re-capturing a good segment costs minutes, reusing a bad one silently
 * produces a wrong video.
 */
export async function validateCompletedSegments(
  manifest: SegmentManifest,
  check: SegmentResumeCheck,
): Promise<Set<number>> {
  const ok = new Set<number>();
  if (
    manifest.totalFrames !== check.totalFrames ||
    manifest.segmentFrames !== check.segmentFrames ||
    manifest.planHash !== check.expectedHash ||
    !hasValidMac(manifest, check.key)
  )
    return ok;
  const plan = planSegments(check.totalFrames, check.segmentFrames);
  for (const entry of manifest.completed) {
    const slice = plannedSlice(entry, plan);
    if (!slice) continue;
    const path = segmentOutputPath(check.segmentDir, slice.index);
    if (entry.path !== path || !(await matchesSegmentFile(path, entry))) continue;
    const frames = await check.probeFrames(path);
    if (frames !== slice.endFrame - slice.startFrame) continue;
    ok.add(slice.index);
  }
  return ok;
}
