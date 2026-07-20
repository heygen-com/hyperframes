/**
 * Engine Configuration
 *
 * Typed configuration for the rendering pipeline. Replaces the PRODUCER_*
 * env var sprawl with a structured interface. Env vars still work as
 * fallbacks for backward compatibility during migration.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSystemTotalMb,
  isLowMemorySystem,
  LOW_MEMORY_TOTAL_MB_THRESHOLD,
} from "./services/systemMemory.js";
import { DEFAULT_VP9_CPU_USED, normalizeVp9CpuUsed } from "./services/vp9Options.js";

/**
 * Full engine configuration. All fields are wired through the config
 * object; env vars serve as backward-compatible fallbacks resolved
 * in `resolveConfig()`.
 */
export interface EngineConfig {
  // ── Rendering ────────────────────────────────────────────────────────
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  format: "jpeg" | "png";
  jpegQuality: number;

  // ── Parallelism ──────────────────────────────────────────────────────
  /** Max worker count. "auto" uses CPU-based heuristic. */
  concurrency: number | "auto";
  /** CPU cores allocated per worker. */
  coresPerWorker: number;
  /** Minimum frames before parallel workers are used. */
  minParallelFrames: number;
  /** Frame count threshold for "large render" heuristics. */
  largeRenderThreshold: number;

  // ── Browser ──────────────────────────────────────────────────────────
  chromePath?: string;
  disableGpu: boolean;
  /**
   * Chrome/WebGL rendering backend.
   * - "software": SwiftShader (CPU-only). Always works; ~5-50× slower than GPU.
   * - "hardware": host GPU via platform-native ANGLE backend (Metal/D3D11/EGL).
   *   Errors if no usable GPU is reachable from Chrome.
   * - "auto": probe Chrome for WebGL availability on first launch in this
   *   process; fall back to software if hardware-mode WebGL is unavailable.
   *   Cost: one extra Chrome launch (~1-2 s) per process; result cached.
   */
  browserGpuMode: "software" | "hardware" | "auto";
  enableBrowserPool: boolean;
  browserTimeout: number;
  protocolTimeout: number;
  /** Expected Chromium major version (optional validation). */
  expectedChromiumMajor?: number;
  /** Force screenshot capture mode (skip BeginFrame even on Linux). */
  forceScreenshot: boolean;
  /**
   * Static-frame dedup: reuse byte-identical frames instead of re-seeking +
   * re-screenshotting (anchor-verified at init). Default ON; disable via
   * `HF_STATIC_DEDUP` in {false,0,off}. Only arms in screenshot capture mode.
   */
  staticFrameDedup: boolean;
  /**
   * Use drawElementImage for frame capture (requires the CanvasDrawElement
   * Chrome flag, added globally in buildChromeArgs). Default ON, clamped in
   * `resolveConfig` to hosts where it can actually engage (macOS + hardware-GPU
   * browser); compile/init gates and the runtime self-verification net route
   * incompatible or damaged renders back to screenshot capture.
   * Kill switch: `PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false` (or the CLI
   * `--experimental-fast-capture=false`).
   */
  useDrawElement: boolean;
  /**
   * Pipeline JPEG encode into an in-page OffscreenCanvas Worker for the
   * drawElement fast-capture path (macOS hardware GPU only). The worker
   * encodes frame N while the main thread seeks+paints frame N+1
   * (~1.65–1.96× wall-time speedup). No-op unless `useDrawElement` is also
   * true. Kill switch: `HF_DE_WORKER_ENCODE=false`.
   */
  enableDrawElementWorkerEncode: boolean;
  /**
   * INTERNAL. Set by resolveConfig when it disabled enablePageSideCompositing
   * solely because drawElement was on. Lets the producer's compile-time gates
   * restore page-side compositing without overriding an explicit caller/env
   * opt-out. Not intended to be set by callers.
   */
  pageSideCompositingAutoDisabled?: boolean;
  /**
   * INTERNAL. Set to `true` by `resolveConfig` when the caller explicitly
   * opted out of the software-GPU→screenshot clamp — either via env
   * `PRODUCER_FORCE_SCREENSHOT=false` or programmatic
   * `overrides.forceScreenshot === false`. The concrete-resolved-GPU helper
   * (`shouldClampToScreenshotForConcreteGpu`) reads this so the
   * `browserGpuMode:"auto"` → software probe path preserves the same
   * escape hatch as literal `browserGpuMode:"software"` (the boolean
   * `forceScreenshot === false` at that point is otherwise ambiguous —
   * default vs explicit opt-out — because the config resolves before
   * the runtime probe fires). Not intended to be set by callers.
   */
  forceScreenshotExplicitlyOptedOut?: boolean;
  /**
   * Low-memory render profile. When `true`, the orchestrator collapses the
   * pipeline to its cheapest shape on memory-constrained hosts: it skips the
   * throwaway auto-worker calibration browser, pins capture to a single
   * worker (unless the user passed an explicit `--workers`), and prefers
   * screenshot capture over BeginFrame. Resolved automatically from total
   * RAM (`isLowMemorySystem()`); force on/off via `PRODUCER_LOW_MEMORY_MODE`
   * or the `--low-memory-mode` CLI flag.
   */
  lowMemoryMode: boolean;
  /**
   * Opt-in: page-side shader-transition compositing.
   *
   * When `true`, shader transitions for SDR compositions run their blend
   * inside Chrome via WebGL on a page-side compositor canvas instead of
   * Node-side per-pixel blending (the hf#677 layered pipeline). The engine
   * then captures ONE opaque RGB frame per output frame via the streaming
   * capture path, skipping per-scene transparent screenshots and the
   * Node-side shader-blend worker pool entirely.
   *
   * The feature stacks on top of the hf#677 chain — it does not undo it.
   * When this flag is OFF (the default), behaviour is byte-identical to the
   * current path. When ON and the composition has no shader transitions or
   * has HDR content (which forces the layered path regardless), this flag
   * is a no-op.
   *
   * Mac viability: Chrome on Mac accelerates page-side WebGL canvases via
   * Metal/CoreAnimation natively. This is the lever for Mac users who
   * cannot use `--enable-begin-frame-control` (Chromium structural limit,
   * crbug.com/40656275).
   *
   * Determinism: page-side WebGL is f32, not f64. Byte-equality fixture
   * pins are NOT compatible with this path; the new path's correctness
   * pin is PSNR-based. Default OFF preserves the existing pins for the
   * hf#677 chain.
   *
   * Env fallback: `HF_PAGE_SIDE_COMPOSITING=true`.
   */
  enablePageSideCompositing: boolean;

