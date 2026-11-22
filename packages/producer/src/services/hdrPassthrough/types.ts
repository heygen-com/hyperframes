/**
 * HDR video passthrough with cached overlays — shared types.
 *
 * Opt-in (`experimentalHdrPassthrough` / `HF_EXPERIMENTAL_HDR_PASSTHROUGH` /
 * `--experimental-hdr-passthrough`). When a render would take the HDR layered
 * composite path and the composition is one full-frame native-HDR video under
 * DOM overlays that only change at statically known frames, the pipeline:
 *
 *   1. checks eligibility (`eligibility.ts`),
 *   2. plans the overlay states (`planner.ts`),
 *   3. captures each unique state once as a 16-bit RGBA PNG already mapped to
 *      the HDR signal space (`overlayCapture.ts`),
 *   4. composites the states onto the source video and encodes in one ffmpeg
 *      run (`ffmpegComposite.ts`),
 *
 * writing the same `videoOnlyPath` the layered stage would. Audio is mixed and
 * muxed afterwards by the normal pipeline, unchanged. Any ineligibility or
 * error falls back to the layered path (`index.ts`).
 *
 * See README.md in this directory for the design, eligibility and pixel contract.
 */

import type { Fps } from "@hyperframes/core";
import type {
  CaptureSession,
  HdrTransfer,
  VideoColorSpace,
  VideoMetadata,
  getEncoderPreset,
} from "@hyperframes/engine";
import type {
  CaptureHdrStageInput,
  CaptureHdrStageResult,
} from "../render/stages/captureHdrStage.js";
import type { DeliveryEncoderOptions } from "../render/deliveryEncoder.js";

// ── Stage I/O ──────────────────────────────────────────────────────────────

/**
 * Passthrough consumes exactly what the layered stage consumes, so the
 * orchestrator builds one input object and hands it to either path.
 */
export type HdrPassthroughInput = CaptureHdrStageInput;

/**
 * Passthrough returns the layered stage's result shape so the orchestrator's
 * post-capture bookkeeping (perf stages, warnings, console buffer) is shared.
 * `hdrPerf` is `undefined` on the passthrough path.
 */
export type HdrPassthroughResult = CaptureHdrStageResult;

/**
 * Outcome of `attemptHdrPassthrough`. `fallback` means the caller must run
 * the existing layered stage; `reason` is already logged.
 */
export type HdrPassthroughOutcome =
  | { kind: "completed"; result: HdrPassthroughResult }
  | {
      kind: "fallback";
      /** Ineligibility reason, or `"error"` when a stage threw. */
      reason: PassthroughIneligibleReason | "error";
      detail?: string;
    };

// ── Overlay capture session ────────────────────────────────────────────────

/**
 * A capture session opened on first use and closed by `attemptHdrPassthrough`
 * before it returns (success or fallback). Configured like the layered
 * stage's DOM session: screenshot mode, `initializeSession` done,
 * `initTransparentBackground(page, { clearCompositionRoot: true })` applied,
 * and the render's video-frame injector installed.
 */
export interface LazyOverlaySession {
  /** Opens (once) and returns the session. Safe to call repeatedly. */
  get(): Promise<CaptureSession>;
  /** True once `get()` has opened a session. */
  readonly opened: boolean;
  /** Closes the session if opened. Idempotent; never throws. */
  close(): Promise<void>;
}

// ── Eligibility ────────────────────────────────────────────────────────────

/**
 * Stable machine-readable reasons a composition cannot take the passthrough.
 * Logged as `[Render] HDR passthrough off: <reason>` before falling back.
 */
export type PassthroughIneligibleReason =
  // render-level gates
  | "not_hdr"
  | "output_format"
  | "alpha_output"
  | "output_scale"
  | "hdr_images"
  | "shader_transitions"
  | "motion_blur"
  | "graded_canvas"
  | "master_fx_chain"
  // the one video (mirrors qualifyVideoLayer reasons)
  | "video_count"
  | "video_not_native_hdr"
  | "hidden"
  | "color_grading"
  | "loop"
  | "playback_rate"
  | "late_start"
  | "ends_early"
  | "remote_source"
  | "source_missing"
  | "source_unsupported"
  // the one video's layout in the page (mirrors inspectVideoLayout reasons)
  | "video_missing"
  | "not_full_canvas"
  | "opacity"
  | "transform_or_filter"
  | "clip_or_mask"
  | "blend_mode"
  | "not_shown"
  | "ancestor_background"
  | "subcomposition_background"
  | "object_fit"
  | "paints_under"
  | "video_animated"
  // overlay timing (see planner.analyzeOverlayTiming)
  | "overlay_continuous_animation"
  | "overlay_non_gsap_animation"
  | "timeline_call"
  | "canvas"
  | "iframe"
  | "frame_source"
  | "unresolvable_clip_start"
  | "analysis_limit"
  | "too_many_states"
  // overlay capture (see overlayCapture.writeOverlayStates): a frame the
  // planner called static rendered a different overlay
  | "overlay_unverified";

