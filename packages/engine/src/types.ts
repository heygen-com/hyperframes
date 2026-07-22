/**
 * @hyperframes/engine — Protocol Types
 *
 * The engine's page contract. Any web page that wants to be rendered
 * as video must expose `window.__hf` implementing the HfProtocol interface.
 */
import type { Fps } from "@hyperframes/core";

/**
 * Outcome of waiting for a sub-composition's GSAP timelines to register.
 * Threaded string-typed through `CapturePerfSummary` / `RenderPerfSummary` /
 * telemetry so a single alias keeps the values in sync end-to-end.
 */
export type SubTimelineWaitOutcome = "ready" | "timeout" | "script_failure";

export type CaptureWarningCode =
  | "media_readiness_timeout"
  | "media_load_failed"
  | "audio_processing_failed"
  | "sub_timeline_readiness_timeout"
  | "sub_timeline_script_failure"
  | "live_map_detected";

/** Structured correctness warning produced while preparing a capture session. */
export interface CaptureWarning {
  code: CaptureWarningCode;
  message: string;
  details?: {
    mediaType?: "image" | "video" | "audio";
    sources?: string[];
    timeoutMs?: number;
  };
}

// ── Seek Protocol ──────────────────────────────────────────────────────────────

/**
 * Declares a media element the engine should handle.
 *
 * Headless Chrome in BeginFrame mode cannot play <video> or produce audio.
 * The engine pre-extracts video frames and audio tracks from declared media
 * elements and handles injection/mixing automatically.
 */
export interface HfMediaElement {
  /** DOM id of the <video> or <audio> element */
  elementId: string;
  /** Source file path or URL */
  src: string;
  /** When in the composition this element appears (seconds) */
  startTime: number;
  /** When in the composition this element disappears (seconds) */
  endTime: number;
  /** Offset into the source file (seconds, default: 0) */
  mediaOffset?: number;
  /** Audio volume 0-1 (default: 1) */
  volume?: number;
  /** Whether this element has audio that should be extracted */
  hasAudio?: boolean;
}

/**
 * Metadata for a shader transition between two scenes.
 *
 * Compositions using @hyperframes/shader-transitions populate
 * `window.__hf.transitions` with one entry per transition so the
 * producer can pre-compute scene ranges, capture per-scene buffers,
 * and apply the transition in HDR-aware compositing.
 */
export interface HfTransitionMeta {
  /** Time the transition starts (seconds) */
  time: number;
  /** Transition duration (seconds) */
  duration: number;
  /** Shader identifier. Undefined when the transition is a CSS crossfade. */
  shader?: string;
  /** GSAP easing string (e.g. "power2.inOut") */
  ease: string;
  /** Scene id the transition starts from */
  fromScene: string;
  /** Scene id the transition ends on */
  toScene: string;
}

/**
 * The seek protocol. The only contract between the engine and a page.
 *
 * The engine reads `duration` to calculate total frames, calls `seek(time)`
 * before each frame capture, and uses `media` (if provided) to handle
 * video frame injection and audio mixing.
 *
 * The engine does NOT care what animation framework drives the page.
 * GSAP, Framer Motion, CSS animations, Three.js — anything works as long
 * as `seek()` produces deterministic visual output for a given time.
 */
export interface HfProtocol {
  /** Total duration of the composition in seconds */
  duration: number;
  /** Seek to a specific time. Must produce deterministic visual output. */
  seek(time: number): void;
  /** Optional: media elements the engine should handle */
  media?: HfMediaElement[];
  /** Optional: shader transition metadata, populated by @hyperframes/shader-transitions */
  transitions?: HfTransitionMeta[];
}

// ── Capture Types ──────────────────────────────────────────────────────────────