  // ── Encoding ─────────────────────────────────────────────────────────
  /**
   * libvpx-vp9 speed/quality tradeoff. Higher values encode faster with a
   * larger quality/size tradeoff. FFmpeg accepts integer values from -8 to 8.
   */
  vp9CpuUsed: number;
  enableChunkedEncode: boolean;
  chunkSizeFrames: number;
  enableStreamingEncode: boolean;
  /**
   * INTERNAL. Set by `resolveConfig` when the Windows software-GPU compound
   * heuristic (`shouldAutoDisableStreamingEncodeOnWin32Compound`) turned
   * `enableStreamingEncode` off on the caller's behalf. Not intended to be
   * set by callers; surfaces the auto-decision for downstream observability
   * (log lines, telemetry) so operators can tell an auto-disable apart from
   * an explicit user opt-out.
   */
  streamingEncodeAutoDisabledOnWin32Compound?: boolean;
  /**
   * Max composition duration eligible for streaming encode (seconds).
   * Mirrors GSAP rendering's 4-minute streaming guard: production has seen
   * ffmpeg's streaming pipe hit FFMPEG_STREAMING_TIMEOUT_MS on longer videos.
   */
  streamingEncodeMaxDurationSeconds: number;

  // ── FFmpeg timeouts ──────────────────────────────────────────────────
  /** Timeout for FFmpeg frame encoding (ms). Default: 600_000 */
  ffmpegEncodeTimeout: number;
  /** Timeout for FFmpeg mux/faststart processes (ms). Default: 300_000 */
  ffmpegProcessTimeout: number;
  /**
   * Inactivity timeout for FFmpeg streaming encode (ms). The timer resets on
   * every successful `writeFrame` call, so this caps the duration of a
   * single "no frame arrived" gap (capture hang, dead Chrome), not the total
   * render time. Default: 600_000 (10 minutes without any frame = dead).
   */
  ffmpegStreamingTimeout: number;

  // ── HDR ──────────────────────────────────────────────────────────────
  /** HDR output transfer function. false = SDR output (default). */
  hdr: { transfer: "hlg" | "pq" } | false;
  /** Auto-detect HDR from video sources when hdr is not explicitly set. */
  hdrAutoDetect: boolean;

  // ── Media ────────────────────────────────────────────────────────────
  audioGain: number;
  /**
   * Hard upper bound on entries kept in the video frame data URI cache.
   * Acts as a sanity cap; the byte budget below normally fires first on
   * high-resolution renders. At 1080p with ~6 MB per JPEG frame the default
   * 256 entries fit inside ~1.5 GB. At 4K the byte budget evicts long
   * before this cap is reached.
   */
  frameDataUriCacheLimit: number;
  /**
   * Memory budget for the cache, in megabytes. Eviction kicks in once the
   * sum of cached data-URI string lengths exceeds this. Sized so a worker
   * stays comfortably under a few GB even at 4K (where each PNG frame is
   * ~25 MB and the base64 data URI is ~33 MB).
   */
  frameDataUriCacheBytesLimitMb: number;

  // ── Timeouts ─────────────────────────────────────────────────────────
  playerReadyTimeout: number;
  renderReadyTimeout: number;
  /**
   * Puppeteer `page.goto()` navigation timeout for the entry HTML, in ms.
   * The browser must reach `domcontentloaded` within this budget — heavy
   * compositions (many videos, large fonts, hundreds of asset requests)
   * can blow past the default 60s on cold cache. Default: 60_000.
   *
   * Env fallback: `PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS`.
   * CLI flag: `--browser-timeout <seconds>`.
   */
  pageNavigationTimeout: number;

  // ── Runtime ──────────────────────────────────────────────────────────
  /** Verify Hyperframe runtime SHA256 checksums. */
  verifyRuntime: boolean;
  /** Custom manifest path for Hyperframe runtime. */
  runtimeManifestPath?: string;

  // ── Cache ────────────────────────────────────────────────────────────
  /**
   * Directory where the content-addressed extraction cache persists frame
   * bundles keyed on (path, mtime, size, mediaStart, duration, fps, format).
   * Defaults on under the OS temp directory:
   * `<tmpdir>/hyperframes-extract-cache-<uid>`.
   *
   * New entries publish atomically: frames are extracted into a unique
   * partial directory, the `.hf-complete` sentinel is written there, and the
   * partial directory is renamed into the final key directory. Concurrent
   * renders against the same cache are safe; at worst, two renders duplicate
   * ffmpeg work and one rehydrates from the winner.
   *
   * Set `HYPERFRAMES_EXTRACT_CACHE_DIR` to a path to override the default, or
   * to `off`, `none`, `false`, or `0` to disable caching for the process.
   * When disabled, extraction runs into the render's workDir and cleanup
   * removes it when the render ends, preserving the pre-cache behaviour.
   *
   * **Network filesystems.** `mtime` resolution on NFS/SMB mounts can be
   * coarser than expected (seconds rather than nanoseconds), which may
   * produce spurious cache hits if a source file is overwritten within the
   * same mtime tick. Local filesystems are the intended deployment target.
   *
   * Env fallback: `HYPERFRAMES_EXTRACT_CACHE_DIR`.
   */
  extractCacheDir?: string;
  /**
   * Soft disk budget for `extractCacheDir`, in bytes. The renderer runs a
   * best-effort LRU sweep after extraction and evicts oldest sentineled
   * entries until the cache is under this cap, while protecting young entries
   * that may belong to live renders.
   *
   * Env fallback: `HYPERFRAMES_EXTRACT_CACHE_MAX_MB` (megabytes).
   */
  extractCacheMaxBytes: number;