/** The single full-frame HDR video the overlays sit on. */
export interface PassthroughVideo {
  /** Element id in the composition (`VideoElement.id`). */
  id: string;
  /** Absolute local path of the source file (remote sources are ineligible). */
  srcPath: string;
  /** Seconds into the source at composition time 0 (`VideoElement.mediaStart`, trim offset). */
  mediaStart: number;
  /** Seconds of source consumed: the composition duration (the video covers all of it). */
  duration: number;
  /** Output frame rate (the composition's, `job.config.fps`), not the source's. */
  fps: Fps;
  /** Source coded width in pixels. */
  width: number;
  /** Source coded height in pixels. */
  height: number;
  /** How the source maps to the canvas: 1:1 / stretch (`fill`) or same-aspect `cover`. */
  fit: "fill" | "cover";
  /** Signal transfer of the source; equals the render's effective HDR transfer. */
  transfer: HdrTransfer;
  /** Colour primaries of the source; v1 only accepts `"bt2020"`. */
  primaries: "bt2020";
  /** Raw probed colour space (for ffmpeg input tags). */
  colorSpace: VideoColorSpace | null;
  /** Full probed metadata (seek normalization, stream start, VFR flag). */
  metadata: VideoMetadata;
}

/**
 * Statically derived overlay timing. Every frame index where the overlay DOM
 * (everything except the passthrough video) may differ from the previous
 * frame. Frame 0 always starts a state and is never listed.
 */
export interface OverlayTiming {
  /** Composition frame count (`job.totalFrames`). */
  totalFrames: number;
  /**
   * Sorted, unique, each in `[1, totalFrames)`. Includes: clip boundary frames
   * (`data-start` / `data-duration` / authored end), zero-duration GSAP set
   * frames, the first frame after every tween ends, and, when a short
   * continuous tween is allowed, every frame inside it.
   */
  changeFrames: number[];
}

export type PassthroughEligibility =
  | {
      eligible: true;
      reason?: undefined;
      video: PassthroughVideo;
      timing: OverlayTiming;
    }
  | {
      eligible: false;
      reason: PassthroughIneligibleReason;
      /** Free-form context for the log line (e.g. which element animates). */
      detail?: string;
      video?: undefined;
      timing?: undefined;
    };

export type EligiblePassthrough = Extract<PassthroughEligibility, { eligible: true }>;

export interface CheckPassthroughEligibilityArgs {
  input: HdrPassthroughInput;
  session: LazyOverlaySession;
}

// ── Planner ────────────────────────────────────────────────────────────────

/**
 * One run of frames during which the overlay DOM is static.
 * Half-open: covers frames `startFrame <= f < endFrame`.
 */
export interface OverlayState {
  /** Position in `OverlayPlan.states` (0-based, contiguous). */
  index: number;
  startFrame: number;
  endFrame: number;
  /**
   * The frame seeked to when capturing this state. In a planned (candidate)
   * state: `Math.floor((startFrame + endFrame - 1) / 2)` (midpoint, away from
   * the tween edges the static analysis under-claims). In a captured state
   * (`CapturedOverlaySet.plan`), which merges candidates that render the same
   * overlay: the capture frame of the candidate it was first probed at.
   */
  captureFrame: number;
}

/**
 * Ordered states covering `[0, totalFrames)` exactly once with no gaps:
 * `states[0].startFrame === 0`, `states[i].endFrame === states[i+1].startFrame`,
 * `states.at(-1).endFrame === totalFrames`.
 */
export interface OverlayPlan {
  states: OverlayState[];
  fps: Fps;
  totalFrames: number;
  /** Canvas (output) width in pixels. */
  width: number;
  /** Canvas (output) height in pixels. */
  height: number;
}