export interface CaptureOptions {
  width: number;
  height: number;
  /**
   * Producer-resolved composition duration (seconds) — the data-duration
   * clamp actually rendered, which can differ from the page's raw
   * `__hf.duration` (infinite-repeat GSAP timelines report a huge sentinel;
   * timelines can outrun their declared duration). Consumers that derive
   * frame indices meant to be drained by the producer (drawElement
   * self-verification) MUST prefer this over `__hf.duration`.
   */
  compositionDurationSeconds?: number;
  /**
   * Frame rate as an exact rational. Integer fps is `{ num: 30, den: 1 }`;
   * NTSC is `{ num: 30000, den: 1001 }`. Captures are scheduled by the
   * decimal interval (1000 * den / num ms) but FFmpeg arg builders emit the
   * rational form verbatim — see `fpsToFfmpegArg`.
   */
  fps: Fps;
  format?: "jpeg" | "png";
  quality?: number;
  deviceScaleFactor?: number;
  /**
   * Opt into Chrome's capture-beyond-viewport screenshot path. Leave undefined
   * to let the engine pick the safe browser-specific default. Pass false only
   * when the caller explicitly wants Chrome's faster viewport-bound path.
   * Enable for known compositor edge cases such as native video surfaces in
   * tall portrait renders.
   */
  captureBeyondViewport?: boolean;
  /**
   * FFmpeg-probed intrinsic dimensions for videos whose frames are injected
   * out-of-band. Applied before the readiness wait so layout that depends on
   * video aspect ratio (e.g. `height:auto`) stays stable even if Chromium never
   * loads native metadata.
   */
  videoMetadataHints?: readonly CaptureVideoMetadataHint[];
  /**
   * Video element IDs to exclude from the in-page readiness check that waits
   * for `video.readyState >= 1` before capture starts.
   *
   * Use for videos whose frames are supplied out-of-band, including standard
   * FFmpeg frame injection and native HDR extraction. Pair with
   * `videoMetadataHints` for any skipped video whose CSS layout may depend on
   * intrinsic media dimensions.
   */
  skipReadinessVideoIds?: readonly string[];
  /**
   * Render-time variable overrides for the composition. The engine injects
   * these as `window.__hfVariables` via `evaluateOnNewDocument` before any
   * page script runs, so the runtime helper `getVariables()` returns the
   * merged result of declared defaults (`data-composition-variables`) and
   * these overrides on its first call.
   *
   * The CLI populates this from `--variables '<json>'` /
   * `--variables-file <path>`. Must be a JSON-serializable plain object.
   */
  variables?: Record<string, unknown>;
  /**
   * When `true`, the BeginFrame warmup loop driven during page navigation
   * runs exactly `LOCKED_WARMUP_TICKS` (60) iterations regardless of how
   * long the page load takes, making `session.beginFrameTimeTicks`
   * deterministic across machines with different page-load latencies.
   *
   * Default `false`: wall-clock-bounded driver — ticks until page-readiness
   * completes, accumulating whatever count the host CPU manages. Preserves
   * the in-process renderer's BeginFrame timing baselines.
   *
   * Has no effect outside BeginFrame mode (screenshot capture never runs a
   * warmup loop).
   */
  lockWarmupTicks?: boolean;
  /**
   * drawElement self-verify ground-truth sample count for this session.
   * Overrides the HF_DE_VERIFY default (4). The parallel coordinator raises
   * it for multi-worker drawElement capture — N concurrent hardware-GPU
   * browsers widen the damage surface (compositor tile eviction under
   * GPU/memory pressure), and each worker only drains ~1/N of the shared
   * sample grid, thinning effective coverage exactly when risk peaks.
   * Clamped to 0..8 like the env knob; HF_DE_VERIFY, when set, still wins.
   */
  deVerifySamples?: number;
}

export interface CaptureVideoMetadataHint {
  id: string;
  width: number;
  height: number;
}

export interface CaptureResult {
  frameIndex: number;
  time: number;
  path: string;
  captureTimeMs: number;
}

export interface CaptureBufferResult {
  buffer: Buffer;
  captureTimeMs: number;
}