  // ── Debug ────────────────────────────────────────────────────────────
  debug: boolean;
}

/** Default configuration — sensible for Hyperframes compositions. */
export const DEFAULT_CONFIG: EngineConfig = {
  fps: 30,
  quality: "standard",
  format: "jpeg",
  jpegQuality: 80,

  concurrency: "auto",
  coresPerWorker: 2.5,
  minParallelFrames: 120,
  largeRenderThreshold: 1000,

  disableGpu: false,
  browserGpuMode: "software",
  enableBrowserPool: true,
  browserTimeout: 120_000,
  protocolTimeout: 300_000,
  forceScreenshot: false,
  staticFrameDedup: true,
  useDrawElement: true,
  enableDrawElementWorkerEncode: true,
  // Auto-detected per host in `resolveConfig`; defaults off for the raw
  // DEFAULT_CONFIG (used directly by tests and worker-sizing fallbacks).
  lowMemoryMode: false,
  enablePageSideCompositing: true,

  vp9CpuUsed: DEFAULT_VP9_CPU_USED,
  enableChunkedEncode: false,
  chunkSizeFrames: 360,
  enableStreamingEncode: true,
  streamingEncodeMaxDurationSeconds: 240,

  ffmpegEncodeTimeout: 600_000,
  ffmpegProcessTimeout: 300_000,
  ffmpegStreamingTimeout: 600_000,

  hdr: false,
  hdrAutoDetect: true,

  audioGain: 1,
  frameDataUriCacheLimit: 256,
  frameDataUriCacheBytesLimitMb: 1500,

  playerReadyTimeout: 45_000,
  renderReadyTimeout: 15_000,
  pageNavigationTimeout: 60_000,

  verifyRuntime: true,

  extractCacheMaxBytes: 2 * 1024 ** 3,

  debug: false,
};

const OPTIONAL_ENGINE_CONFIG_FIELDS = [
  "chromePath",
  "expectedChromiumMajor",
  "pageSideCompositingAutoDisabled",
  "forceScreenshotExplicitlyOptedOut",
  "streamingEncodeAutoDisabledOnWin32Compound",
  "runtimeManifestPath",
  "extractCacheDir",
] as const;

const BOOLEAN_ENGINE_CONFIG_FIELDS = [
  "disableGpu",
  "enableBrowserPool",
  "forceScreenshot",
  "staticFrameDedup",
  "useDrawElement",
  "enableDrawElementWorkerEncode",
  "lowMemoryMode",
  "enablePageSideCompositing",
  "enableChunkedEncode",
  "enableStreamingEncode",
  "hdrAutoDetect",
  "verifyRuntime",
  "debug",
] as const;

const POSITIVE_NUMBER_ENGINE_CONFIG_FIELDS = [
  "browserTimeout",
  "protocolTimeout",
  "chunkSizeFrames",
  "ffmpegEncodeTimeout",
  "ffmpegProcessTimeout",
  "ffmpegStreamingTimeout",
  "frameDataUriCacheLimit",
  "frameDataUriCacheBytesLimitMb",
  "playerReadyTimeout",
  "renderReadyTimeout",
  "pageNavigationTimeout",
  "extractCacheMaxBytes",
] as const;

const ENUM_ENGINE_CONFIG_FIELDS = {
  fps: [24, 30, 60],
  quality: ["draft", "standard", "high"],
  format: ["jpeg", "png"],
  browserGpuMode: ["software", "hardware", "auto"],
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function assertEngineConfigNumber(
  config: Record<string, unknown>,
  field: string,
  min: number,
  integer = false,
): void {
  const value = config[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `Engine config ${field} must be a ${integer ? "finite integer" : "finite number"} >= ${min}`,
    );
  }
}

