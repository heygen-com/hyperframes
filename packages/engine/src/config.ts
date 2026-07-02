/**
 * Engine Configuration
 *
 * Typed configuration for the rendering pipeline. Replaces the PRODUCER_*
 * env var sprawl with a structured interface. Env vars still work as
 * fallbacks for backward compatibility during migration.
 */

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
   * Undefined disables caching — extraction runs into the render's workDir
   * and cleanup removes it when the render ends, preserving the pre-cache
   * behaviour.
   *
   * **Single-writer.** The cache is not safe for concurrent renders pointing
   * at the same directory. A `.hf-complete` sentinel prevents another render
   * from serving an entry that hasn't finished extracting, but individual
   * frame files are written non-atomically — a second render reading during
   * the write window can observe a truncated frame. Give each concurrent
   * render pipeline its own `extractCacheDir`, or gate with an external mutex.
   *
   * **Network filesystems.** `mtime` resolution on NFS/SMB mounts can be
   * coarser than expected (seconds rather than nanoseconds), which may
   * produce spurious cache hits if a source file is overwritten within the
   * same mtime tick. Local filesystems are the intended deployment target.
   *
   * Env fallback: `HYPERFRAMES_EXTRACT_CACHE_DIR`.
   */
  extractCacheDir?: string;

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

  debug: false,
};

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

    extractCacheDir: env("HYPERFRAMES_EXTRACT_CACHE_DIR"),
  };

  // Remove undefined values so they don't override defaults
  const cleanEnv = Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined));

  const merged = {
    ...DEFAULT_CONFIG,
    ...cleanEnv,
    ...overrides,
  };
  return {
    ...merged,
    vp9CpuUsed: normalizeVp9CpuUsed(merged.vp9CpuUsed),
  };
}
