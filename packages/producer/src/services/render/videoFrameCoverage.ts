/**
 * Per-clip render-time frame-coverage accounting + threshold fail-loud gate.
 *
 * Sibling to #2474's `hasRuntimeInsertedMedia` probe: that PR guarantees the
 * DISCOVERY of runtime-inserted media (so the browser probe launches and
 * reconciles element identity). This module owns the DELIVERY side —
 * for each authored/discovered video clip on the timeline, did the
 * extractor actually produce enough source-video frames to composite the
 * clip's authored `[data-start,data-end]` window? Any clip whose
 * `capturedFrames / expectedFrames` ratio falls below a configurable
 * threshold aborts the render with a `VideoFrameCoverageError` at extract
 * finalization, BEFORE encode produces an MP4 that silently drops the
 * clip's pixels to black.
 *
 * Two field signals defined the failure surface this exists to close
 * (both `#hyperframes-cli-feedback`, both `check`/`snapshot` pass /
 * final MP4 wrong):
 *
 *   • ts=1784139267 · win32/x64 CLI 0.7.58 156s render, 15 injected
 *     videos: several later-injected video clips render BLANK in the
 *     encoded MP4. Injection-count-scaled — 12 injections fail, 4
 *     succeed (workaround: pre-compose into one base timeline). Points
 *     at injector scheduling / worker-seek saturation / extractor
 *     concurrency. Directly covered here — the per-video capture
 *     shortfall lands with `capturedFrames << expectedFrames`.
 *
 *   • ts=1784144554 · darwin/arm64 CLI 0.7.59 3/10 147-clip
 *     composition (130 word-level caption divs): producer left a
 *     subset of authored `[data-start]` div clips permanently visible
 *     in the rendered MP4 while preview/snapshot showed correct
 *     visibility. Authored-clip-count-scaled — 147 clips fails, 3
 *     succeeds. This case runs through `syncTimedElementVisibility`
 *     at runtime and is NOT source-video-frame-shaped; the coverage
 *     gate cannot directly observe it. We surface an
 *     `authoredTimedClipCount` gauge so a 147-clip composition is
 *     visible in telemetry, and leave the per-tick visibility parity
 *     check as follow-up work (a separate runtime observability
 *     channel is required — the extractor doesn't see div visibility).
 *
 * Threshold: default 0.95 (a 5% capture-frame drop is loud); override
 * via `HF_VIDEO_COVERAGE_THRESHOLD` env; disable entirely by setting
 * the env to `0` or a negative number. A threshold of `1` requires
 * exact coverage (no slack for the ffmpeg ±1-frame boundary rounding
 * that legitimately happens on a 29.97 fps timeline).
 */

import { parseHTML } from "linkedom";
import type { ExtractedFrames, VideoElement } from "@hyperframes/engine";

export interface VideoFrameCoverageReport {
  videoId: string;
  clipStart: number;
  clipEnd: number;
  expectedFrames: number;
  capturedFrames: number;
  /** `capturedFrames / expectedFrames`; `1` when `expectedFrames === 0` (nothing to cover). */
  ratio: number;
}

/**
 * Discriminant-based error so callers cross-module (producer server,
 * distributed worker) can identify a coverage-gate failure without
 * `instanceof` (which is fragile across duplicated module instances,
 * see `DrawElementVerificationError` for the same problem).
 */
export interface VideoFrameCoverageErrorDetails {
  readonly hyperframesVideoFrameCoverageError: true;
  readonly threshold: number;
  readonly worst: VideoFrameCoverageReport;
  readonly failedReports: VideoFrameCoverageReport[];
}

export class VideoFrameCoverageError extends Error {
  readonly hyperframesVideoFrameCoverageError = true as const;
  readonly threshold: number;
  readonly worst: VideoFrameCoverageReport;
  readonly failedReports: VideoFrameCoverageReport[];

  constructor(
    message: string,
    details: Omit<VideoFrameCoverageErrorDetails, "hyperframesVideoFrameCoverageError">,
  ) {
    super(message);
    this.name = "VideoFrameCoverageError";
    this.threshold = details.threshold;
    this.worst = details.worst;
    this.failedReports = details.failedReports;
  }
}

export function isVideoFrameCoverageError(err: unknown): err is VideoFrameCoverageError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { hyperframesVideoFrameCoverageError?: unknown }).hyperframesVideoFrameCoverageError ===
      true
  );
}

/**
 * Resolve the coverage threshold from `HF_VIDEO_COVERAGE_THRESHOLD` env.
 *
 * Defaults to `0.95`. Values outside `(0, 1]` disable the gate: `0` or
 * negative → off (return `null`); `>1` clamps to `1`. Non-numeric env
 * values fall back to the default (with a caller-side warning if a log
 * is available).
 */
export function resolveVideoCoverageThreshold(
  envValue: string | undefined = process.env.HF_VIDEO_COVERAGE_THRESHOLD,
): number | null {
  if (envValue === undefined) return 0.95;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) return 0.95;
  if (parsed <= 0) return null;
  if (parsed > 1) return 1;
  return parsed;
}

