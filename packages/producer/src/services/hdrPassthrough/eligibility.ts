/**
 * HDR passthrough eligibility.
 *
 * Decides whether a render that is about to take the HDR layered composite
 * path can instead take the passthrough. Pure gates run first; the page is
 * only opened (via `session.get()`) once every metadata gate has passed.
 * Every gate fails closed: when in doubt the composition is ineligible and the
 * layered path renders it unchanged.
 */

import { existsSync } from "node:fs";
import {
  detectTransfer,
  extractMediaMetadata,
  isHdrColorSpace,
  isHttpUrl,
  qualifyVideoLayer,
  resolvePlayableVideoDuration,
  resolveProjectRelativeSrc,
  type VideoMetadata,
} from "@hyperframes/engine";
import { probeVideoLayout } from "../render/videoLayerPassthroughPlan.js";
import { analyzeOverlayTiming } from "./planner.js";
import type {
  CheckPassthroughEligibilityArgs,
  HdrPassthroughInput,
  PassthroughEligibility,
  PassthroughIneligibleReason,
} from "./types.js";

/** Default ceiling on distinct overlay states before declaring `too_many_states`. */
export const DEFAULT_MAX_OVERLAY_STATES = 4096;

/** Seconds of slack for source-coverage and clip-window comparisons (probe float noise). */
const TIME_EPSILON_SECONDS = 1e-3;
/** Relative slack for "same aspect ratio" (sub-pixel rounding of odd sizes). */
const ASPECT_EPSILON = 1e-3;

type Ineligible = Extract<PassthroughEligibility, { eligible: false }>;

function ineligible(reason: PassthroughIneligibleReason, detail?: string): Ineligible {
  return detail === undefined ? { eligible: false, reason } : { eligible: false, reason, detail };
}

/** `qualifyVideoLayer` reasons, which are all `PassthroughIneligibleReason`s. */
const VIDEO_LAYER_REASONS: ReadonlySet<string> = new Set<PassthroughIneligibleReason>([
  "video_count",
  "hidden",
  "color_grading",
  "loop",
  "playback_rate",
  "late_start",
  "ends_early",
]);

/** `inspectVideoLayout` reasons, which are all `PassthroughIneligibleReason`s. */
const LAYOUT_REASONS: ReadonlySet<string> = new Set<PassthroughIneligibleReason>([
  "video_missing",
  "not_full_canvas",
  "opacity",
  "transform_or_filter",
  "clip_or_mask",
  "blend_mode",
  "not_shown",
  "ancestor_background",
  "subcomposition_background",
  "object_fit",
  "paints_under",
]);

function asReason(
  reason: string,
  known: ReadonlySet<string>,
  fallback: PassthroughIneligibleReason,
): PassthroughIneligibleReason {
  return known.has(reason) ? (reason as PassthroughIneligibleReason) : fallback;
}

/** Render-level gates; nothing here touches the page or the filesystem. */
export function checkRenderGates(input: HdrPassthroughInput): Ineligible | null {
  const { job, composition } = input;
  const format = job.config.format ?? "mp4";
  if (!input.hasHdrContent || !input.effectiveHdr || !input.preset.hdr) {
    return ineligible("not_hdr");
  }
  if (input.preset.hdr.transfer !== input.effectiveHdr.transfer) {
    return ineligible("not_hdr", "encoder transfer differs from the composition's");
  }
  if (format !== "mp4") return ineligible("output_format", format);
  if (input.preset.pixelFormat.startsWith("yuva")) {
    return ineligible("alpha_output", input.preset.pixelFormat);
  }
  const scale = input.buildCaptureOptions().deviceScaleFactor ?? 1;
  if (scale !== 1 || input.width !== composition.width || input.height !== composition.height) {
    return ineligible(
      "output_scale",
      `${composition.width}x${composition.height} -> ${input.width}x${input.height} @${scale}x`,
    );
  }
  if (job.config.motionBlur) return ineligible("motion_blur");
  if (composition.gradedCanvas) return ineligible("graded_canvas");
  if (composition.masterFxChain) return ineligible("master_fx_chain");
  if (input.nativeHdrImageIds.size > 0) {
    return ineligible("hdr_images", `${input.nativeHdrImageIds.size} HDR image(s)`);
  }
  return null;
}