function assertPositiveEngineConfigNumber(config: Record<string, unknown>, field: string): void {
  const value = config[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Engine config ${field} must be a finite number > 0`);
  }
}

function assertEngineConfigEnum(
  config: Record<string, unknown>,
  field: string,
  values: readonly unknown[],
): void {
  if (!values.includes(config[field])) throw new Error(`Engine config ${field} is invalid`);
}

function validateRequiredEngineConfigFields(config: Record<string, unknown>): void {
  const requiredFields = Object.keys(DEFAULT_CONFIG);
  for (const field of requiredFields) {
    if (!Object.hasOwn(config, field)) {
      throw new Error(`Engine config snapshot is missing required field ${field}`);
    }
  }
  const allowedFields = new Set([...requiredFields, ...OPTIONAL_ENGINE_CONFIG_FIELDS]);
  for (const field of Object.keys(config)) {
    if (!allowedFields.has(field))
      throw new Error(`Engine config snapshot has unknown field ${field}`);
  }
}

function validateEngineConfigScalars(config: Record<string, unknown>): void {
  for (const [field, values] of Object.entries(ENUM_ENGINE_CONFIG_FIELDS)) {
    assertEngineConfigEnum(config, field, values);
  }
  assertEngineConfigNumber(config, "jpegQuality", 0);
  if (typeof config.jpegQuality === "number" && config.jpegQuality > 100) {
    throw new Error("Engine config jpegQuality must be <= 100");
  }
}

function validateEngineConfigParallelism(config: Record<string, unknown>): void {
  if (
    config.concurrency !== "auto" &&
    (typeof config.concurrency !== "number" ||
      !Number.isInteger(config.concurrency) ||
      config.concurrency < 1)
  ) {
    throw new Error("Engine config concurrency must be a positive integer or auto");
  }
  assertPositiveEngineConfigNumber(config, "coresPerWorker");
  for (const field of ["minParallelFrames", "largeRenderThreshold"] as const) {
    assertEngineConfigNumber(config, field, 0, true);
  }
}

function validateEngineConfigVp9(config: Record<string, unknown>): void {
  if (
    typeof config.vp9CpuUsed !== "number" ||
    !Number.isInteger(config.vp9CpuUsed) ||
    config.vp9CpuUsed < -8 ||
    config.vp9CpuUsed > 8
  ) {
    throw new Error("Engine config vp9CpuUsed must be an integer in [-8, 8]");
  }
}

function validateEngineConfigRuntime(config: Record<string, unknown>): void {
  for (const field of BOOLEAN_ENGINE_CONFIG_FIELDS) {
    if (typeof config[field] !== "boolean")
      throw new Error(`Engine config ${field} must be a boolean`);
  }
  for (const field of POSITIVE_NUMBER_ENGINE_CONFIG_FIELDS) {
    assertEngineConfigNumber(config, field, 1, field === "frameDataUriCacheLimit");
  }
  assertEngineConfigNumber(config, "streamingEncodeMaxDurationSeconds", 0);
  assertEngineConfigNumber(config, "audioGain", 0);
}

function validateEngineConfigHdr(config: Record<string, unknown>): void {
  const { hdr } = config;
  if (
    hdr !== false &&
    (!isPlainObject(hdr) ||
      Object.keys(hdr).length !== 1 ||
      (hdr.transfer !== "hlg" && hdr.transfer !== "pq"))
  ) {
    throw new Error("Engine config hdr must be false or an hlg/pq transfer object");
  }
}

function validateOptionalEngineConfigFields(config: Record<string, unknown>): void {
  for (const field of ["chromePath", "runtimeManifestPath", "extractCacheDir"] as const) {
    if (
      config[field] !== undefined &&
      (typeof config[field] !== "string" || config[field].length === 0)
    ) {
      throw new Error(`Engine config ${field} must be a non-empty string`);
    }
  }
  if (config.expectedChromiumMajor !== undefined) {
    assertEngineConfigNumber(config, "expectedChromiumMajor", 1, true);
  }
  for (const field of [
    "pageSideCompositingAutoDisabled",
    "forceScreenshotExplicitlyOptedOut",
    "streamingEncodeAutoDisabledOnWin32Compound",
  ] as const) {
    if (config[field] !== undefined && typeof config[field] !== "boolean") {
      throw new Error(`Engine config ${field} must be a boolean`);
    }
  }
}

/**
 * Validate a complete EngineConfig crossing a JSON wire boundary.
 *
 * `resolveConfig()` intentionally accepts partial programmatic overrides, but
 * a serialized render request stores a resolved snapshot. Accepting a partial
 * snapshot would skip the orchestrator's `resolveConfig()` fallback entirely.
 */
export function validateEngineConfigSnapshot(value: unknown): asserts value is EngineConfig {
  if (!isPlainObject(value)) throw new Error("Engine config snapshot must be a plain object");
  validateRequiredEngineConfigFields(value);
  validateEngineConfigScalars(value);
  validateEngineConfigParallelism(value);
  validateEngineConfigVp9(value);
  validateEngineConfigRuntime(value);
  validateEngineConfigHdr(value);
  validateOptionalEngineConfigFields(value);
}

/**
 * Reference canvas area for the baseline `protocolTimeout`: 1080p. A single CDP
 * call (`Runtime.callFunctionOn` seek+paint, or `Page.captureScreenshot`)
 * scales with the *output pixel area* it has to render/serialize — NOT with the
 * frame count (that governs total wall-clock, capped separately by the ffmpeg
 * streaming inactivity timeout). A fixed 300s ceiling intermittently kills
 * legitimate slow-but-valid renders on large canvases with
 * `Runtime.callFunctionOn timed out`, so we scale the per-call ceiling with
 * area.
 */
const PROTOCOL_TIMEOUT_REFERENCE_PIXELS = 1920 * 1080;

/**
 * Absolute ceiling on the scaled protocol timeout (30 minutes). Bounds the
 * blast radius: a genuinely wedged CDP call must still eventually fail rather
 * than hang for an unbounded time on a pathologically large composition.
 */
const MAX_SCALED_PROTOCOL_TIMEOUT_MS = 1_800_000;

/**
 * Scale a base `protocolTimeout` up for oversized compositions.
 *
 * Scales by output pixel area (`width*height / reference`) — where width/height
 * are the *device-scaled output* dimensions (the pixels a single CDP call
 * actually renders/serializes), not the CSS composition size. Clamped to
 * `[baseTimeout, max(baseTimeout, MAX_SCALED_PROTOCOL_TIMEOUT_MS)]`: never
 * scales DOWN (a small composition — or a base already above the ceiling —
 * keeps the configured base), and only ever raises. Pure function; exported
 * for tests.
 */
export function scaleProtocolTimeoutForComposition(
  baseTimeoutMs: number,
  dims: { width: number; height: number },
): number {
  const { width, height } = dims;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return baseTimeoutMs;
  }
  const factor = (width * height) / PROTOCOL_TIMEOUT_REFERENCE_PIXELS;
  if (factor <= 1) return baseTimeoutMs;
  const scaled = Math.ceil(baseTimeoutMs * factor);
  // Ceiling is `max(base, MAX)` so an explicit base above the ceiling is never
  // lowered (preserves the "only ever raise" contract for all callers).
  const ceiling = Math.max(baseTimeoutMs, MAX_SCALED_PROTOCOL_TIMEOUT_MS);
  return Math.min(ceiling, Math.max(baseTimeoutMs, scaled));
}

/**
 * Auto-disable `enableStreamingEncode` on Windows software-GPU compound.
 *
 * Field signal (`ts=1784131903`, win32/x64, CLI 0.7.58, 156s UI-heavy
 * composition): the render was stable ONLY with FOUR flags together —
 * `--workers 1 --no-browser-gpu --low-memory-mode` + explicit
 * `PRODUCER_ENABLE_STREAMING_ENCODE=false`. Every recent Windows-related
 * fix (#2359, #2245, #2298, #2331) already shipped in 0.7.58; the residual
 * failure is screenshot streaming-encode via CDP `Page.captureScreenshot`
 * on Windows even after software fallback. Since `--low-memory-mode` and
 * `--no-browser-gpu` already imply screenshot capture, three of the four
 * flags are structurally coupled — auto-detect the compound and disable
 * streaming-encode automatically so callers don't have to memorize the
 * four-flag combination.
 *
 * Conservative gates (all must hold):
 *   1. `platform === "win32"` — the failure is Windows-specific to CDP's
 *      screenshot streaming path.
 *   2. `softwareGpuForced` — the render is already on the SwiftShader /
 *      forced-screenshot path (from `--no-browser-gpu`, `disableGpu`, or
 *      `--low-memory-mode` implying screenshot capture).
 *   3. `workers === 1` — the field signal reproduces on single-worker
 *      captures; parallel workers have a different failure surface
 *      (missing media frames) already handled by the worker-count route.
 *   4. Composition duration >120s WHEN KNOWN. When unknown at the config
 *      layer (composition duration is parsed downstream), the guard
 *      reduces to the three-condition compound. Trade-off documented in
 *      the PR body: false positives possible for short (~<120s) Windows
 *      software-GPU single-worker renders. Mitigation: the explicit
 *      opt-in escape hatch (`PRODUCER_ENABLE_STREAMING_ENCODE=true` or
 *      `overrides.enableStreamingEncode !== undefined`) always wins.
 *
 * Pure function; exported for tests.
 */
export function shouldAutoDisableStreamingEncodeOnWin32Compound(opts: {
  platform: NodeJS.Platform;
  softwareGpuForced: boolean;
  workers: number;
  compositionDurationSec: number | undefined;
  userExplicitlySet: boolean;
}): boolean {
  if (opts.userExplicitlySet) return false;
  if (opts.platform !== "win32") return false;
  if (!opts.softwareGpuForced) return false;
  // Strict equality: NaN (concurrency: "auto") and fractional / zero worker
  // counts do NOT match. The field-signal compound is `--workers 1`.
  if (opts.workers !== 1) return false;
  // Duration boundary: when known, only auto-disable if >120s (avoid
  // over-triggering on short renders). When unknown, skip this check —
  // the three conditions above are already conservative on their own.
  if (opts.compositionDurationSec !== undefined && opts.compositionDurationSec <= 120) {
    return false;
  }
  return true;
}

/**
 * Result of resolving the extract cache directory from the env, decoupled from
 * the wider {@link resolveConfig} pipeline so `hyperframes doctor` (and any
 * other diagnostic surface) can report the exact same effective value the
 * renderer will use — including whether the user has explicitly disabled the
 * cache via `off`/`none`/`false`/`0`.
 *
 * - `dir: string` + `disabled: false`  → renderer will use this directory.
 *   `source` reports whether the value came from the env or the OS default.
 * - `dir: undefined` + `disabled: true` → user explicitly turned caching off;
 *   frames extract into the per-render workDir (auto-cleaned when the render
 *   ends). `rawValue` carries the exact string the user set.
 */
export type ExtractCacheDirResolution =
  | { dir: string; disabled: false; source: "env" | "default"; rawValue?: string }
  | { dir: undefined; disabled: true; source: "env"; rawValue: string };

/**
 * Env-var values that disable the extract cache entirely. Case-insensitive;
 * whitespace-trimmed. Kept as an exported constant so the CLI can echo the
 * accepted alias set in `--frames-cache-dir` help text without drift.
 */
export const EXTRACT_CACHE_DIR_DISABLED_ALIASES: readonly string[] = ["off", "none", "false", "0"];

/**
 * Compute the default extract-cache directory when the user has NOT set
 * `HYPERFRAMES_EXTRACT_CACHE_DIR`. Exported so downstream tests can reproduce
 * the exact path without duplicating the uid-suffix idiom.
 */
export function defaultExtractCacheDir(): string {
  return join(tmpdir(), `hyperframes-extract-cache-${process.getuid?.() ?? "u"}`);
}

/**
 * Resolve the extract-cache directory from an environment (defaults to
 * `process.env`). Mirrors the internal helper used by {@link resolveConfig},
 * but returns a rich resolution object so callers can distinguish "disabled by
 * user" from "default location" without re-parsing the env value.
 *
 * See {@link ExtractCacheDirResolution} for the shape and its two states.
 */
export function resolveExtractCacheDir(
  env: Record<string, string | undefined> = process.env,
): ExtractCacheDirResolution {
  const raw = env["HYPERFRAMES_EXTRACT_CACHE_DIR"];
  if (raw === undefined) {
    return { dir: defaultExtractCacheDir(), disabled: false, source: "default" };
  }
  const normalized = raw.trim().toLowerCase();
  if (EXTRACT_CACHE_DIR_DISABLED_ALIASES.includes(normalized)) {
    return { dir: undefined, disabled: true, source: "env", rawValue: raw };
  }
  return { dir: raw, disabled: false, source: "env", rawValue: raw };
}

function resolveExtractCacheDirFromEnv(
  env: (key: string) => string | undefined,
): string | undefined {
  const raw = env("HYPERFRAMES_EXTRACT_CACHE_DIR");
  return resolveExtractCacheDir(raw === undefined ? {} : { HYPERFRAMES_EXTRACT_CACHE_DIR: raw })
    .dir;
}

function memoryAdaptiveCacheLimit(): number {
  const total = getSystemTotalMb();
  if (total < 4096) return 32;
  if (total <= LOW_MEMORY_TOTAL_MB_THRESHOLD) return 64;
  return DEFAULT_CONFIG.frameDataUriCacheLimit;
}

function memoryAdaptiveCacheBytesMb(): number {
  const total = getSystemTotalMb();
  if (total < 4096) return 128;
  if (total <= LOW_MEMORY_TOTAL_MB_THRESHOLD) return 256;
  return DEFAULT_CONFIG.frameDataUriCacheBytesLimitMb;
}

/**
 * Resolve configuration by merging: defaults ← env vars ← explicit overrides.
 * Env vars provide backward compatibility during migration; explicit config
 * takes precedence over everything.
 */
export function resolveConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  const env = (key: string): string | undefined => process.env[key];
  const envNum = (key: string, fallback: number): number => {
    const raw = env(key);
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const envBool = (key: string, fallback: boolean): boolean => {
    const raw = env(key);
    if (raw === undefined) return fallback;
    return raw === "true";
  };
  const envVp9CpuUsed = (): number => {
    const raw = env("PRODUCER_VP9_CPU_USED");
    if (raw === undefined || raw === "") return DEFAULT_CONFIG.vp9CpuUsed;
    return normalizeVp9CpuUsed(Number(raw));
  };
  const envBrowserGpuMode = (): EngineConfig["browserGpuMode"] => {
    const raw = env("PRODUCER_BROWSER_GPU_MODE");
    if (raw === "hardware" || raw === "software" || raw === "auto") return raw;
    return DEFAULT_CONFIG.browserGpuMode;
  };
  // Tri-state: explicit on/off via env, otherwise auto-detect from total RAM.
  const resolveLowMemoryMode = (): boolean => {
    const raw = env("PRODUCER_LOW_MEMORY_MODE")?.toLowerCase();
    if (raw === "true" || raw === "on" || raw === "1") return true;
    if (raw === "false" || raw === "off" || raw === "0") return false;
    return isLowMemorySystem();
  };
  // Opt-OUT: default ON, disabled only by an explicit falsey value.
  const resolveStaticFrameDedup = (): boolean => {
    const raw = env("HF_STATIC_DEDUP")?.trim().toLowerCase();
    return !(raw === "false" || raw === "off" || raw === "0");
  };

  // Env-var layer (backward compat)
  const fromEnv: Partial<EngineConfig> = {
    concurrency: env("PRODUCER_MAX_WORKERS") ? Number(env("PRODUCER_MAX_WORKERS")) : undefined,
    coresPerWorker: envNum("PRODUCER_CORES_PER_WORKER", DEFAULT_CONFIG.coresPerWorker),
    minParallelFrames: envNum("PRODUCER_MIN_PARALLEL_FRAMES", DEFAULT_CONFIG.minParallelFrames),
    largeRenderThreshold: envNum(
      "PRODUCER_LARGE_RENDER_THRESHOLD",
      DEFAULT_CONFIG.largeRenderThreshold,
    ),

    chromePath: env("PRODUCER_HEADLESS_SHELL_PATH"),
    disableGpu: envBool("PRODUCER_DISABLE_GPU", DEFAULT_CONFIG.disableGpu),
    browserGpuMode: envBrowserGpuMode(),
    enableBrowserPool: envBool("PRODUCER_ENABLE_BROWSER_POOL", DEFAULT_CONFIG.enableBrowserPool),
    browserTimeout: envNum("PRODUCER_PUPPETEER_LAUNCH_TIMEOUT_MS", DEFAULT_CONFIG.browserTimeout),
    protocolTimeout: envNum(
      "PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS",
      DEFAULT_CONFIG.protocolTimeout,
    ),
    expectedChromiumMajor: env("PRODUCER_EXPECTED_CHROMIUM_MAJOR")
      ? Number(env("PRODUCER_EXPECTED_CHROMIUM_MAJOR"))
      : undefined,

    forceScreenshot: envBool("PRODUCER_FORCE_SCREENSHOT", DEFAULT_CONFIG.forceScreenshot),
    staticFrameDedup: resolveStaticFrameDedup(),
    useDrawElement: envBool("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", DEFAULT_CONFIG.useDrawElement),
    enableDrawElementWorkerEncode: envBool(
      "HF_DE_WORKER_ENCODE",
      DEFAULT_CONFIG.enableDrawElementWorkerEncode,
    ),
    lowMemoryMode: resolveLowMemoryMode(),
    enablePageSideCompositing: envBool(
      "HF_PAGE_SIDE_COMPOSITING",
      DEFAULT_CONFIG.enablePageSideCompositing,
    ),

    vp9CpuUsed: envVp9CpuUsed(),
    enableChunkedEncode: envBool(
      "PRODUCER_ENABLE_CHUNKED_ENCODE",
      DEFAULT_CONFIG.enableChunkedEncode,
    ),
    chunkSizeFrames: Math.max(
      120,
      envNum("PRODUCER_CHUNK_SIZE_FRAMES", DEFAULT_CONFIG.chunkSizeFrames),
    ),
    enableStreamingEncode: envBool(
      "PRODUCER_ENABLE_STREAMING_ENCODE",
      DEFAULT_CONFIG.enableStreamingEncode,
    ),
    streamingEncodeMaxDurationSeconds: Math.max(
      0,
      envNum(
        "PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS",
        DEFAULT_CONFIG.streamingEncodeMaxDurationSeconds,
      ),
    ),

    ffmpegEncodeTimeout: envNum("FFMPEG_ENCODE_TIMEOUT_MS", DEFAULT_CONFIG.ffmpegEncodeTimeout),
    ffmpegProcessTimeout: envNum("FFMPEG_PROCESS_TIMEOUT_MS", DEFAULT_CONFIG.ffmpegProcessTimeout),
    ffmpegStreamingTimeout: envNum(
      "FFMPEG_STREAMING_TIMEOUT_MS",
      DEFAULT_CONFIG.ffmpegStreamingTimeout,
    ),

    hdr: (() => {
      const raw = env("PRODUCER_HDR_TRANSFER");
      if (raw === "hlg" || raw === "pq") return { transfer: raw };
      return false;
    })(),
    hdrAutoDetect: envBool("PRODUCER_HDR_AUTO_DETECT", DEFAULT_CONFIG.hdrAutoDetect),

    audioGain: envNum("PRODUCER_AUDIO_GAIN", DEFAULT_CONFIG.audioGain),
    frameDataUriCacheLimit: Math.max(
      32,
      envNum("PRODUCER_FRAME_DATA_URI_CACHE_LIMIT", memoryAdaptiveCacheLimit()),
    ),
    frameDataUriCacheBytesLimitMb: Math.max(
      64,
      envNum("PRODUCER_FRAME_DATA_URI_CACHE_BYTES_MB", memoryAdaptiveCacheBytesMb()),
    ),

    playerReadyTimeout: envNum(
      "PRODUCER_PLAYER_READY_TIMEOUT_MS",
      DEFAULT_CONFIG.playerReadyTimeout,
    ),
    renderReadyTimeout: envNum(
      "PRODUCER_RENDER_READY_TIMEOUT_MS",
      DEFAULT_CONFIG.renderReadyTimeout,
    ),
    pageNavigationTimeout: envNum(
      "PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS",
      DEFAULT_CONFIG.pageNavigationTimeout,
    ),

    verifyRuntime: env("PRODUCER_VERIFY_HYPERFRAME_RUNTIME") !== "false",
    runtimeManifestPath: env("PRODUCER_HYPERFRAME_MANIFEST_PATH"),

    extractCacheDir: resolveExtractCacheDirFromEnv(env),
    extractCacheMaxBytes:
      envNum("HYPERFRAMES_EXTRACT_CACHE_MAX_MB", DEFAULT_CONFIG.extractCacheMaxBytes / 1024 ** 2) *
      1024 ** 2,
  };

  // Remove undefined values so they don't override defaults
  const cleanEnv = Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined));

  const merged = {
    ...DEFAULT_CONFIG,
    ...cleanEnv,
    ...overrides,
  };

  // Default-on drawElement is clamped to hosts where it can actually engage
  // (macOS with a non-software-GPU browser; SwiftShader drops transparent
  // sub-layers — crbug 521434899). "auto" passes the clamp: the stock CLI
  // resolves GPU mode to auto, which probes to hardware on real Macs — and if
  // it resolves to software after all, the SwiftShader init-time gate still
  // routes the session to the screenshot baseline. Without the clamp, the
  // default would needlessly disable page-side shader compositing (below) on
  // Linux/Docker hosts where DE never runs. An EXPLICIT opt-in (env or caller override)
  // skips the clamp and keeps the old semantics — attempt DE, let the
  // init-time gates route away — which debugging relies on.
  const explicitDrawElementOptIn =
    env("PRODUCER_EXPERIMENTAL_FAST_CAPTURE") === "true" || overrides?.useDrawElement === true;
  if (
    merged.useDrawElement &&
    !explicitDrawElementOptIn &&
    !(process.platform === "darwin" && merged.browserGpuMode !== "software")
  ) {
    merged.useDrawElement = false;
  }
  // The runtime self-verification net lives in the worker-encode drain — the
  // serial drawElement path has only the blank guard. Default-on drawElement
  // therefore requires worker-encode; disabling HF_DE_WORKER_ENCODE without an
  // explicit drawElement opt-in falls back to the screenshot baseline rather
  // than shipping unverified drawElement frames.
  if (merged.useDrawElement && !explicitDrawElementOptIn && !merged.enableDrawElementWorkerEncode) {
    merged.useDrawElement = false;
  }

  // Software GPU implies screenshot capture.
  //
  // Two existing platform gates already do most of the work: `browserManager`
  // only launches BeginFrame on Linux + chrome-headless-shell + !forceScreenshot,
  // and the DE clamp above turns off `useDrawElement` on non-(darwin +
  // non-software) hosts. Setting `forceScreenshot` here layers defense-in-depth
  // on top:
  //
  //   1. Linux + software (SwiftShader host): kicks the browser off BeginFrame,
  //      which stalls the compositor on shader-heavy frames under CPU raster
  //      (same motivation as the closed PR #822).
  //   2. Observability truth: `renderOrchestrator`'s reported `captureMode`
  //      field is derived from `cfg.forceScreenshot ? "screenshot" : "beginframe"`
  //      — without this clamp it misreports `"beginframe"` for the actual
  //      screenshot capture on darwin + software.
  //   3. Future-proofing: any new BeginFrame or drawElement entry point that
  //      forgets to gate on GPU mode still routes to screenshot here.
  //
  // Note this does NOT eliminate SwiftShader-on-darwin text-rasterization
  // artifacts (an ANGLE-SwiftShader issue on macOS text — the fix there is to
  // use `--browser-gpu`, which routes to `--use-angle=metal`). It only makes
  // routing consistent + observability accurate.
  //
  // Explicit opt-out (env or programmatic override) is honored so BeginFrame-
  // on-software debugging remains possible.
  const explicitForceScreenshotOptOut =
    env("PRODUCER_FORCE_SCREENSHOT") === "false" || overrides?.forceScreenshot === false;
  // Persist provenance so the concrete-resolved-GPU helper can honor the
  // programmatic opt-out too — at that point `forceScreenshot === false` is
  // otherwise ambiguous between default and explicit opt-out.
  if (explicitForceScreenshotOptOut) {
    merged.forceScreenshotExplicitlyOptedOut = true;
  }
  if (
    merged.browserGpuMode === "software" &&
    !merged.forceScreenshot &&
    !explicitForceScreenshotOptOut
  ) {
    merged.forceScreenshot = true;
  }

  // Windows software-GPU compound auto-disable for streaming-encode.
  //
  // Field signal ts=1784131903 (win32/x64, CLI 0.7.58, 156s UI-heavy):
  // stable ONLY with FOUR flags — `--workers 1 --no-browser-gpu
  // --low-memory-mode` + `PRODUCER_ENABLE_STREAMING_ENCODE=false`. Since
  // `--no-browser-gpu` and `--low-memory-mode` already imply screenshot
  // capture, three of the four flags are structurally coupled: auto-detect
  // the compound and disable streaming-encode on the caller's behalf.
  //
  // Explicit user intent wins: if `PRODUCER_ENABLE_STREAMING_ENCODE` env
  // is set to any value OR the caller passed `overrides.enableStreamingEncode`,
  // this clamp is a no-op (the user's explicit choice — including
  // `PRODUCER_ENABLE_STREAMING_ENCODE=true` — is preserved).
  //
  // Composition duration is not known at the config-resolution layer
  // (the composition is parsed downstream of `resolveConfig`), so this
  // wire-up passes `compositionDurationSec: undefined` and the helper
  // reduces to the three-condition compound. Trade-off documented in the
  // helper's JSDoc and the PR body: false positives possible for short
  // Windows software-GPU single-worker renders; the explicit opt-in
  // escape hatch is the mitigation.
  const streamingEncodeUserExplicitlySet =
    env("PRODUCER_ENABLE_STREAMING_ENCODE") !== undefined ||
    overrides?.enableStreamingEncode !== undefined;
  const softwareGpuForced =
    merged.browserGpuMode === "software" || merged.disableGpu || merged.lowMemoryMode;
  const resolvedWorkers = typeof merged.concurrency === "number" ? merged.concurrency : NaN;
  if (
    merged.enableStreamingEncode &&
    shouldAutoDisableStreamingEncodeOnWin32Compound({
      platform: process.platform,
      softwareGpuForced,
      workers: resolvedWorkers,
      compositionDurationSec: undefined,
      userExplicitlySet: streamingEncodeUserExplicitlySet,
    })
  ) {
    merged.enableStreamingEncode = false;
    merged.streamingEncodeAutoDisabledOnWin32Compound = true;
    console.error(
      "[hyperframes] Windows compound-workaround auto-detected — disabling streaming-encode " +
        "(platform=win32, software-GPU forced, workers=1). Field signal ts=1784131903. " +
        "Override: PRODUCER_ENABLE_STREAMING_ENCODE=true.",
    );
  }

  // drawElement capture and page-side shader compositing are mutually
  // incompatible capture strategies (drawElement reads paint records directly
  // and bypasses the page-side prepare→composite→resolve protocol). When
  // fast capture is on, force page-side compositing off so shader
  // transitions fall back to the Node-side layered blend rather than silently
  // dropping. This keeps the flag self-consistent and avoids a per-session
  // incompatibility warning on every fast-capture render.
  if (merged.useDrawElement && merged.enablePageSideCompositing) {
    merged.enablePageSideCompositing = false;
    // Record that THIS resolution (not the caller) turned page-side
    // compositing off, so a later compile-time drawElement gate can restore
    // it without clobbering an explicit enablePageSideCompositing:false from
    // the programmatic API or HF_PAGE_SIDE_COMPOSITING=false.
    merged.pageSideCompositingAutoDisabled = true;
  }

  return {
    ...merged,
    vp9CpuUsed: normalizeVp9CpuUsed(merged.vp9CpuUsed),
  };
}

/**
 * Runtime-resolved companion to the software-GPU screenshot clamp in
 * `resolveConfig`. Returns `true` iff callers should treat this render as
 * `forceScreenshot=true` even though the config's stored `forceScreenshot`
 * is `false`. Fires when the concrete resolved GPU is software AND neither
 * the env opt-out (`PRODUCER_FORCE_SCREENSHOT=false`) nor the programmatic
 * opt-out (`overrides.forceScreenshot === false`, carried via
 * `cfg.forceScreenshotExplicitlyOptedOut`) is set.
 *
 * `resolveConfig`'s clamp only sees `browserGpuMode` as a string, so
 * `"auto"` that runtime-probes to software slips through. This helper
 * closes that gap at the concrete-resolution points (`frameCapture` and
 * `renderOrchestrator`). Same invariant, same escape hatches, one predicate.
 *
 * Callers should skip when the invariant is already satisfied
 * (`currentForceScreenshot === true`) to avoid redundant work. Pass
 * `cfg.forceScreenshotExplicitlyOptedOut` via `opts.programmaticOptOut` so
 * the `browserGpuMode:"auto"` → software probe path honors the same
 * programmatic escape hatch as literal `browserGpuMode:"software"`.
 */
export function shouldClampToScreenshotForConcreteGpu(
  resolvedGpuMode: "software" | "hardware",
  currentForceScreenshot: boolean,
  env: NodeJS.ProcessEnv = process.env,
  opts: { programmaticOptOut?: boolean } = {},
): boolean {
  if (currentForceScreenshot) return false;
  if (resolvedGpuMode !== "software") return false;
  if (opts.programmaticOptOut) return false;
  return env["PRODUCER_FORCE_SCREENSHOT"] !== "false";
}

/**
 * Caller-facing pair to `shouldClampToScreenshotForConcreteGpu`: computes the
 * value the *authoritative* `forceScreenshot` local should hold after the
 * concrete-resolved-GPU decision fires. Returns the (possibly-promoted) new
 * boolean, so the caller can assign it back to its local — driving both
 * routing AND telemetry from one source of truth.
 *
 * Reads the programmatic opt-out from `cfg.forceScreenshotExplicitlyOptedOut`
 * (set by `resolveConfig` when EITHER env `PRODUCER_FORCE_SCREENSHOT=false`
 * OR programmatic `overrides.forceScreenshot === false` was present).
 *
 * Idempotent: `applyConcreteGpuScreenshotClamp(true, ...)` returns `true`
 * without consulting anything else.
 */
export function applyConcreteGpuScreenshotClamp(
  currentForceScreenshot: boolean,
  resolvedGpuMode: "software" | "hardware",
  cfg: Pick<EngineConfig, "forceScreenshotExplicitlyOptedOut"> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    currentForceScreenshot ||
    shouldClampToScreenshotForConcreteGpu(resolvedGpuMode, currentForceScreenshot, env, {
      programmaticOptOut: cfg?.forceScreenshotExplicitlyOptedOut ?? false,
    })
  );
}
