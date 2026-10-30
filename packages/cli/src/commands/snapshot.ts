import {
  DEFAULT_CONFIG,
  buildZeroDurationDiagnostic,
  downloadToTemp,
  evaluateHfDiagnostic,
  extractMediaMetadata,
  isHdrColorSpace,
  sdrCanvasColourFilters,
} from "@hyperframes/engine";
import { parseTimeoutMs } from "../utils/timeoutArg.js";
import type { Page } from "puppeteer-core";
import { reportArtifacts } from "../utils/toolContext.js";
import { withProjectLock } from "../utils/projectLock.js";
import {
  parseSnapshotAt,
  parseSnapshotFrames,
  parseSnapshotRange,
  sampleSnapshotRange,
  resolveSnapshotCompositionRange,
  type SnapshotRange,
} from "./snapshotSampling.js";
import { captureArtifactRevision } from "../utils/artifactCapture.js";
import { randomUUID } from "node:crypto";
import {
  artifactDirectory,
  finishSnapshotRun,
  retainSnapshotOutput,
  forgetRecordedArtifacts,
  recordArtifacts,
  type ArtifactCapture,
} from "@hyperframes/studio-server/history";
import { pngDimensions } from "../utils/pngDimensions.js";
import { runWithConcurrencyLimit } from "../utils/concurrency.js";
import { CliRuntimeError, CliUsageError, failCommand } from "../utils/commandResult.js";
// fallow-ignore-file complexity
import { defineCommand } from "../utils/defineCommand.js";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute, basename, posix } from "node:path";
import {
  DEFAULT_ZOOM_SCALE,
  captureRegionCrop,
  openSettledCompositionPage,
  parseZoomTarget,
  resolveCropRegion,
  runFfmpegOnce,
  SCREENSHOT_IMAGE_WAIT_MS,
  seekCompositionTimelineOnly,
  settleCompositionSeek,
  type UnsettledImages,
  type ZoomTarget,
} from "../capture/captureCompositionFrame.js";
import {
  firstFrameColourArgs,
  hdrToSdrToneMapFilter,
  isClipVisibleAt,
  isInClipWindow,
  parseFirstFrameColour,
  readElementRateSpec,
  sourceTimeAt,
  timeAtSourceTime,
  type RateSpec,
} from "@hyperframes/core";
import { resolveProject } from "../utils/project.js";
import {
  definitiveEntryMismatchComposition,
  hasDefinitiveEntryMismatch,
  lintProject,
} from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { normalizeErrorMessage, atStep } from "../utils/errorMessage.js";
import { describeSharpLoadFailure } from "../utils/sharpLoadFailure.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import { c } from "../ui/colors.js";
import { writeCaptureFileSync } from "../capture/captureFile.js";
import { runCancellableProcess } from "../utils/cancellableProcess.js";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { parseAngle, type Camera } from "./motionShotLayout.js";
import { createFrameBank, type FrameWant, type PlannedFrame } from "./snapshotFrameBank.js";
import type { Example } from "./_examples.js";
import { loadInstalledSharp, loadOptionalPackage } from "../utils/optionalPackages.js";
import { resolveLocalBrowserGpuMode, type BrowserGpuMode } from "../browser/gpuPolicy.js";
import {
  REVIEW_PHONE_WIDTH,
  planReview,
  resolveReviewTimeline,
  reviewFrames,
  writeReviewSheets,
  type ReviewFrame,
  type ReviewPlan,
  type ReviewSheets,
} from "./snapshotReview.js";
import { withMeta } from "../utils/updateCheck.js";
import { trackSnapshotRun } from "../telemetry/events.js";
import { failureMessage, jsonFailure } from "../utils/jsonError.js";

// Runs IN THE BROWSER (serialized into page.evaluate). Tilt the whole stage so
// the REAL painted pixels are viewed from an orthogonal angle (FINDING [10]:
// snapshot only captured the composition's own head-on camera, so 3D depth /
// occlusion couldn't be verified). Same approach as motionShot's orbit camera:
// make the composition root + its ancestor chain preserve-3d, strip intermediate
// perspective, put one perspective on the root's parent (the lens) and rotate
// the root — works on any composition shape (no #stage assumption).
//
// Kept as a self-contained copy of motionShot.ts's `applyOrbitCamera` because
// that one is module-private; this is ~15 lines and sharing it would mean
// touching motionShot.ts (out of scope for this change).
function orbitStageSource(): string {
  return `function(cam) {
    var root = document.querySelector("[data-composition-id]")
      || document.querySelector("#stage")
      || document.body.firstElementChild
      || document.body;
    var n = root;
    while (n && n !== document.body) {
      n.style.transformStyle = "preserve-3d";
      n.style.perspective = "none";
      n = n.parentElement;
    }
    root.style.transformStyle = "preserve-3d";
    root.style.perspective = "none";
    root.style.transformOrigin = "50% 50%";
    root.style.transform = "rotateX(" + cam.pitch + "deg) rotateY(" + cam.yaw + "deg)";
    var lens = root.parentElement || document.body;
    lens.style.perspective = "1600px";
    lens.style.perspectiveOrigin = "50% 50%";
  }`;
}

/** Maximum time a single-frame FFmpeg extract is allowed to run. Mirrors the
 * default applied by `@hyperframes/engine`'s `runFfmpeg` so a pathological
 * clip (corrupt media, stalled network mount, codec edge case) cannot wedge
 * `hyperframes snapshot` indefinitely. */
const FFMPEG_EXTRACT_TIMEOUT_MS = 30_000;
const FALLBACK_SEEK_LEAD_SECONDS = 5;
const RENDER_READY_TIMEOUT_MS = DEFAULT_CONFIG.playerReadyTimeout;

export function timeoutUnitHint(timeoutMs: number): string {
  return timeoutMs < 1_000
    ? ` --timeout is in milliseconds, so ${timeoutMs} is ${timeoutMs} ms; 45000 is 45 s.`
    : "";
}

export async function renderNotReadyError(page: Page, timeoutMs: number): Promise<Error> {
  const diagnostic = await evaluateHfDiagnostic(page).then(buildZeroDurationDiagnostic, () => "");
  return new Error(
    `The composition was not render-ready after ${timeoutMs}ms, so no frame was saved (raise --timeout if it loads slowly).${timeoutUnitHint(timeoutMs)}\n${diagnostic}`,
  );
}
/** Each 4K decode is already multi-threaded, so a few at once fill the cores without exhausting memory. */
const VIDEO_FRAME_EXTRACT_CONCURRENCY = 4;

/** Keep millisecond-level snapshot timing proof without leaking floating-point noise. */
export function formatSnapshotTimestamp(time: number): string {
  return `${Number(time.toFixed(3))}s`;
}

/** The captured stills that are on disk with bytes, as absolute paths; the rest are missing. */
export function snapshotsOnDisk(projectDir: string, paths: string[]) {
  const written: string[] = [];
  const missing: string[] = [];
  for (const path of paths) {
    const absolute = resolve(projectDir, path);
    let size = 0;
    try {
      size = statSync(absolute).size;
    } catch {
      // absent: counted as missing below
    }
    (size > 0 ? written : missing).push(absolute);
  }
  return { written, missing };
}

export const SNAPSHOT_IMAGE_NAME =
  /^(?:(?:frame-\d+-|ref-(?:\d+-)?)?at-[\d.]+s\.png|pair-(?:\d+-)?at-[\d.]+s\.jpg|(?:beat-\d+|seam-\d+-\d+)-at-[\d.]+s\.png|(?:contact-sheet|review-beats|review-phone)(?:-\d+)?\.jpg|review-seam-\d+\.jpg)$/;

/** Removes the stills an earlier run left in the folder, so two runs never mix; returns what it removed. */
export function clearEarlierStills(snapshotDir: string): string[] {
  const cleared: string[] = [];
  try {
    for (const file of readdirSync(snapshotDir)) {
      if (!SNAPSHOT_IMAGE_NAME.test(file)) continue;
      const path = resolve(snapshotDir, file);
      rmSync(path, { force: true });
      cleared.push(path);
    }
  } catch {
    // best-effort: capture proceeds even if the folder cannot be cleaned
  }
  return cleared;
}

export function clearedNote(count: number, snapshotDir: string): string {
  return `cleared ${count} stills from an earlier run in ${resolve(snapshotDir)}`;
}

/** --keep names a still by its millisecond label, so two distinct times may not share one. */
function assertDistinctKeepNames(times: number[]): void {
  const timeByLabel = new Map<string, number>();
  for (const time of times) {
    const label = formatSnapshotTimestamp(time);
    const other = timeByLabel.get(label);
    if (other !== undefined && other !== time) {
      throw new CliUsageError(
        `--keep would name both ${other} and ${time} at-${label}.png; pass times at least 1 ms apart`,
      );
    }
    timeByLabel.set(label, time);
  }
}

/** Shows media by the runtime's visibility rule. A clip held at the composition end, or past the end of a source
 * shorter than its slot, samples one nominal 30fps frame inside the source; FFmpeg has no frame at or past its end. */
export function resolveSnapshotVideoFrameTime(input: {
  globalTime: number;
  clipStart: number;
  clipDuration: number;
  relativeTime: number;
  sourceDuration: number;
  compositionDuration: number;
}): number | null {
  const { globalTime, clipStart, clipDuration, sourceDuration, compositionDuration } = input;
  const clipEnd = clipStart + clipDuration;
  if (!isClipVisibleAt(globalTime, clipStart, clipEnd, compositionDuration)) return null;
  const relativeTime =
    globalTime < clipStart ? Math.max(0, input.relativeTime) : input.relativeTime;
  if (relativeTime < 0) return null;
  const pastSource = sourceDuration > 0 && relativeTime >= sourceDuration;
  if (isInClipWindow(globalTime, clipStart, clipEnd) && !pastSource) return relativeTime;

  const sourceEnd = sourceDuration > 0 ? sourceDuration : relativeTime;
  return Math.max(0, Math.min(relativeTime, sourceEnd - 1 / 30));
}