/** Colour and stream-format gates: native HDR in the render's transfer, bt2020, CFR, opaque. */
function checkSourceSignal(metadata: VideoMetadata, transfer: "hlg" | "pq"): Ineligible | null {
  const cs = metadata.colorSpace ?? {
    colorTransfer: "unknown",
    colorPrimaries: "unknown",
    colorSpace: "unknown",
  };
  if (!isHdrColorSpace(metadata.colorSpace) || detectTransfer(cs) !== transfer) {
    return ineligible("video_not_native_hdr", `source transfer ${cs.colorTransfer}`);
  }
  if (cs.colorPrimaries !== "bt2020") {
    return ineligible("source_unsupported", `primaries ${cs.colorPrimaries}`);
  }
  const format = [metadata.isVFR && "variable frame rate", metadata.hasAlpha && "alpha channel"];
  const problem = format.find((entry): entry is string => typeof entry === "string");
  return problem ? ineligible("source_unsupported", problem) : null;
}

/** Geometry gates: unrotated, square pixels, same aspect as the canvas (fill and cover are a plain scale). */
function checkSourceGeometry(
  metadata: VideoMetadata,
  canvas: { width: number; height: number },
): Ineligible | null {
  const { rotation, sampleAspectRatio, width, height } = metadata;
  if (rotation !== undefined && rotation % 360 !== 0) {
    return ineligible("source_unsupported", `rotation ${rotation}`);
  }
  if (sampleAspectRatio !== undefined && Math.abs(sampleAspectRatio - 1) > ASPECT_EPSILON) {
    return ineligible("source_unsupported", `sample aspect ${sampleAspectRatio}`);
  }
  if (!(width > 0) || !(height > 0)) return ineligible("source_unsupported", "unknown dimensions");
  if (Math.abs(width / height / (canvas.width / canvas.height) - 1) > ASPECT_EPSILON) {
    const detail = `source ${width}x${height} vs canvas ${canvas.width}x${canvas.height}`;
    return ineligible("object_fit", detail);
  }
  return null;
}

/** Source-file gates on the probed metadata of the one video. */
export function checkSourceMetadata(args: {
  metadata: VideoMetadata;
  transfer: "hlg" | "pq";
  mediaStart: number;
  duration: number;
  canvas: { width: number; height: number };
}): Ineligible | null {
  const { metadata, mediaStart, duration } = args;
  const gate =
    checkSourceSignal(metadata, args.transfer) ?? checkSourceGeometry(metadata, args.canvas);
  if (gate) return gate;
  if (!(mediaStart >= 0)) return ineligible("source_unsupported", `mediaStart ${mediaStart}`);
  const playable = resolvePlayableVideoDuration(metadata);
  if (!(playable + TIME_EPSILON_SECONDS >= mediaStart + duration)) {
    const detail = `source has ${playable.toFixed(3)}s, needs ${(mediaStart + duration).toFixed(3)}s`;
    return ineligible("source_unsupported", detail);
  }
  return null;
}

/** Result of `inspectVideoAnimation`: `null` when nothing can move or hide the video. */
type VideoAnimationFinding = { reason: PassthroughIneligibleReason; detail: string } | null;

/**
 * Runs in the page; must stay self-contained. Read-only.
 *
 * The video must hold still for the whole composition: no GSAP tween targets
 * it or anything containing it, no GSAP callback (whose side effects could
 * touch it) runs inside a tween with duration, no CSS/WAAPI animation runs on
 * it or an ancestor, and every timed ancestor's clip window spans the whole
 * composition. Zero-duration callbacks (`tl.call`) are left to the planner,
 * which reports them as `timeline_call`.
 */