/**
 * Ceil the clip's authored `[start,end)` window at `fps` — the number of
 * captured render frames whose center-time falls inside the window. Kept
 * separate so a caller (or a test) can override it if a composition uses
 * a non-integer fps whose sampling makes the naive count off by one.
 */
export function expectedFramesForClip(start: number, end: number, fps: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(fps)) return 0;
  if (fps <= 0) return 0;
  const duration = Math.max(0, end - start);
  return Math.ceil(duration * fps);
}

export function computeVideoFrameCoverage(
  videos: readonly VideoElement[],
  extracted: readonly ExtractedFrames[],
  fps: number,
): VideoFrameCoverageReport[] {
  const byId = new Map<string, ExtractedFrames>();
  for (const entry of extracted) byId.set(entry.videoId, entry);

  const reports: VideoFrameCoverageReport[] = [];
  for (const video of videos) {
    const entry = byId.get(video.id);
    const slotFrames = expectedFramesForClip(video.start, video.end, fps);
    // A short source in a longer slot has a legitimate delivery ceiling of
    // the source portion, not the full slot: a non-looping clip holds its
    // final decoded frame across the tail (#2516/#2606), and a looping clip
    // reuses its full source frame set per repeat (#2665). In both cases the
    // full source *has* been delivered — the same 90 unique source frames
    // cover the 300-frame slot — so coverage must measure source-source, not
    // slot-source. A missing extraction (no `entry`) still requires the full
    // slot; there's no delivered set to credit.
    const sourceDuration = entry ? entry.metadata.durationSeconds - video.mediaStart : NaN;
    const hasUsableSourceDuration = Number.isFinite(sourceDuration) && sourceDuration > 0;
    const sourceFrames =
      entry && hasUsableSourceDuration ? expectedFramesForClip(0, sourceDuration, fps) : slotFrames;
    const expectedFrames = entry ? Math.min(slotFrames, sourceFrames) : slotFrames;
    // framePaths is a Map — `size` is the number of distinct captured frames
    // delivered to the runtime injector, which is the load-bearing count
    // (some extractors report a total that includes cache-hit-skipped frames
    // via a stale `totalFrames`, so we trust the delivered-path count).
    const capturedFrames = entry ? entry.framePaths.size : 0;
    const ratio = expectedFrames === 0 ? 1 : capturedFrames / expectedFrames;
    reports.push({
      videoId: video.id,
      clipStart: video.start,
      clipEnd: video.end,
      expectedFrames,
      capturedFrames,
      ratio,
    });
  }
  return reports;
}

/**
 * Throws `VideoFrameCoverageError` when any per-clip ratio is below
 * `threshold`. A `null` threshold disables the gate (env opt-out).
 * A clip with `expectedFrames === 0` (0-duration or non-authored) is
 * unconditionally passing so the gate never fires on a degenerate window.
 */
export function assertVideoFrameCoverage(
  reports: readonly VideoFrameCoverageReport[],
  threshold: number | null,
): void {
  if (threshold === null) return;
  const failed = reports.filter((report) => report.expectedFrames > 0 && report.ratio < threshold);
  if (failed.length === 0) return;
  // Sort ascending by ratio so the "worst" is first — that's what we cite
  // in the message and pin on the error details for telemetry.
  const sorted = [...failed].sort((a, b) => a.ratio - b.ratio);
  const worst = sorted[0]!;
  const pct = (worst.ratio * 100).toFixed(1);
  const thresholdPct = (threshold * 100).toFixed(1);
  const suffix = sorted.length > 1 ? ` (+${sorted.length - 1} more clip(s) below threshold)` : "";
  throw new VideoFrameCoverageError(
    `Video "${worst.videoId}" captured ${worst.capturedFrames} of expected ${worst.expectedFrames} frames ` +
      `(coverage ${pct}%, threshold ${thresholdPct}%). ` +
      `check/snapshot may pass while the encoded MP4 renders this clip blank — aborting render ` +
      `to prevent shipping a wrong MP4.${suffix} ` +
      `Set HF_VIDEO_COVERAGE_THRESHOLD=0 to disable this gate.`,
    { threshold, worst, failedReports: sorted },
  );
}

/**
 * Count authored `[data-start]` clip windows in the compiled HTML.
 *
 * Not a fail-loud gate — a raw counter that lands in
 * `RenderExtractionObservability.authoredTimedClipCount` so a 147-clip
 * composition is queryable in telemetry (the ts=1784144554 field signal
 * shape). Runtime `syncTimedElementVisibility` iterates the same set at
 * render time; counting statically here is a coarse proxy — dynamic
 * script-inserted `[data-start]` divs land in `hasRuntimeInsertedMedia`'s
 * probe path (PR #2474), not this static scan.
 */
export function countAuthoredTimedClips(html: string): number {
  const { document } = parseHTML(html);
  return document.querySelectorAll("[data-start]").length;
}