export interface PlanOverlayStatesArgs {
  timing: OverlayTiming;
  fps: Fps;
  width: number;
  height: number;
}

export interface AnalyzeOverlayTimingArgs {
  /** The overlay session's page, already initialized. */
  session: CaptureSession;
  /** Excluded from the analysis (its playback is not an overlay change). */
  videoId: string;
  fps: Fps;
  totalFrames: number;
  /** Upper bound on distinct states before declaring `too_many_states`. */
  maxStates: number;
}

export type OverlayTimingAnalysis =
  | { ok: true; timing: OverlayTiming }
  | { ok: false; reason: PassthroughIneligibleReason; detail?: string };

// ── Overlay capture ────────────────────────────────────────────────────────

/** A planned state and the PNG that renders it. */
export interface CapturedOverlay {
  state: OverlayState;
  /**
   * Absolute path of a 16-bit RGBA PNG (`width x height`, the canvas size).
   * RGB = `getSrgbToSignalLut(transfer)[srgb8]` (the exact LUT
   * `blitRgba8OverRgb48le` uses), alpha = `alpha8 * 257`. Straight (not
   * premultiplied) alpha, so `overlay` computes
   * `out = signal * a + video * (1 - a)` exactly like the layered blend.
   * States with identical pixels share one file.
   */
  pngPath: string;
  /** Hex sha256 of the captured 8-bit RGBA pixels; equal hash ⇔ shared `pngPath`. */
  hash: string;
}

export interface CapturedOverlaySet {
  /** One entry per `plan.states`, same order. */
  overlays: CapturedOverlay[];
  /**
   * The input plan with its candidate states merged: one state per run of
   * frames that render the same overlay, so a state boundary is a frame where
   * the overlay output really changes. Same invariants as the input plan.
   * This, not the planner's plan, is what the composite consumes.
   */
  plan: OverlayPlan;
  /** Number of distinct PNG files written. */
  uniqueCount: number;
  /** Candidate states probed (the input plan's state count). */
  candidateCount: number;
  /**
   * Screenshots taken: at most one per distinct overlay fingerprint, plus
   * any the verification pass needed for a fingerprint it had not seen.
   */
  captureCount: number;
  /** Verification probes of frames inside merged states (`verificationFrames`). */
  verifyProbeCount: number;
  /** Directory holding the PNGs; owned by the render's workDir cleanup. */
  dir: string;
  /** Wall-clock ms spent seeking + capturing + mapping. */
  captureMs: number;
}

export interface CaptureOverlayStatesArgs {
  input: HdrPassthroughInput;
  session: CaptureSession;
  plan: OverlayPlan;
  video: PassthroughVideo;
  /** Directory to write PNGs into (created if missing). */
  outDir: string;
  /** Called after each state with the cumulative frames those states cover. */
  onStateCaptured?: (framesCovered: number, statesDone: number, statesTotal: number) => void;
}

// ── ffmpeg composite ───────────────────────────────────────────────────────

/** Encoder settings, taken verbatim from the layered stage's encoder spawn. */
export interface PassthroughEncoderSettings {
  preset: ReturnType<typeof getEncoderPreset>;
  effectiveQuality: number;
  effectiveBitrate: string | undefined;
  deliveryEncoder: DeliveryEncoderOptions;
  useGpu: boolean | undefined;
}

export interface CompositeRequest {
  video: PassthroughVideo;
  plan: OverlayPlan;
  overlays: CapturedOverlaySet;
  encoder: PassthroughEncoderSettings;
  /** HDR transfer the output is tagged with (`preset.hdr.transfer`). */
  hdr: { transfer: HdrTransfer };
  /** Final video-only file; the layered stage's `videoOnlyPath`. */
  outputPath: string;
  /** Scratch dir for the concat list (inside the render's workDir). */
  workDir: string;
  abortSignal: AbortSignal | undefined;
  /** ffmpeg's cumulative encoded-frame count, for progress + stall detection. */
  onFramesEncoded?: (frames: number) => void;
}

export interface CompositeResult {
  /** ffmpeg wall-clock ms. */
  encodeMs: number;
  /** Frames ffmpeg reported encoding; equals `plan.totalFrames` on success. */
  framesEncoded: number;
  /** Bytes written to `outputPath`. */
  fileSize: number;
}