// fallow-ignore-next-line complexity
function inspectVideoAnimation(videoId: string, duration: number): VideoAnimationFinding {
  type Node = {
    duration?: () => number;
    getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Node[];
    targets?: () => unknown[];
    vars?: Record<string, unknown>;
  };
  const w = window as unknown as {
    __timelines?: Record<string, Node>;
    __hf?: { clipWindow?: (el: Element) => { start: number; end: number } | null };
  };
  const EPS = 1e-3;
  const CALLBACKS = ["onStart", "onUpdate", "onComplete", "onRepeat", "onReverseComplete"];
  const video = document.getElementById(videoId);
  if (!video) return { reason: "video_missing", detail: videoId };
  const label = (el: Element) => (el.id ? `#${el.id}` : el.tagName.toLowerCase());
  const touchesVideo = (target: unknown): target is Element =>
    !!target &&
    typeof target === "object" &&
    (target as { nodeType?: unknown }).nodeType === 1 &&
    (target as Element).contains(video);
  const hasCallback = (node: Node) =>
    CALLBACKS.some((key) => typeof node.vars?.[key] === "function");

  for (const [key, tl] of Object.entries(w.__timelines ?? {})) {
    if (!tl || typeof tl.getChildren !== "function") continue;
    if (hasCallback(tl))
      return { reason: "video_animated", detail: `callback on timeline "${key}"` };
    for (const child of tl.getChildren(true, true, true)) {
      const isTimeline = typeof child.getChildren === "function";
      const childDuration = typeof child.duration === "function" ? child.duration() : 0;
      if (hasCallback(child) && (isTimeline || childDuration > 1e-6)) {
        return { reason: "video_animated", detail: `GSAP callback in timeline "${key}"` };
      }
      if (isTimeline) continue;
      const hit = (typeof child.targets === "function" ? child.targets() : []).find(touchesVideo);
      if (hit) return { reason: "video_animated", detail: `GSAP tween on ${label(hit)}` };
    }
  }

  const resolve = w.__hf?.clipWindow;
  for (let el: Element | null = video; el && el !== document.documentElement; ) {
    const anims = (el as Element & { getAnimations?: () => Animation[] }).getAnimations?.() ?? [];
    if (anims.length > 0) {
      return { reason: "video_animated", detail: `CSS/WAAPI animation on ${label(el)}` };
    }
    if (el !== video && el.hasAttribute("data-start")) {
      const win = typeof resolve === "function" ? resolve(el) : null;
      if (!win) return { reason: "not_shown", detail: `unresolved clip window on ${label(el)}` };
      if (win.start > EPS || win.end < duration - EPS) {
        return {
          reason: "not_shown",
          detail: `${label(el)} is on screen ${win.start}-${win.end}s`,
        };
      }
    }
    el = el.parentElement;
  }
  return null;
}

/** Filesystem and probe access, injectable for tests. */
export interface EligibilityDeps {
  fileExists: (path: string) => boolean;
  probeMetadata: (path: string, signal: AbortSignal | undefined) => Promise<VideoMetadata>;
}

const DEFAULT_DEPS: EligibilityDeps = {
  fileExists: existsSync,
  probeMetadata: (path, signal) => extractMediaMetadata(path, { signal }),
};