/** Prefer the runtime's canonical absolute media start. The authored value is
 * only a compatibility fallback for pages built with an older runtime. */
export function resolveSnapshotVideoClipStart(input: {
  authoredStart: number;
  runtimeResolvedStart: number | null;
}): number {
  return input.runtimeResolvedStart ?? input.authoredStart;
}

/** Match runtime/render timing: a `rate` lane in data-automation wins, then the authored
 * data-playback-rate, then the browser default, all through the runtime's own reader. */
export function resolveSnapshotVideoRateSpec(input: {
  authoredRate: string | undefined;
  authoredAutomation?: string | undefined;
  defaultRate: number;
}): RateSpec {
  const authoredRate = Number.parseFloat(input.authoredRate ?? "");
  const attrs: Record<string, string | undefined> = {
    "data-playback-rate":
      Number.isFinite(authoredRate) && authoredRate > 0
        ? input.authoredRate
        : String(input.defaultRate),
    "data-automation": input.authoredAutomation,
  };
  return readElementRateSpec({ getAttribute: (name) => attrs[name] ?? null });
}

export interface SnapshotVideoCandidate {
  id: string;
  src: string;
  authoredStart: number;
  authoredRate: string | undefined;
  authoredAutomation: string | undefined;
  defaultRate: number;
  runtimeResolvedStart: number | null;
  authoredDuration: number | null;
  srcDuration: number;
  mediaStart: number;
  loop: boolean;
  displayedSize: number;
  devicePixelRatio: number;
}

/** The source frame a <video> shows at `time`, or null when the clip is not on screen then. */
export function activeVideoAt(
  candidate: SnapshotVideoCandidate,
  time: number,
  compositionDuration: number,
) {
  const start = resolveSnapshotVideoClipStart(candidate);
  const playbackRate = resolveSnapshotVideoRateSpec(candidate);
  const duration =
    candidate.authoredDuration ??
    (candidate.srcDuration > 0
      ? Math.max(0, timeAtSourceTime(playbackRate, candidate.srcDuration - candidate.mediaStart))
      : Number.POSITIVE_INFINITY);
  let relTime = sourceTimeAt(playbackRate, time - start) + candidate.mediaStart;
  if (
    candidate.loop &&
    candidate.srcDuration > candidate.mediaStart &&
    relTime >= candidate.srcDuration
  ) {
    relTime =
      candidate.mediaStart +
      ((relTime - candidate.mediaStart) % (candidate.srcDuration - candidate.mediaStart));
  }
  const frameTime = resolveSnapshotVideoFrameTime({
    globalTime: time,
    clipStart: start,
    clipDuration: duration,
    relativeTime: relTime,
    sourceDuration: candidate.srcDuration,
    compositionDuration,
  });
  return frameTime === null
    ? null
    : { ...candidate, start, playbackRate, duration, relTime: frameTime };
}

export function requireSnapshotFfmpeg(ffmpegPath: string | undefined): string {
  if (ffmpegPath) return ffmpegPath;
  throw new Error(
    `FFmpeg is required to extract video frames for snapshots. ${getFFmpegInstallHint()}`,
  );
}

interface SnapshotCompositePage {
  evaluate<T>(callback: () => T): Promise<Awaited<T>>;
  screenshot(options: {
    type: "jpeg";
    quality: number;
    clip: { x: number; y: number; width: number; height: number };
  }): Promise<Uint8Array>;
}

/** Recapture canvas composites once the decoded video overlays have been injected. */
export async function recaptureSnapshotComposite(page: SnapshotCompositePage): Promise<void> {
  const hasPageComposite = await page.evaluate(async () => {
    const runtimeWindow = window as Window & {
      __hf_page_composite_prepare?: () => Promise<boolean>;
      __hf_page_composite_resolve?: () => boolean;
    };
    if (typeof runtimeWindow.__hf_page_composite_resolve !== "function") return false;
    await runtimeWindow.__hf_page_composite_prepare?.();
    return true;
  });
  if (hasPageComposite) {
    // The 1×1 screenshot forces Chrome to publish updated subtree paint records
    // after injection, so resolve can consume them without a fixed delay.
    await page.screenshot({
      type: "jpeg",
      quality: 1,
      clip: { x: 0, y: 0, width: 1, height: 1 },
    });
    await page.evaluate(() => {
      const runtimeWindow = window as Window & {
        __hf_page_composite_resolve?: () => boolean;
      };
      runtimeWindow.__hf_page_composite_resolve?.();
    });
  }
}

export function containingSourceFrameIndex(timestamps: readonly number[], time: number): number {
  if (!Number.isFinite(time)) return -1;
  const tolerance = 16 * Number.EPSILON * Math.max(1, Math.abs(time));
  let index = -1;
  for (const [i, timestamp] of timestamps.entries()) {
    if (timestamp > time + tolerance) break;
    index = i;
  }
  return index;
}

class FrameExtractError extends Error {}

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

const ffmpegFailure = (result: { stderr: string; code: number | null }) =>
  lastLine(result.stderr) ||
  (result.code === 255
    ? "FFmpeg was stopped before it finished (exit code 255 with no error output means it was killed, such as by a time limit)"
    : `exit code ${result.code}`);
const processStderr = (error: unknown) =>
  error instanceof Error && "stderr" in error && typeof error.stderr === "string"
    ? error.stderr
    : "";

const REMOTE_VIDEO_DIR = join(tmpdir(), "hyperframes-snapshot-media");

/** A local copy of a remote clip, since an FFmpeg built without network protocols (the Desktop app's) reads no URL. */
export async function remoteVideoInput(url: string, download = downloadToTemp): Promise<string> {
  try {
    return await download(url, REMOTE_VIDEO_DIR, FFMPEG_EXTRACT_TIMEOUT_MS);
  } catch {
    return url;
  }
}