export interface CapturePerfSummary {
  frames: number;
  avgTotalMs: number;
  avgSeekMs: number;
  avgBeforeCaptureMs: number;
  avgScreenshotMs: number;
  /**
   * Median per-frame capture time — warmup-robust, unlike `avgTotalMs`
   * (first frames pay font/image decode + GC that swamps short renders'
   * averages). Basis for in-the-wild speedup estimates. 0 when no frames.
   */
  p50TotalMs: number;
  /**
   * 95th-percentile per-frame capture time (nearest-rank). Emitted alongside
   * p50 so the fast-capture-fallback-profile diagnostic (opt-in via
   * `HF_PROFILE_FALLBACK_CAPTURE=true`) can distinguish "steady-state slow"
   * from "long-tail spikes"; the p50 alone hides the tail on any sample set
   * with a heavy right-skew (typical of screenshot capture on GC pauses or
   * paint-heavy frames). 0 when no frames.
   */
  p95TotalMs: number;
  /**
   * 99th-percentile per-frame capture time (nearest-rank). Same purpose as
   * `p95TotalMs` — the extreme-tail counterpart, useful for characterizing
   * the WORST frame you're likely to encounter on the fallback path. 0 when
   * no frames.
   */
  p99TotalMs: number;
  /** Sub-composition timeline wait outcome (absent pre-init). */
  subTimelineWaitOutcome?: SubTimelineWaitOutcome;
  /** Correctness warnings observed before or during capture. */
  warnings?: CaptureWarning[];
  /**
   * Frames served from the static-dedup cache instead of a real seek+screenshot
   * (opt-out HF_STATIC_DEDUP=false). 0 when dedup was off or never armed. NOT counted
   * in `frames` (reuses are excluded so they don't dilute the per-frame
   * averages) — the captured total this session is `frames + staticDedupReused`.
   */
  staticDedupReused: number;
  /** `HF_STATIC_DEDUP=true` was set for this render (adoption signal). */
  staticDedupEnabled: boolean;
  /** Dedup passed every gate + verification and was active. */
  staticDedupArmed: boolean;
  /** Predicted reusable frame count when armed; 0 otherwise. */
  staticDedupPredicted: number;
  /**
   * Low-cardinality reason dedup did not arm: `capture_mode` | `video_injection`
   * | `page_composite` | `ineligible` | `verification_failed` | `verification_budget`.
   * Undefined when armed or when dedup was disabled. (Render-level aggregation may
   * `|`-join distinct reasons when parallel workers diverge.)
   */
  staticDedupSkipReason?: string;
  // ── BeginFrame no-damage reuse (Linux/Docker lastFrameCache visibility) ──
  /**
   * BeginFrame frames where Chrome reported `hasDamage=false` and the previous
   * buffer was reused from the per-page lastFrameCache (screenshotService.ts) —
   * the BF counterpart of `staticDedupReused` (predictive dedup never arms
   * under beginframe). Undefined/0 outside beginframe capture mode.
   */
  beginFrameNoDamage?: number;
  /** BeginFrame frames where Chrome reported damage (fresh screenshot encoded). */
  beginFrameHasDamage?: number;
  // ── drawElement fast-capture outcome (default-on release visibility) ──
  /** Final capture mode this session used: "drawelement" | "screenshot" | "beginframe". */
  captureMode: string;
  /**
   * Low-cardinality init-time gate that routed a drawElement-eligible session
   * to the baseline: `swiftshader` | `css_effect:<fx>` | `at_risk_timeline` |
   * `3d_init_failed` | `supersampling` | `render_mode_hint`. Undefined when
   * drawElement ran or was never attempted.
   */
  deGateReason?: string;
  /**
   * Full-fidelity fallback trigger — the specific reason (CSS FX + property,
   * e.g. `filter:blur`, `filter:drop-shadow`, `backdrop-filter`, `clip-path`,
   * or an unsanitized gate name like `at_risk_timeline`, `swiftshader`,
   * `unsupported_chrome`, `render_mode_hint`, `supersampling`, `3d_init_failed`)
   * that gated drawElement off. Complementary to {@link deGateReason}, which
   * sanitizes down to a low-cardinality bucket for aggregation; this field
   * keeps the specific CSS FX so the `capture_fallback_profile` observability
   * checkpoint can characterize per-frame perf by the exact trigger. Undefined
   * when drawElement ran (no fallback) or was never attempted.
   */
  deFallbackTrigger?: string;
  /** Worker-encode pipeline active (the drain that runs self-verification). */
  deWorkerEncode: boolean;
  /** Self-verification ground-truth samples armed at init (0 = verification off/skipped). */
  deVerifyArmed: number;
  /** Wall-clock cost of capturing the ground-truth samples at init. */
  deVerifyInitMs: number;
  /** Clip-cut boundary frames routed to per-frame screenshot (Lim 6). */
  deBoundaryFrames: number;
  /** Per-frame "No cached paint record" screenshot fallbacks during capture. */
  deNcprFallbacks: number;
}

// ── Global Augmentation ────────────────────────────────────────────────────────

declare global {
  interface Window {
    __hf?: HfProtocol;
  }
}