/**
 * Contract:
 *
 * Returns `{ eligible: true, video, timing }` only when ALL hold, else the
 * FIRST failing gate's `{ eligible: false, reason, detail? }`. Never throws
 * for an ineligible composition; throws only on unexpected IO / browser
 * failures (the caller falls back on throw too).
 *
 * Render-level gates (no page, from `args.input`): `not_hdr`,
 * `output_format` (mp4 only), `alpha_output`, `output_scale` (device scale 1,
 * output size = composition size), `motion_blur`, `graded_canvas`,
 * `master_fx_chain`, `hdr_images`.
 *
 * Video gates (no page): engine `qualifyVideoLayer` (count / hidden / grading /
 * loop / rate / start / end); the video is native HDR with the render's
 * transfer; local file that exists; probed metadata is bt2020, constant frame
 * rate, opaque, unrotated, square pixels, same aspect as the canvas (so `fill`
 * and `cover` are both a plain scale) and covers `mediaStart + duration`.
 *
 * Page gates (`await session.get()`): `shader_transitions`; layout at sampled
 * times via `probeVideoLayout` (the SDR video-layer probe, same reasons);
 * `video_animated` / `not_shown` via `inspectVideoAnimation`; then overlay
 * timing via `planner.analyzeOverlayTiming` with
 * `maxStates = DEFAULT_MAX_OVERLAY_STATES`, whose failure reason is returned
 * as-is.
 *
 * Leaves the page seeked to time 0 and with no DOM mask applied.
 */
export async function checkPassthroughEligibility(
  args: CheckPassthroughEligibilityArgs,
  deps: EligibilityDeps = DEFAULT_DEPS,
): Promise<PassthroughEligibility> {
  const { input, session } = args;
  const { job, composition, width, height } = input;

  const renderGate = checkRenderGates(input);
  if (renderGate) return renderGate;
  const transfer = input.effectiveHdr?.transfer;
  if (!transfer) return ineligible("not_hdr");

  const qualified = qualifyVideoLayer(composition.videos, composition.duration);
  if (!qualified.qualifies) {
    return ineligible(asReason(qualified.reason, VIDEO_LAYER_REASONS, "video_count"));
  }
  const element = qualified.video;
  if (!input.nativeHdrVideoIds.has(element.id)) return ineligible("video_not_native_hdr");
  const videoTransfer = input.videoTransfers.get(element.id);
  if (videoTransfer !== transfer) {
    return ineligible("video_not_native_hdr", `transfer ${videoTransfer ?? "unknown"}`);
  }
  if (isHttpUrl(element.src)) return ineligible("remote_source");
  const srcPath = resolveProjectRelativeSrc(element.src, input.projectDir, input.compiledDir);
  if (!deps.fileExists(srcPath)) return ineligible("source_missing", element.src);
  const metadata = await deps.probeMetadata(srcPath, input.abortSignal);
  const sourceGate = checkSourceMetadata({
    metadata,
    transfer,
    mediaStart: element.mediaStart,
    duration: composition.duration,
    canvas: { width, height },
  });
  if (sourceGate) return sourceGate;

  input.assertNotAborted();
  const captureSession = await session.get();
  const { page } = captureSession;
  const transitionCount = await page.evaluate(() => {
    const hf = (window as unknown as { __hf?: { transitions?: unknown[] } }).__hf;
    return Array.isArray(hf?.transitions) ? hf.transitions.length : 0;
  });
  if (transitionCount > 0) return ineligible("shader_transitions", `${transitionCount}`);

  const layout = await probeVideoLayout(page, element.id, { width, height }, composition.duration);
  if ("reason" in layout) {
    return ineligible(asReason(layout.reason, LAYOUT_REASONS, "not_full_canvas"));
  }
  const animation = await page.evaluate(inspectVideoAnimation, element.id, composition.duration);
  if (animation) return ineligible(animation.reason, animation.detail);

  input.assertNotAborted();
  const timing = await analyzeOverlayTiming({
    session: captureSession,
    videoId: element.id,
    fps: job.config.fps,
    totalFrames: input.totalFrames,
    maxStates: DEFAULT_MAX_OVERLAY_STATES,
  });
  if (!timing.ok) return ineligible(timing.reason, timing.detail);

  return {
    eligible: true,
    video: {
      id: element.id,
      srcPath,
      mediaStart: element.mediaStart,
      duration: composition.duration,
      fps: job.config.fps,
      width: metadata.width,
      height: metadata.height,
      fit: layout.fit,
      transfer,
      primaries: "bt2020",
      colorSpace: metadata.colorSpace,
      metadata,
    },
    timing: timing.timing,
  };
}