/** Keyframe seek plus the decoded-time threshold that selects the frame containing `time`, or null. */
export async function probeContainingSourceFrameSeek(
  videoPath: string,
  time: number,
  holdLastFrame: boolean,
): Promise<{ seek?: number; select?: number; decodesFrom?: number } | null> {
  const ffprobe = findFFprobe();
  // Without ffprobe, fall back to a plain seek: the first frame at or after `time`.
  if (!ffprobe) return { seek: time };
  // Packet timestamps need no decode, so a late sample costs a demux, not a decode from the start.
  const probe = async (
    readIntervals: string,
    entries: string,
  ): Promise<Record<string, unknown> | null> => {
    try {
      const { stdout } = await runCancellableProcess(
        ffprobe,
        [
          ...["-v", "error", "-select_streams", "v:0", "-read_intervals", readIntervals],
          ...["-show_entries", entries, "-of", "json", "--", videoPath],
        ],
        { timeoutMs: FFMPEG_EXTRACT_TIMEOUT_MS, maxBufferBytes: 32 * 1024 * 1024 },
      );
      const parsed: unknown = JSON.parse(stdout);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch (error) {
      throw new FrameExtractError(
        `FFprobe could not read ${videoPath}: ${lastLine(processStderr(error) || String(error))}`,
      );
    }
  };
  const data = await probe("%+#1", "stream=time_base,start_pts:format=start_time,duration");
  if (data === null || !Array.isArray(data.streams)) return null;
  const stream: unknown = data.streams[0];
  if (
    typeof stream !== "object" ||
    stream === null ||
    !("time_base" in stream) ||
    typeof stream.time_base !== "string"
  )
    return null;
  const [numerator, denominator] = stream.time_base.split("/");
  const timeBase = Number(numerator) / Number(denominator);
  if (!Number.isFinite(timeBase) || timeBase <= 0) return null;
  const format = "format" in data ? data.format : null;
  const start =
    typeof format === "object" && format !== null && "start_time" in format
      ? Number(format.start_time)
      : 0;
  const duration =
    typeof format === "object" && format !== null && "duration" in format
      ? Number(format.duration)
      : NaN;
  if (!holdLastFrame && Number.isFinite(duration) && time >= duration) return null;
  const formatStart = Number.isFinite(start) ? start : 0;
  // format.start_time is rounded to microseconds; when the video sets it, use its exact start_pts.
  const startPts =
    "start_pts" in stream && typeof stream.start_pts === "number" ? stream.start_pts : NaN;
  const startTicks =
    Math.abs(startPts * timeBase - formatStart) <= 1e-6 ? startPts : formatStart / timeBase;
  // An absolute end: edit-list preroll packets start before the video, so a relative window can stop short.
  const packetData = await probe(`%${startTicks * timeBase + time + 1}`, "packet=pts,dts,flags");
  if (packetData === null || !Array.isArray(packetData.packets)) return null;
  const packets: { pts: number; dts: number; key: boolean }[] = [];
  for (const packet of packetData.packets) {
    if (typeof packet !== "object" || packet === null) return null;
    const pts = "pts" in packet ? packet.pts : "dts" in packet ? packet.dts : undefined;
    if (typeof pts !== "number") return null;
    const dts = "dts" in packet && typeof packet.dts === "number" ? packet.dts : pts;
    const key = "flags" in packet && typeof packet.flags === "string" && packet.flags.includes("K");
    packets.push({ pts: (pts - startTicks) * timeBase, dts: (dts - startTicks) * timeBase, key });
  }
  // Packets arrive in decode order; B-frames make that differ from presentation order.
  const timestamps = packets.map((packet) => packet.pts).sort((a, b) => a - b);
  // Before the video's first frame (audio leads it), hold that frame, as the engine does.
  const index = Math.max(0, containingSourceFrameIndex(timestamps, time));
  if (timestamps.length === 0 || !Number.isFinite(time)) return null;
  const frame = timestamps[index]!;
  const previous = timestamps[index - 1] ?? frame - 0.001;
  const mid = (previous + frame) / 2;
  // Demuxers land on a keyframe of their choosing (MPEG-TS often a later one), so observe where a
  // seek lands; a seek to exactly that keyframe trims its leading frames, so it is `start_t`.
  const ffmpeg = findFFmpeg();
  const landing = async (seek: number) => {
    const raw = ffmpeg ? await probeSeekLanding(ffmpeg, videoPath, seek) : null;
    return raw === null ? null : raw - startTicks * timeBase;
  };
  const candidates = packets.filter(
    (packet) => packet.key && packet.pts > 0 && packet.pts <= frame,
  );
  for (const candidate of candidates.reverse().slice(0, 3)) {
    const landed = await landing(candidate.pts);
    if (landed === null) break;
    if (landed <= 0 || landed > frame) continue;
    // An index that places this keyframe after its own time lands on the one before; an accurate seek
    // to the keyframe's time decodes from there and drops everything before it.
    if (landed < candidate.pts - 1e-6)
      return { seek: candidate.pts, select: mid - candidate.pts, decodesFrom: candidate.pts };
    const again = Math.abs(landed - candidate.pts) < 1e-6 ? landed : await landing(landed);
    if (again !== null && Math.abs(again - landed) < 1e-6)
      return { seek: landed, select: mid - landed, decodesFrom: landed };
  }
  // No usable keyframe landing: an accurate seek to the gap before the frame decodes up to it and drops the rest.
  // An exact frame time keeps start_t at 0; a time between frames would shift the select by the gap to the next frame.
  const from = timestamps.filter((t) => t > 0 && t <= mid - FALLBACK_SEEK_LEAD_SECONDS).at(-1) ?? 0;
  const keyframeBefore = packets.filter((packet) => packet.key && packet.pts <= from).at(-1);
  return from > 0
    ? { seek: from, select: mid - from, decodesFrom: keyframeBefore?.pts ?? 0 }
    : { select: mid - (timestamps.find((t) => t >= 0) ?? frame) };
}

/** Raw stream time of the packet an input seek to `seek` lands on, read without decoding. */
async function probeSeekLanding(
  ffmpeg: string,
  videoPath: string,
  seek: number,
): Promise<number | null> {
  try {
    const { stdout } = await runCancellableProcess(
      ffmpeg,
      [
        ...["-v", "error", "-copyts", "-noaccurate_seek", "-ss", String(seek), "-i", videoPath],
        ...["-map", "0:v:0", "-c", "copy", "-frames:v", "1", "-f", "framecrc", "-"],
      ],
      { timeoutMs: FFMPEG_EXTRACT_TIMEOUT_MS, maxBufferBytes: 1024 * 1024 },
    );
    const base = /^#tb 0: (\d+)\/(\d+)/m.exec(stdout);
    const row = /^0,\s*-?\d+,\s*(-?\d+),/m.exec(stdout);
    if (!base || !row) return null;
    return (Number(row[1]) * Number(base[1])) / Number(base[2]);
  } catch {
    return null;
  }
}

let warnedColourUnknown = false;

function warnColourUnknownOnce(): void {
  if (warnedColourUnknown) return;
  warnedColourUnknown = true;
  console.warn(
    `   ${c.warn("⚠")} snapshot colours may differ from render: install ffmpeg/ffprobe so video colours can be matched`,
  );
}

let warnedNoHdrFilters = false;

function warnNoHdrFiltersOnce(): void {
  if (warnedNoHdrFilters) return;
  warnedNoHdrFilters = true;
  console.warn(
    `   ${c.warn("⚠")} A video in this project is HDR, but this ffmpeg has no zscale/tonemap (libzimg), so the still shows it as the browser does and will not match an SDR export. Install an ffmpeg with libzimg.`,
  );
}

type VideoMetadata = Awaited<ReturnType<typeof extractMediaMetadata>>;

/** The source's colour metadata and, for HDR footage, the SDR export's tone map, so a still matches the render. */
async function videoColour(ffmpegPath: string, videoPath: string) {
  const metadata: VideoMetadata | null = findFFprobe()
    ? await extractMediaMetadata(videoPath)
    : null;
  if (!metadata) warnColourUnknownOnce();
  const toneMap =
    metadata && isHdrColorSpace(metadata.colorSpace)
      ? hdrToSdrToneMapFilter(
          metadata.colorSpace ?? {},
          parseFirstFrameColour(
            (
              await runFfmpegOnce(
                ffmpegPath,
                firstFrameColourArgs(videoPath),
                FFMPEG_EXTRACT_TIMEOUT_MS,
              )
            ).stderr,
          ),
        )
      : null;
  return { metadata, toneMap };
}

function frameFilters(
  select: number | undefined,
  displayedPixels: number,
  metadata: VideoMetadata | null,
  toneMapFilter: string | null,
): string[] {
  const filters: string[] = [];
  if (select !== undefined) filters.push(`select=gte(t-start_t\\,${select})`);
  if (metadata) {
    if (toneMapFilter) filters.push(toneMapFilter);
    filters.push(...sdrCanvasColourFilters(metadata, toneMapFilter !== null));
  }
  // Shrink so the short side still covers the displayed box at any rotation or fit; never enlarge.
  if (displayedPixels > 0) {
    filters.push(
      `scale='min(iw,${displayedPixels})':'min(ih,${displayedPixels})':force_original_aspect_ratio=increase`,
    );
  }
  return filters;
}

export async function extractVideoFrameToBuffer(
  videoPath: string,
  timeSeconds: number,
  useVp9AlphaDecoder = false,
  holdLastFrame = false,
  displayedPixels = 0,
): Promise<Buffer | null> {
  const tmp = mkdtempSync(join(tmpdir(), "hf-snapshot-frame-"));
  const outPath = join(tmp, "frame.png");
  try {
    const ffmpegPath = requireSnapshotFfmpeg(findFFmpeg());
    const seek = await probeContainingSourceFrameSeek(
      videoPath,
      Math.max(0, timeSeconds),
      holdLastFrame,
    );
    if (seek === null) return null;
    const { metadata, toneMap } = await videoColour(ffmpegPath, videoPath);
    const frameArgs = (toneMapFilter: string | null): string[] => {
      const args = ["-hide_banner", "-loglevel", "error"];
      if (useVp9AlphaDecoder) args.push("-c:v", "libvpx-vp9");
      if (seek.seek !== undefined) args.push("-ss", String(seek.seek));
      args.push("-i", videoPath, "-map", "0:v:0");
      const filters = frameFilters(seek.select, displayedPixels, metadata, toneMapFilter);
      if (filters.length > 0) args.push("-vf", filters.join(","));
      args.push("-frames:v", "1", "-q:v", "2", "-y", outPath);
      return args;
    };
    let result = await runFfmpegOnce(ffmpegPath, frameArgs(toneMap), FFMPEG_EXTRACT_TIMEOUT_MS);
    if (toneMap && result.code !== 0 && /no such filter/i.test(result.stderr)) {
      warnNoHdrFiltersOnce();
      result = await runFfmpegOnce(ffmpegPath, frameArgs(null), FFMPEG_EXTRACT_TIMEOUT_MS);
    }
    const frameOf = `the frame of ${videoPath} at ${timeSeconds.toFixed(2)}s`;
    if (result.timedOut) {
      throw new FrameExtractError(
        `FFmpeg timed out after ${FFMPEG_EXTRACT_TIMEOUT_MS / 1000}s extracting ${frameOf}`,
      );
    }
    if (result.code !== 0 || !existsSync(outPath)) {
      throw new FrameExtractError(`FFmpeg could not extract ${frameOf}: ${ffmpegFailure(result)}`);
    }
    return readFileSync(outPath);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/** The `select` that keeps the first frame at or after each of `offsets`: one stream, one frame per time. */
export function selectFirstFrameAfterEach(offsets: number[]): string {
  const sinceLast = "if(isnan(prev_selected_t)\\,-1\\,prev_selected_t-start_t)";
  const open = offsets.map((offset) => `gte(t-start_t\\,${offset})*gt(${offset}\\,${sinceLast})`);
  return `select=gt(${open.join("+")}\\,0)`;
}

/** One ffmpeg pass that writes every planned frame of a video: the source decodes from the earliest keyframe once.
 * The frames share one displayed size. Throws unless each time got a frame of its own. */
export async function decodeFramesInOnePass(
  videoPath: string,
  frames: PlannedFrame[],
  useVp9AlphaDecoder = false,
): Promise<Buffer[]> {
  const tmp = mkdtempSync(join(tmpdir(), "hf-snapshot-frames-"));
  try {
    const ffmpegPath = requireSnapshotFfmpeg(findFFmpeg());
    const { metadata, toneMap } = await videoColour(ffmpegPath, videoPath);
    const start = Math.min(...frames.map((frame) => frame.seek));
    // Times inside one source frame share an offset, and so a frame.
    const byOffset = new Map<number, number[]>();
    for (const [index, frame] of frames.entries()) {
      const offset = Number((frame.seek + frame.select - start).toFixed(6));
      byOffset.set(offset, [...(byOffset.get(offset) ?? []), index]);
    }
    const byTime = [...byOffset].sort(([a], [b]) => a - b);
    const passArgs = (toneMapFilter: string | null): string[] => {
      const rest = frameFilters(undefined, frames[0]!.displayedPixels, metadata, toneMapFilter);
      const filters = [selectFirstFrameAfterEach(byTime.map(([offset]) => offset)), ...rest];
      const args = ["-hide_banner", "-loglevel", "error"];
      if (useVp9AlphaDecoder) args.push("-c:v", "libvpx-vp9");
      args.push("-ss", String(start), "-i", videoPath, "-map", "0:v:0", "-vf", filters.join(","));
      args.push("-fps_mode", "passthrough", "-frames:v", String(byTime.length));
      args.push("-q:v", "2", "-y", join(tmp, "%d.png"));
      return args;
    };
    // Each frame keeps the time limit it had when it decoded alone.
    const timeoutMs = FFMPEG_EXTRACT_TIMEOUT_MS * frames.length;
    let result = await runFfmpegOnce(ffmpegPath, passArgs(toneMap), timeoutMs);
    if (toneMap && result.code !== 0 && /no such filter/i.test(result.stderr)) {
      warnNoHdrFiltersOnce();
      result = await runFfmpegOnce(ffmpegPath, passArgs(null), timeoutMs);
    }
    const what = `${frames.length} frames of ${videoPath}`;
    if (result.timedOut) {
      throw new FrameExtractError(`FFmpeg timed out after ${timeoutMs / 1000}s extracting ${what}`);
    }
    const written = (n: number) => join(tmp, `${n}.png`);
    if (result.code !== 0 || !byTime.every((_, i) => existsSync(written(i + 1)))) {
      throw new FrameExtractError(`FFmpeg could not extract ${what}: ${ffmpegFailure(result)}`);
    }
    const buffers: Buffer[] = [];
    for (const [i, [, indexes]] of byTime.entries()) {
      const png = readFileSync(written(i + 1));
      for (const index of indexes) buffers[index] = png;
    }
    return buffers;
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/** A clip whose frame fails becomes a finding naming it and why, so the other frames of the snapshot still land. */
export async function frameOrWarn(
  warnings: string[],
  frame: () => Promise<Buffer | null>,
): Promise<Buffer | null> {
  try {
    return await frame();
  } catch (error) {
    if (!(error instanceof FrameExtractError)) throw error;
    warnings.push(error.message);
    console.warn(`   ${c.warn("⚠")} ${error.message}`);
    return null;
  }
}

export function extractVideoFrameOrWarn(
  warnings: string[],
  ...args: Parameters<typeof extractVideoFrameToBuffer>
): Promise<Buffer | null> {
  return frameOrWarn(warnings, () => extractVideoFrameToBuffer(...args));
}

export const examples: Example[] = [
  ["Capture 5 key frames from a composition", "snapshot capture"],
  ["Capture 10 evenly-spaced frames", "snapshot capture --frames 10"],
  ["View the 3D stage from an isometric angle", "snapshot capture --angle iso"],
  ["Zoom into an element for a high-density crop", "snapshot --zoom '#headline'"],
  [
    "Zoom into an exact pixel region at 2x density",
    "snapshot --zoom 100,50,400,300 --zoom-scale 2",
  ],
  [
    "Pair each frame with the reference footage at the same time",
    "snapshot --at 1.5,4.3,8.1 --against ref.mp4",
  ],
];

const DEFAULT_DESCRIBE_PROMPT =
  "Describe this video composition frame in 1-2 sentences. Be specific and factual: what elements are visible, what text appears, is the frame blank/black/loading, what is the composition. Flag any obvious problems.";

/**
 * The Gemini prompt for `--describe`, or null when frames stay local. Opt-in:
 * no flag and `--describe false` return null; a bare `--describe` (or `true`)
 * uses the default prompt; any other value is the question to ask.
 */
function resolveDescribePrompt(value: unknown): string | null {
  if (value === undefined || value === false) return null;
  const text = String(value).trim();
  if (text === "false") return null;
  if (text === "" || text === "true") return DEFAULT_DESCRIBE_PROMPT;
  return text;
}

/** `--zoom-scale`: the deviceScaleFactor used for zoomed crops. Defaults to 3;
 * falls back to the default for anything that doesn't parse as a positive number. */
export function parseZoomScale(value: unknown): number {
  const parsed = parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ZOOM_SCALE;
}

// Seeking to exactly the end renders blank, so the tail frame backs off 3% of the duration,
// by at least 50 ms and at most 250 ms.
const TAIL_BACKOFF_MIN_SECONDS = 0.05;
const TAIL_BACKOFF_MAX_SECONDS = 0.25;

export function tailFrameTime(duration: number): number {
  const backoff = Math.min(
    TAIL_BACKOFF_MAX_SECONDS,
    Math.max(TAIL_BACKOFF_MIN_SECONDS, duration * 0.03),
  );
  return Math.max(0, duration - backoff);
}

/**
 * Pick the seek positions to screenshot. Pure so the "tail is always captured"
 * guarantee is unit-testable (FINDING [7]: evenly-spaced --at times skipped the
 * final beat and short hero beats with no signal).
 *
 * - No --at: evenly-spaced frames, but the LAST point is moved off the exact
 *   duration to `tailFrameTime` so it isn't blank.
 * - With --at: the user's exact times are honoured, plus a guaranteed
 *   end-of-timeline frame appended (unless `includeEnd` is false), so the tail
 *   is never silently skipped. A near-duplicate of the tail is not added twice.
 *
 * `appendedTail` flags that the readable-tail frame was added on top of the
 * caller's request — used to warn that short sub-interval beats between samples
 * may still be missed and need explicit --at.
 */
export function computeSnapshotTimes(
  duration: number,
  opts: { frames: number; at?: number[]; includeEnd?: boolean },
): { times: number[]; appendedTail: boolean } {
  const includeEnd = opts.includeEnd !== false;
  const tail = tailFrameTime(duration);
  const round = (t: number) => Math.round(t * 1000) / 1000;

  if (opts.at?.length) {
    // `--at` is an evidence contract: callers may pass exact fractional-frame
    // boundaries (for example 101 / 30). Do not normalize their requested
    // positions; rounding to milliseconds can move a transition sample to the
    // other side of the boundary.
    const times = [...opts.at];
    // Only append if the user didn't already sample at/near the readable tail.
    const hasTail = times.some((t) => Math.abs(t - tail) < 0.05 || t >= duration);
    if (includeEnd && duration > 0 && !hasTail) {
      return { times: [...times, round(tail)], appendedTail: true };
    }
    return { times, appendedTail: false };
  }

  const n = opts.frames;
  if (n <= 1) return { times: [round(duration / 2)], appendedTail: false };
  const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * duration);
  // Replace the final (exact-duration, blank) point with the readable tail.
  if (includeEnd) times[times.length - 1] = tail;
  return { times: times.map(round), appendedTail: false };
}

export function serveCapturePage(projectDir: string, html: string, proxy: boolean | undefined) {
  return serveStaticProjectHtml(projectDir, html, undefined, [], proxy === true);
}

/**
 * Render key frames from a composition as PNG screenshots.
 * The agent can Read these to verify its output visually.
 */
async function captureSnapshots(
  projectDir: string,
  opts: {
    frames?: number;
    range?: SnapshotRange;
    composition?: string;
    timeout?: number;
    at?: number[];
    outputDir?: string;
    angle?: Camera;
    includeEnd?: boolean;
    zoom?: ZoomTarget;
    zoomScale?: number;
    autoProxy?: boolean;
    browserGpuMode?: BrowserGpuMode;
    /** Reference video: save its frame at each captured time plus a render|reference pair. */
    against?: string;
    /** Add to outputDir without clearing it; name each still by its time, not its place in the run. */
    keep?: boolean;
    /** Capture the review set (beats, seams) instead of evenly spaced frames. */
    review?: boolean;
    /** Progress lines; `--json` sends them to stderr so stdout stays one envelope. */
    log?: (message: string) => void;
  },
): Promise<CapturedSnapshots> {
  const startedAt = performance.now();
  const log = opts.log ?? ((message: string) => console.log(message));
  const { bundleWithLocalizedFonts } = await import("../utils/bundleWithLocalizedFonts.js");

  const capture = await captureArtifactRevision(projectDir).catch(warnSnapshotsNotRecorded);
  const invocation = randomUUID();
  const artifacts: Array<{
    id: string;
    image: string;
    time: number;
    metadata: Record<string, unknown>;
  }> = [];
  const replaced: string[] = [];
  const warnings: string[] = [];
  let completed = false;
  const numFrames = opts.frames ?? 5;
  let review: ReviewPlan | undefined;
  let reviewList: ReviewFrame[] | undefined;
  const reviewPaths = new Map<ReviewFrame, string>();

  // Localize fonts (embed remote @font-face as data URIs, matching the render
  // path) so snapshots render the real font instead of a fallback sans.
  const html = await bundleWithLocalizedFonts(projectDir);
  const server = await serveCapturePage(projectDir, html, opts.autoProxy);

  const savedPaths: string[] = [];
  let pairSheetFailure: string | null = null;

  try {
    const {
      browser: chromeBrowser,
      page,
      renderReadyTimedOut,
    } = await openSettledCompositionPage(html, server.url, {
      renderReadyTimeoutMs: opts.timeout ?? RENDER_READY_TIMEOUT_MS,
      renderReadyWarningSuffix: "snapshots may be inaccurate",
      browserGpuMode: opts.browserGpuMode,
    });

    try {
      if (renderReadyTimedOut)
        throw await renderNotReadyError(page, opts.timeout ?? RENDER_READY_TIMEOUT_MS);
      // Font verification — split into loaded / errored / unused. Only status
      // "error" is a real failure; a face still "unloaded"/"loading" after
      // document.fonts.ready + the settle wait was simply never requested by any
      // rendered text (an unused @font-face), so it is reported as "unused", not
      // FAILED — printing it as FAILED alongside "loaded" read as a contradiction.
      const fontReport = await page
        .evaluate(() => {
          const loaded: string[] = [];
          const errored: string[] = [];
          const unused: string[] = [];
          (document as any).fonts.forEach((f: any) => {
            const entry = `${f.family} (${f.weight} ${f.style})`;
            if (f.status === "loaded") loaded.push(entry);
            else if (f.status === "error") errored.push(entry);
            else unused.push(entry);
          });
          return { loaded, errored, unused };
        })
        .catch(() => ({ loaded: [] as string[], errored: [] as string[], unused: [] as string[] }));

      if (
        fontReport.loaded.length > 0 ||
        fontReport.errored.length > 0 ||
        fontReport.unused.length > 0
      ) {
        const parts = [`${fontReport.loaded.length} loaded`];
        if (fontReport.errored.length > 0) parts.push(`${fontReport.errored.length} failed`);
        if (fontReport.unused.length > 0) parts.push(`${fontReport.unused.length} unused`);
        log(`\n   ${c.dim("Fonts:")} ${parts.join(", ")}`);
        if (fontReport.errored.length > 0) {
          log(`   ${c.error("Fonts FAILED:")} ${fontReport.errored.join(", ")}`);
        }
      }

      if (fontReport.errored.length)
        warnings.push(`Fonts failed: ${fontReport.errored.join(", ")}`);

      const duration = await page.evaluate(() => {
        const win = window as any;
        if (typeof win.__player?.getDuration === "function") {
          const d = win.__player.getDuration();
          if (Number.isFinite(d) && d > 0) return d;
        }
        const root = document.querySelector("[data-composition-id][data-duration]");
        if (root) return parseFloat(root.getAttribute("data-duration") ?? "0");
        return 0;
      });

      if (duration <= 0 && !opts.at?.length) {
        return { paths: [], cleared: [], warnings, pairSheetsSkipped: false };
      }

      const readTiming = () =>
        page.evaluate(() => ({
          html: document.documentElement.outerHTML,
          durations: Object.fromEntries(
            Object.entries((window as any).__timelines ?? {}).map(([id, timeline]) => [
              id,
              Number((timeline as any).duration?.()),
            ]),
          ),
        }));
      let range = opts.range;
      if (opts.composition && !opts.review) {
        const timing = await readTiming();
        range = resolveSnapshotCompositionRange(
          timing.html,
          timing.durations,
          opts.composition,
          duration,
        );
      }
      if (opts.review) {
        const timing = await readTiming();
        const timeline = resolveReviewTimeline(
          timing.html,
          timing.durations,
          duration,
          opts.composition,
        );
        // The render's last frame is one 30fps frame before the end, where clips are still mounted.
        review = planReview(timeline, Math.min(timeline.window[1], duration) - 1 / 30);
        reviewList = reviewFrames(review);
      }
      const { times: positions, appendedTail } = reviewList
        ? { times: reviewList.map((frame) => frame.time), appendedTail: false }
        : range
          ? {
              times: sampleSnapshotRange(range, numFrames, duration, !!opts.composition),
              appendedTail: false,
            }
          : computeSnapshotTimes(duration, {
              frames: numFrames,
              at: opts.at,
              includeEnd: opts.includeEnd,
            });
      if (range)
        log(
          `   Sampling ${positions.length} frames within ${range[0]}–${range[1]}s${opts.composition ? ` (composition ${opts.composition})` : ""}`,
        );
      if (review)
        log(
          `   Review: ${review.beats.length} beat(s) and ${review.seams.length} seam(s) within ${review.window[0]}–${review.window[1]}s${opts.composition ? ` (composition ${opts.composition})` : ""}`,
        );
      if (appendedTail) {
        log(
          `   ${c.dim(`Note: added an end-of-timeline frame at ${positions[positions.length - 1]!.toFixed(2)}s. Short beats between your --at times may still be skipped — pass them explicitly.`)}`,
        );
      }

      // Orthogonal camera (FINDING [10]) — re-applied after each seek inside the
      // loop, since renderSeek may touch the stage's inline transform.
      const cameraExpr =
        opts.angle && (opts.angle.yaw !== 0 || opts.angle.pitch !== 0)
          ? `(${orbitStageSource()})(${JSON.stringify(opts.angle)})`
          : null;

      const snapshotDir = opts.outputDir ?? artifactDirectory(projectDir, "snapshots");
      mkdirSync(snapshotDir, { recursive: true });
      if (!opts.keep) replaced.push(...clearEarlierStills(snapshotDir));
      if (replaced.length > 0) {
        log(`   ${c.warn("⚠")} ${clearedNote(replaced.length, snapshotDir)}`);
      }

      // Chrome-headless ignores programmatic <video>.currentTime writes, so
      // we extract frames via FFmpeg and overlay them as <img> elements.
      //
      // The engine's injectVideoFramesBatch returns the subset of videoIds it
      // actually painted (skipped ancestor-hidden videos are excluded).
      // Snapshot doesn't use the return value, but the local type must match
      // the real export — a `Promise<void>` shape rejects the `as` cast on
      // the dynamic import.
      type InjectFn = (
        page: unknown,
        updates: Array<{ videoId: string; dataUri: string }>,
      ) => Promise<string[]>;
      type SyncVisibilityFn = (page: unknown, activeVideoIds: string[]) => Promise<void>;
      type ExtractMediaMetadataFn = (
        filePath: string,
      ) => Promise<{ videoCodec: string; hasAlpha: boolean }>;
      let injectVideoFramesBatch: InjectFn | null = null;
      let syncVideoFrameVisibility: SyncVisibilityFn | null = null;
      let extractMediaMetadata: ExtractMediaMetadataFn | null = null;
      try {
        const engine = (await import("@hyperframes/engine")) as {
          injectVideoFramesBatch: InjectFn;
          syncVideoFrameVisibility: SyncVisibilityFn;
          extractMediaMetadata: ExtractMediaMetadataFn;
        };
        injectVideoFramesBatch = engine.injectVideoFramesBatch;
        syncVideoFrameVisibility = engine.syncVideoFrameVisibility;
        extractMediaMetadata = engine.extractMediaMetadata;
      } catch {
        // Engine unavailable in this install — snapshot still runs, but any
        // <video data-start> will screenshot black (chrome-headless ignores
        // programmatic currentTime writes). Say so instead of silently
        // shipping black frames (two wild Windows reports).
        warnings.push("Video frame extraction engine unavailable");
        console.warn(
          `   ${c.warn("⚠")} @hyperframes/engine unavailable — <video> elements will appear black in snapshots. Verify media via a draft render's extracted frames instead.`,
        );
      }
      const alphaDecoderCache = new Map<string, Promise<boolean>>();
      const remoteCopies = new Map<string, Promise<string>>();
      const localCopy = (href: string): Promise<string> => {
        const copy = remoteCopies.get(href) ?? remoteVideoInput(href);
        remoteCopies.set(href, copy);
        return copy;
      };
      const shouldUseVp9AlphaDecoder = (filePath: string): Promise<boolean> => {
        if (!extractMediaMetadata) return Promise.resolve(false);
        const cached = alphaDecoderCache.get(filePath);
        if (cached) return cached;
        const pending = extractMediaMetadata(filePath)
          .then((meta) => meta.hasAlpha && meta.videoCodec === "vp9")
          .catch(() => false);
        alphaDecoderCache.set(filePath, pending);
        return pending;
      };

      const hasPlayer = await page.evaluate(() => !!(window as any).__player);
      if (!hasPlayer) {
        console.warn(`   ${c.warn("⚠")} No player API — seeks will be skipped`);
      }

      const frameBank = createFrameBank({
        probe: probeContainingSourceFrameSeek,
        decode: async (path, frames) =>
          decodeFramesInOnePass(
            path,
            frames,
            /^https?:\/\//i.test(path) ? false : await shouldUseVp9AlphaDecoder(path),
          ),
      });
      const plannedClips = new Set<string>();
      const loopStartedAt = performance.now();
      let seekMs = 0;
      let videoMs = 0;

      for (let i = 0; i < positions.length; i++) {
        const time = positions[i]!;
        console.error(`[hyperframes] snapshot: frame ${i + 1}/${positions.length} at ${time}s`);

        const seekOptions = { exactTime: true, waitForImagesMs: SCREENSHOT_IMAGE_WAIT_MS };
        const seekStartedAt = performance.now();
        await atStep(`seeking to ${time}s, frame ${i + 1} of ${positions.length}`, () =>
          seekCompositionTimelineOnly(page, time, seekOptions),
        );
        seekMs += performance.now() - seekStartedAt;

        if (cameraExpr) await page.evaluate(cameraExpr);

        if (injectVideoFramesBatch && syncVideoFrameVisibility) {
          const candidates = await page.evaluate(() => {
            const runtimeWindow = window as Window & {
              __hfResolveMediaStartSeconds?: (element: Element) => number;
            };
            return Array.from(document.querySelectorAll("video")).map((el) => {
              const v = el as HTMLVideoElement;
              const box = v.getBoundingClientRect();
              const authoredStart = parseFloat(v.dataset.start ?? "0") || 0;
              const runtimeResolvedStart = runtimeWindow.__hfResolveMediaStartSeconds?.(v);
              const mediaStart =
                parseFloat(v.dataset.playbackStart ?? v.dataset.mediaStart ?? "0") || 0;
              const rawDuration = parseFloat(v.dataset.duration ?? "");
              const srcDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
              return {
                id: runtimeWindow.__hfMediaId?.(v) || v.id,
                src: v.currentSrc || v.src,
                authoredStart,
                authoredRate: v.dataset.playbackRate,
                authoredAutomation: v.dataset.automation,
                defaultRate: v.defaultPlaybackRate,
                runtimeResolvedStart:
                  runtimeResolvedStart !== undefined && Number.isFinite(runtimeResolvedStart)
                    ? runtimeResolvedStart
                    : null,
                authoredDuration:
                  Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null,
                srcDuration: srcDur,
                mediaStart,
                loop: v.loop,
                displayedSize: Math.max(box.width, box.height),
                devicePixelRatio: window.devicePixelRatio,
              };
            });
          });
          let unreadable = 0;
          const active = candidates.flatMap((candidate) => {
            const video = activeVideoAt(candidate, time, duration);
            if (!video) return [];
            if (!candidate.id || !candidate.src) {
              unreadable += 1;
              return [];
            }
            return [video];
          });

          const videoStartedAt = performance.now();
          const extracted = await runWithConcurrencyLimit(
            active,
            VIDEO_FRAME_EXTRACT_CONCURRENCY,
            async (v) => {
              // Prefer the project-local file; remote http(s) clips go to FFmpeg directly,
              // since headless Chrome can't seek them and they would render blank.
              let ffmpegInput: string | null = null;
              let inputIsLocal = false;
              try {
                const url = new URL(v.src);
                const decodedPath = decodeURIComponent(url.pathname).replace(/^\//, "");
                const candidate = resolve(projectDir, decodedPath);
                const rel = relative(projectDir, candidate);
                if (!rel.startsWith("..") && !isAbsolute(rel) && existsSync(candidate)) {
                  ffmpegInput = candidate;
                  inputIsLocal = true;
                } else if (url.protocol === "http:" || url.protocol === "https:") {
                  ffmpegInput = await localCopy(url.href);
                  inputIsLocal = ffmpegInput !== url.href;
                }
              } catch {
                /* unresolvable src (e.g. blob:, data:) — skip */
              }
              if (!ffmpegInput) return null;
              // The VP9-alpha probe has no timeout, so only local files get it;
              // a stalled remote host must not wedge snapshot before the bounded extract.
              const useVp9AlphaDecoder = inputIsLocal
                ? await shouldUseVp9AlphaDecoder(ffmpegInput)
                : false;
              const displayedPixels = Math.ceil(
                v.displayedSize *
                  (opts.zoom ? (opts.zoomScale ?? DEFAULT_ZOOM_SCALE) : v.devicePixelRatio),
              );
              const wantAt = (t: number): FrameWant | null => {
                const shown = activeVideoAt(v, t, duration);
                if (!shown) return null;
                const holdLastFrame =
                  shown.srcDuration > 0 && shown.relTime >= shown.srcDuration - 1;
                return { time: Math.max(0, shown.relTime), displayedPixels, holdLastFrame };
              };
              // Every time this clip will be asked for is planned at its first request, so one pass decodes them.
              const planKey = `${v.id}\0${ffmpegInput}`;
              if (!plannedClips.has(planKey)) {
                plannedClips.add(planKey);
                await frameBank.plan(
                  ffmpegInput,
                  positions.slice(i).flatMap((t) => wantAt(t) ?? []),
                );
              }
              const want = wantAt(time)!;
              const banked = await frameBank.take(ffmpegInput, want);
              const png = await frameOrWarn(
                warnings,
                async () =>
                  banked ??
                  extractVideoFrameToBuffer(
                    ffmpegInput,
                    want.time,
                    useVp9AlphaDecoder,
                    want.holdLastFrame,
                    want.displayedPixels,
                  ),
              );
              if (!png) return null;
              return { videoId: v.id, dataUri: `data:image/png;base64,${png.toString("base64")}` };
            },
          );
          const updates = extracted.filter((update) => update !== null);

          const onScreen = active.length + unreadable;
          if (updates.length < onScreen) {
            const missed = onScreen - updates.length;
            warnings.push(`${missed} video frames missing at ${time}s`);
            console.warn(
              `   ${c.warn("⚠")} ${missed}/${onScreen} active <video> frame(s) could not be extracted at ${time.toFixed(1)}s — those videos will appear black/stale in this snapshot`,
            );
          }

          // Sync visibility even when empty — clears stale overlays from prior seeks
          try {
            if (updates.length > 0) {
              await injectVideoFramesBatch(page, updates);
            }
            await syncVideoFrameVisibility(
              page,
              active.map((a) => a.id),
            );
          } catch {
            warnings.push(`Video injection failed at ${time}s`);
            console.warn(
              `   ${c.warn("⚠")} video frame injection failed at ${time.toFixed(1)}s — <video> elements will appear black/stale in this snapshot`,
            );
          }
          videoMs += performance.now() - videoStartedAt;
        }

        warnUnsettledImages(await settleCompositionSeek(page, seekOptions), time, warnings);
        await recaptureSnapshotComposite(page);

        const timeLabel = formatSnapshotTimestamp(time);
        const slot = opts.keep
          ? `at-${timeLabel}`
          : `${String(i).padStart(2, "0")}-at-${timeLabel}`;
        const reviewFrame = reviewList?.[i];
        const filename = reviewFrame
          ? reviewFrame.file
          : opts.keep
            ? `${slot}.png`
            : `frame-${slot}.png`;
        const framePath = join(snapshotDir, filename);

        let crop: { x: number; y: number; width: number; height: number } | undefined;
        if (opts.zoom) {
          // Clip screenshot at a raised deviceScaleFactor — never CSS zoom or
          // viewport resizing — so the composition's own layout is untouched.
          const canvas = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          }));
          const region = await resolveCropRegion(page, opts.zoom, canvas);
          if (!region) {
            warnings.push(`Crop target unavailable at ${time}s`);
            console.error(
              `   ${c.warn("⚠")} --zoom target has no visible box at ${time.toFixed(1)}s — frame skipped`,
            );
            continue;
          }
          crop = region;
          const buffer = await captureRegionCrop(
            page,
            region,
            opts.zoomScale ?? DEFAULT_ZOOM_SCALE,
          );
          writeCaptureFileSync(framePath, buffer);
        } else {
          writeCaptureFileSync(
            framePath,
            await atStep(`capturing the frame at ${time}s`, () =>
              page.screenshot({ type: "png", omitBackground: true }),
            ),
          );
        }
        artifacts.push({
          id: `${invocation}-${i}`,
          image: resolve(framePath),
          time,
          metadata: {
            ...pngDimensions(framePath),
            crop,
            zoom: opts.zoom,
            zoomScale: opts.zoom ? (opts.zoomScale ?? DEFAULT_ZOOM_SCALE) : 1,
            angle: opts.angle,
            browserGpuMode: opts.browserGpuMode,
            ...(reviewFrame
              ? { review: { role: reviewFrame.role, label: reviewFrame.label } }
              : {}),
          },
        });
        if (reviewFrame) reviewPaths.set(reviewFrame, framePath);
        if (opts.against) {
          // Frame-exact reference frame beside the render, so a rebuild can be
          // checked against its footage without hand-rolled ffmpeg + montage.
          const warned = warnings.length;
          const refPng = await extractVideoFrameOrWarn(warnings, opts.against, time);
          if (!refPng) {
            const why = warnings.length > warned ? "" : ` has no frame at ${timeLabel}`;
            console.error(`   ${c.warn("⚠")} --against${why} — reference pair skipped`);
          } else {
            const refPath = join(snapshotDir, `ref-${slot}.png`);
            writeCaptureFileSync(refPath, refPng);
            const pairPath = join(snapshotDir, `pair-${slot}.jpg`);
            if (!pairSheetFailure) {
              try {
                const { createContactSheet } = await import("../capture/contactSheet.js");
                await createContactSheet([framePath, refPath], pairPath, {
                  cols: 2,
                  maxImages: 2,
                  cellWidth: 960,
                  labelMode: "custom",
                  labels: ["render", "reference"],
                });
              } catch (err) {
                pairSheetFailure = describeSharpLoadFailure(err);
                if (!pairSheetFailure) throw err;
                console.error(
                  `   ${c.warn("⚠")} Reference pair sheets skipped: ${pairSheetFailure}`,
                );
              }
            }
          }
        }
        // Only the capture itself is a "snapshot": the reference frame and the
        // pair sheet are derived artifacts, like contact-sheet.jpg, so they stay
        // out of savedPaths (count, listing, and --describe all read it).
        const rel = relative(projectDir, framePath);
        savedPaths.push(rel.startsWith("..") || isAbsolute(rel) ? framePath : rel);
      }
      const loopMs = performance.now() - loopStartedAt;
      const stageMs = {
        open: loopStartedAt - startedAt,
        seek: seekMs,
        video: videoMs,
        capture: Math.max(0, loopMs - seekMs - videoMs),
      };
      trackSnapshotRun({
        frames: positions.length,
        videoFrames: frameBank.stats.frames,
        decodePasses: frameBank.stats.passes,
        sharedFrames: frameBank.stats.sharedFrames,
        longestDecodeSeconds: frameBank.stats.longestDecodeSeconds,
        slowStage: (Object.keys(stageMs) as (keyof typeof stageMs)[]).reduce((a, b) =>
          stageMs[b] > stageMs[a] ? b : a,
        ),
      });
      completed = true;
    } finally {
      await chromeBrowser.close();
    }
  } finally {
    await server.close();
    const recorded = capture
      ? await recordSnapshotArtifacts(
          projectDir,
          capture,
          artifacts,
          opts.zoom,
          warnings,
          completed,
          log,
        )
      : false;
    if (!recorded) {
      const paths = [...replaced, ...artifacts.map((artifact) => artifact.image)];
      if (paths.length > 0) await forgetRecordedArtifacts(projectDir, paths).catch(() => undefined);
    }
  }

  return {
    paths: savedPaths,
    cleared: replaced,
    warnings,
    pairSheetsSkipped: pairSheetFailure !== null,
    ...(review && reviewList
      ? {
          review: {
            plan: review,
            frames: reviewList.flatMap((frame) => {
              const path = reviewPaths.get(frame);
              return path ? [{ ...frame, path }] : [];
            }),
          },
        }
      : {}),
  };
}

interface CapturedSnapshots {
  /** Project-relative where possible, as printed. */
  paths: string[];
  /** Stills of an earlier run this one removed from the folder before capturing. */
  cleared: string[];
  /** Why a frame may differ from the composition: shown on the console and in `--json`. */
  warnings: string[];
  /** --against wrote no pair sheets because sharp could not load. */
  pairSheetsSkipped: boolean;
  review?: { plan: ReviewPlan; frames: Array<ReviewFrame & { path: string }> };
}

function warnUnsettledImages(images: UnsettledImages, time: number, warnings: string[]): void {
  const groups = [
    [images.pending, `did not finish loading within ${SCREENSHOT_IMAGE_WAIT_MS} ms`],
    [images.failed, "failed to load"],
  ] as const;
  for (const [sources, what] of groups) {
    if (sources.length === 0) continue;
    const message = `${sources.length} image(s) ${what} at ${time}s, so the frame may be missing them: ${sources.join(", ")}`;
    warnings.push(message);
    console.warn(`   ${c.warn("⚠")} ${message}`);
  }
}

function warnSnapshotsNotRecorded(error: unknown): undefined {
  console.warn(`   ${c.warn("⚠")} Snapshots were not recorded: ${normalizeErrorMessage(error)}`);
  return undefined;
}

async function recordSnapshotArtifacts(
  projectDir: string,
  capture: ArtifactCapture,
  artifacts: Array<{ id: string; image: string; time: number; metadata: Record<string, unknown> }>,
  zoom: ZoomTarget | undefined,
  warnings: string[],
  completed: boolean,
  log: (message: string) => void,
): Promise<boolean> {
  const records = await recordArtifacts(
    projectDir,
    capture,
    artifacts.map((artifact) => ({
      kind: "snapshot",
      scope: zoom ? "crop" : "full",
      ...artifact,
      metadata: { ...artifact.metadata, warnings, partial: !completed || warnings.length > 0 },
    })),
  ).catch(warnSnapshotsNotRecorded);
  const record = records?.[0];
  if (!record) return false;
  log(`   Revision: ${record.revision ?? "none"} (${record.attribution})`);
  log(`   State: ${join(projectDir, ".hyperframes", "video-state.json")}`);
  return true;
}

/** `snapshot --json`: every still with its time, the sheets, and under --review the plan behind them. */
function snapshotEnvelope(
  projectDir: string,
  outputDir: string,
  captured: CapturedSnapshots,
  extra: { contactSheets: string[]; reviewSheets?: ReviewSheets; describedPath?: string },
) {
  const review = captured.review;
  const frames = review
    ? review.frames.map((frame) => ({
        path: frame.path,
        time: frame.time,
        role: frame.role,
        label: frame.label,
      }))
    : captured.paths.map((path) => ({ path: resolve(projectDir, path), time: timeFromName(path) }));
  return {
    ok: true,
    outputDir,
    frames,
    ...(captured.cleared.length > 0
      ? {
          cleared: {
            count: captured.cleared.length,
            note: clearedNote(captured.cleared.length, outputDir),
          },
        }
      : {}),
    contactSheets: extra.contactSheets.map((sheet) => resolve(sheet)),
    ...(captured.warnings.length > 0 ? { warnings: captured.warnings } : {}),
    ...(extra.describedPath ? { descriptions: extra.describedPath } : {}),
    ...(review
      ? {
          review: {
            window: review.plan.window,
            scenes: review.plan.scenes,
            beats: review.plan.beats.map((beat, index) => ({
              ...beat,
              path: review.frames.find(
                (frame) => frame.role === "beat" && frame.index === index + 1,
              )?.path,
            })),
            seams: review.plan.seams.map((seam, index) => ({
              ...seam,
              paths: review.frames
                .filter((frame) => frame.role === "seam" && frame.index === index + 1)
                .map((frame) => frame.path),
              sheet: extra.reviewSheets?.seams[index],
            })),
            sheets: extra.reviewSheets ?? { beats: [], seams: [], phone: [] },
            notes: review.plan.notes,
          },
        }
      : {}),
  };
}

function timeFromName(path: string): number | null {
  const match = /at-([\d.]+)s\.png$/.exec(path);
  return match ? Number(match[1]) : null;
}

function printReview(
  review: NonNullable<CapturedSnapshots["review"]>,
  sheets: ReviewSheets,
  log: (message: string) => void,
): void {
  const beats = review.plan.beats.map(
    (beat) => `${formatSnapshotTimestamp(beat.time)} ${beat.label}`,
  );
  log(`   Beat sheet (settled frame per scene): ${sheets.beats.join(", ") || "none"}`);
  log(`     ${c.dim(beats.join(" · "))}`);
  review.plan.seams.forEach((seam, index) => {
    const sides = `${seam.from ?? "start"} -> ${seam.to ?? "end"}`;
    const strip = sheets.seams[index] ?? "not written";
    log(`   Seam ${index + 1} at ${formatSnapshotTimestamp(seam.time)} (${sides}): ${strip}`);
  });
  log(
    `   Phone sheet (beats at ${REVIEW_PHONE_WIDTH} px wide): ${sheets.phone.join(", ") || "none"}`,
  );
  for (const note of review.plan.notes) log(`   ${c.dim(note)}`);
}

export default defineCommand({
  meta: {
    name: "snapshot",
    description: "Capture key frames from a composition as PNG screenshots for visual verification",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    output: {
      type: "string",
      alias: "o",
      description:
        "Directory to write snapshots into (default: unique directory under <project>/.hyperframes/artifacts/snapshots)",
    },
    frames: {
      type: "string",
      description: "Number of evenly-spaced frames to capture (default: 5)",
      default: "5",
    },
    at: {
      type: "string",
      description:
        "Comma-separated timestamps in seconds (e.g., --at 3.0,10.5,18.0). Each is captured at that exact instant, not snapped to a frame.",
    },
    range: {
      type: "string",
      description:
        "Root-timeline range START,END in seconds; sample --frames evenly within it, without adding the full-video tail",
    },
    composition: {
      type: "string",
      description:
        "data-composition-id to sample; take --frames within its effective root-timeline interval, without adding the full-video tail",
    },
    timeout: {
      type: "string",
      description: `Ms to wait for the composition to become render-ready (default: ${RENDER_READY_TIMEOUT_MS})`,
      default: String(RENDER_READY_TIMEOUT_MS),
    },
    angle: {
      type: "string",
      description:
        "Orthogonal 3D camera for depth/occlusion checks: a preset (front|iso|top|side) or 'yaw,pitch' degrees. Tilts the whole stage before screenshotting (real pixels, not bbox markers).",
    },
    end: {
      type: "boolean",
      description:
        "Always include a readable end-of-timeline frame (default: true). Pass --no-end to capture only your exact --at times.",
      default: true,
    },
    keep: {
      type: "boolean",
      description:
        "Add to --output instead of clearing it, naming each still at-<seconds>s.png (at-0s, at-1.5s, at-12.25s: no trailing zeros), so snapshotting one moment again replaces only that still. Times less than 1 ms apart share a name, so one run may not pass two of them. No contact sheet.",
      default: false,
    },
    zoom: {
      type: "string",
      description:
        "Zoom into a CSS selector or an exact pixel region 'x,y,w,h'. Crops a high-density screenshot instead of the full frame — a raised deviceScaleFactor, never CSS zoom or viewport resizing, so layout stays identical. A selector matching nothing is an error, not a silent full-frame shot.",
    },
    "zoom-scale": {
      type: "string",
      description: "Device-scale-factor density for --zoom crops (default: 3)",
      default: "3",
    },
    against: {
      type: "string",
      description:
        "Reference video (e.g. footage being rebuilt): also save its frame at each captured time and a render|reference pair sheet",
    },
    review: {
      type: "boolean",
      description:
        "Capture the review set instead of evenly spaced frames: each scene at its start + 0.3 s and its middle, and each data-beat at its start + 0.3 s, on review-beats.jpg, a 5-frame strip around every cut (review-seam-NN.jpg), and the beat frames at phone width (review-phone.jpg). Scopes to --composition; ignores --frames.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print one JSON envelope (paths, times, sheets; the review plan under --review)",
      default: false,
    },
    describe: {
      type: "string",
      description:
        "Send each frame to Gemini for a vision description (off by default; needs GEMINI_API_KEY or GOOGLE_API_KEY). A bare --describe uses the default prompt; --describe 'Is the logo visible in every beat?' asks your own question.",
    },
    proxy: {
      type: "boolean",
      description:
        "Serve browser-playable copies of hostile video codecs to the snapshot page (default: off; frames come from FFmpeg, and each copy transcodes the whole clip)",
      default: undefined,
    },
    "browser-gpu": {
      type: "boolean",
      description:
        "Use hardware browser GPU capture; pass --no-browser-gpu for deterministic SwiftShader (default: auto-detect, PRODUCER_BROWSER_GPU_MODE overrides)",
      default: undefined,
    },
  },
  async run({ args }) {
    const asJson = args.json === true;
    const log = (message: string) => (asJson ? console.error(message) : console.log(message));
    const fail = (message: string): never => {
      if (asJson)
        console.log(JSON.stringify(withMeta(jsonFailure("runtime_error", message)), null, 2));
      else log(message);
      failCommand();
    };
    if ([args.at, args.range, args.composition].filter((value) => value !== undefined).length > 1)
      throw new CliUsageError("Use only one of --at, --range, or --composition");
    const reviewMode = args.review === true;
    if (reviewMode) {
      const clash = (["at", "range", "zoom", "keep", "against"] as const).find(
        (flag) => args[flag] !== undefined && args[flag] !== false,
      );
      if (clash) throw new CliUsageError(`--review picks its own frames; drop --${clash}`);
    }
    const frames = args.frames === undefined ? 5 : parseSnapshotFrames(String(args.frames));
    const range = args.range === undefined ? undefined : parseSnapshotRange(String(args.range));
    const atTimestamps = args.at === undefined ? undefined : parseSnapshotAt(String(args.at));
    if (args.keep === true && atTimestamps) assertDistinctKeepNames(atTimestamps);
    const composition =
      args.composition === undefined ? undefined : String(args.composition).trim();
    if (composition === "") throw new CliUsageError("--composition requires a composition ID");
    const project = resolveProject(args.dir);
    const lintResult = await lintProject(project.dir);
    if (hasDefinitiveEntryMismatch(lintResult)) {
      const candidate = definitiveEntryMismatchComposition(lintResult);
      log("");
      for (const line of formatLintFindings(lintResult, { errorsFirst: true })) {
        log(line);
      }
      log("");
      log(c.error("  Aborting snapshot because the default index.html entry is blank."));
      if (candidate && posix.basename(candidate) === "index.html") {
        const candidateDir = posix.dirname(candidate);
        const target = `<project>/${candidateDir}`;
        log(
          c.dim(
            `  Move or mount the authored file, or snapshot its directory directly: hyperframes snapshot ${target}. Only use the directory form when its assets are self-contained under that directory; otherwise mount it from the project root.`,
          ),
        );
      } else if (candidate) {
        log(
          c.dim(
            `  Move or mount ${candidate} as a project index.html before snapshotting; snapshot accepts project directories, not individual HTML files.`,
          ),
        );
      }
      log("");
      if (asJson) {
        const error = "The default index.html entry is blank; see the lint findings on stderr.";
        console.log(JSON.stringify(withMeta({ ok: false, error }), null, 2));
      }
      failCommand();
    }
    const timeout = parseTimeoutMs(args.timeout, RENDER_READY_TIMEOUT_MS);
    const describePrompt = resolveDescribePrompt(args.describe);

    const camera = args.angle ? parseAngle(String(args.angle)) : undefined;
    const zoomTarget = args.zoom ? parseZoomTarget(String(args.zoom)) : undefined;
    const zoomScale = parseZoomScale(args["zoom-scale"]);
    const against = args.against ? resolve(String(args.against)) : undefined;
    if (against && !existsSync(against))
      fail(`${c.error("✗")} --against video not found: ${against}`);

    const label = reviewMode
      ? "review frames (beats, seams, phone)"
      : atTimestamps
        ? `${atTimestamps.length} frames at [${atTimestamps.map(formatSnapshotTimestamp).join(", ")}]`
        : `${frames} frames`;
    const angleLabel =
      camera && (camera.yaw !== 0 || camera.pitch !== 0)
        ? ` ${c.dim(`(angle yaw ${camera.yaw}° pitch ${camera.pitch}°)`)}`
        : "";
    log(`${c.accent("◆")}  Capturing ${label} from ${c.accent(project.name)}${angleLabel}`);

    let managedSnapshotDir: string | undefined;
    try {
      const snapshotDir = args.output
        ? resolve(String(args.output))
        : artifactDirectory(project.dir, "snapshots");
      if (!args.output) managedSnapshotDir = snapshotDir;
      if (args.output) retainSnapshotOutput(project.dir, snapshotDir);
      await withProjectLock(project.dir, "snapshot", async () => {
        const captured = await captureSnapshots(project.dir, {
          frames,
          range,
          composition,
          timeout,
          at: atTimestamps,
          outputDir: snapshotDir,
          angle: camera,
          includeEnd: args.end !== false,
          zoom: zoomTarget,
          zoomScale,
          autoProxy: args.proxy as boolean | undefined,
          browserGpuMode: resolveLocalBrowserGpuMode(args["browser-gpu"] as boolean | undefined),
          against,
          keep: args.keep === true,
          review: reviewMode,
          log,
        });
        const onDisk = snapshotsOnDisk(project.dir, captured.paths);
        const paths = onDisk.written;
        const framePaths = paths;
        reportArtifacts("snapshot", "frame", framePaths);

        if (captured.paths.length === 0) {
          fail(`\n${c.error("✗")} Could not determine composition duration — no frames captured`);
        }

        const short = onDisk.missing.length > 0;
        const mark = short ? c.error("✗") : c.success("◇");
        const count = short ? `${paths.length} of ${captured.paths.length}` : String(paths.length);
        log(`\n${mark}  ${count} snapshots saved to ${snapshotDir}`);
        for (const p of paths) {
          log(`   ${p}`);
        }
        if (short) {
          const gone = onDisk.missing.map((path) => `\n   missing: ${path}`).join("");
          fail(
            `${c.error("✗")} Only ${paths.length} of ${captured.paths.length} snapshots are on disk in ${snapshotDir}.${gone}`,
          );
        }
        if (against) {
          log(
            captured.pairSheetsSkipped
              ? `   ${c.dim("ref-*.png")} beside each frame (reference frame)`
              : `   ${c.dim("ref-*.png + pair-*.jpg")} beside each frame (reference frame, render | reference sheet)`,
          );
        }

        // Generate contact sheet for quick AI review; a --keep folder mixes runs, so it gets none.
        let contactSheets: string[] = [];
        let reviewSheets: ReviewSheets | undefined;
        try {
          const { createSnapshotContactSheet } = await import("../capture/contactSheet.js");
          if (captured.review) {
            const written = new Map(
              captured.review.frames.map((frame) => [frame.file, frame.path]),
            );
            reviewSheets = await writeReviewSheets(
              snapshotDir,
              captured.review.frames,
              (frame) => written.get(frame.file) ?? null,
            );
            contactSheets = [...reviewSheets.beats, ...reviewSheets.seams, ...reviewSheets.phone];
            printReview(captured.review, reviewSheets, log);
          } else if (args.keep !== true) {
            contactSheets = await createSnapshotContactSheet(
              framePaths,
              join(snapshotDir, "contact-sheet.jpg"),
            );
          }
          reportArtifacts("snapshot", "contact-sheet", contactSheets);
          if (!captured.review) {
            for (const sheet of contactSheets) {
              log(`   ${resolve(sheet)} (grid view for AI review)`);
            }
          }
        } catch (err) {
          console.warn(
            `   ${c.warn("⚠")} Contact sheet skipped: ${describeSharpLoadFailure(err) ?? normalizeErrorMessage(err)}. Individual snapshot PNGs are still available.`,
          );
        }

        let describedPath: string | undefined;
        // Gemini vision descriptions upload the frames, so they run only when
        // --describe was passed. A missing key logs a skip and continues.
        if (describePrompt !== null) {
          try {
            const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            if (!geminiKey) {
              log(`   ${c.dim("--describe: GEMINI_API_KEY or GOOGLE_API_KEY not set, skipping")}`);
            } else if (paths.length > 0) {
              log(`   ${c.dim("Describing frames with Gemini vision...")}`);
              const { GoogleGenAI } = await loadOptionalPackage("@google/genai", "--describe");
              const ai = new GoogleGenAI({ apiKey: geminiKey });
              const model = process.env.HYPERFRAMES_GEMINI_MODEL || "gemini-3.1-flash-lite-preview";

              const descriptions: string[] = [
                `# Snapshot Frame Descriptions`,
                ``,
                `**Question asked:** ${describePrompt}`,
                ``,
                `Compare each description against your storyboard spec. A "black frame" or "loading screen" for a content beat is a bug.`,
                ``,
              ];

              // Scale down PNGs before sending to stay under Gemini's 4 MB inline
              // limit. Full 1920×1080 PNGs are typically 3-6 MB. Use sharp if it is
              // already there (never installed for this); otherwise skip files over the limit.
              let sharp: ReturnType<typeof loadInstalledSharp> = null;
              let sharpFailure: string | null = null;
              try {
                sharp = loadInstalledSharp("--describe");
              } catch (err) {
                sharpFailure = describeSharpLoadFailure(err);
              }

              const results = await Promise.allSettled(
                paths.map(async (p) => {
                  const filename = basename(p);
                  const filePath = join(snapshotDir, filename);
                  if (!existsSync(filePath)) return { filename, desc: "file not found" };
                  const raw = readFileSync(filePath);
                  let imageData: Buffer;
                  let mimeType = "image/png";
                  if (sharp) {
                    imageData = await sharp(raw).resize(960).jpeg().toBuffer();
                    mimeType = "image/jpeg";
                  } else {
                    if (raw.length > 3_800_000)
                      return {
                        filename,
                        desc: sharpFailure
                          ? "file too large for Gemini — sharp failed to load, so it was not resized"
                          : "file too large for Gemini — install sharp to enable auto-resize",
                      };
                    imageData = raw;
                  }
                  const base64 = imageData.toString("base64");
                  const response = await ai.models.generateContent({
                    model,
                    contents: [
                      {
                        role: "user",
                        parts: [
                          { inlineData: { mimeType, data: base64 } },
                          { text: describePrompt },
                        ],
                      },
                    ],
                    config: { maxOutputTokens: 250 },
                  });
                  return { filename, desc: response.text?.trim() || "no description" };
                }),
              );

              for (const result of results) {
                if (result.status === "fulfilled") {
                  descriptions.push(`## ${result.value.filename}`, `${result.value.desc}`, ``);
                } else {
                  // Log first failure so Gemini issues are visible rather than silent
                  const errMsg = normalizeErrorMessage(result.reason);
                  descriptions.push(
                    `## (error)`,
                    `Gemini call failed: ${errMsg.slice(0, 120)}`,
                    ``,
                  );
                }
              }

              const descPath = join(snapshotDir, "descriptions.md");
              writeFileSync(descPath, descriptions.join("\n"));
              describedPath = descPath;
              log(`   ${c.dim("descriptions.md")} (Gemini frame analysis)`);
            }
          } catch (descErr) {
            const msg = normalizeErrorMessage(descErr);
            log(`   ${c.dim(`--describe failed: ${msg}`)}`);
          }
        }
        if (asJson) {
          const envelope = snapshotEnvelope(project.dir, snapshotDir, captured, {
            contactSheets,
            reviewSheets,
            describedPath,
          });
          console.log(JSON.stringify(withMeta(envelope), null, 2));
        }
      });
    } catch (err) {
      // Already reported where it happened (fail() above).
      if (err instanceof CliRuntimeError && err.result.presented) throw err;
      const msg = failureMessage(err);
      if (asJson) console.log(JSON.stringify(withMeta(jsonFailure("runtime_error", msg)), null, 2));
      else console.error(`\n${c.error("✗")} Snapshot failed: ${msg}`);
      failCommand();
    } finally {
      if (managedSnapshotDir)
        await finishSnapshotRun(project.dir, managedSnapshotDir).catch(warnSnapshotsNotRecorded);
    }
  },
});
