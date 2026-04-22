/**
 * Engine Configuration
 *
 * Typed configuration for the rendering pipeline. Replaces the PRODUCER_*
 * env var sprawl with a structured interface. Env vars still work as
 * fallbacks for backward compatibility during migration.
 */

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
  enableBrowserPool: boolean;
  browserTimeout: number;
  protocolTimeout: number;
  /** Expected Chromium major version (optional validation). */
  expectedChromiumMajor?: number;
  /** Force screenshot capture mode (skip BeginFrame even on Linux). */
  forceScreenshot: boolean;

  // ── Encoding ─────────────────────────────────────────────────────────
  enableChunkedEncode: boolean;
  chunkSizeFrames: number;
  enableStreamingEncode: boolean;

  // ── FFmpeg timeouts ──────────────────────────────────────────────────
  /** Timeout for FFmpeg frame encoding (ms). Default: 600_000 */
  ffmpegEncodeTimeout: number;
  /** Timeout for FFmpeg mux/faststart processes (ms). Default: 300_000 */
  ffmpegProcessTimeout: number;
  /** Timeout for FFmpeg streaming encode (ms). Default: 600_000 */
  ffmpegStreamingTimeout: number;

  // ── HDR ──────────────────────────────────────────────────────────────
  /** HDR output transfer function. false = SDR output (default). */
  hdr: { transfer: "hlg" | "pq" } | false;
  /** Auto-detect HDR from video sources when hdr is not explicitly set. */
  hdrAutoDetect: boolean;

  // ── Media ────────────────────────────────────────────────────────────
  audioGain: number;
  frameDataUriCacheLimit: number;

  // ── Timeouts ─────────────────────────────────────────────────────────
  playerReadyTimeout: number;
  renderReadyTimeout: number;

  // ── Runtime ──────────────────────────────────────────────────────────
  /** Verify Hyperframe runtime SHA256 checksums. */
  verifyRuntime: boolean;
  /** Custom manifest path for Hyperframe runtime. */
  runtimeManifestPath?: string;

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
  enableBrowserPool: false,
  browserTimeout: 120_000,
  protocolTimeout: 300_000,
  forceScreenshot: false,

  enableChunkedEncode: false,
  chunkSizeFrames: 360,
  enableStreamingEncode: false,

  ffmpegEncodeTimeout: 600_000,
  ffmpegProcessTimeout: 300_000,
  ffmpegStreamingTimeout: 600_000,

  hdr: false,
  hdrAutoDetect: true,

  audioGain: 1,
  frameDataUriCacheLimit: 256,

  playerReadyTimeout: 45_000,
  renderReadyTimeout: 15_000,

  verifyRuntime: true,

  debug: false,
};

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

    ffmpegEncodeTimeout: envNum("FFMPEG_ENCODE_TIMEOUT_MS", DEFAULT_CONFIG.ffmpegEncodeTimeout),
    ffmpegProcessTimeout: envNum("FFMPEG_PROCESS_TIMEOUT_MS", DEFAULT_CONFIG.ffmpegProcessTimeout),
    ffmpegStreamingTimeout: envNum(
      "FFMPEG_STREAMING_TIMEOUT_MS",
      DEFAULT_CONFIG.ffmpegStreamingTimeout,
    ),

    hdr: (() => {
      const raw = env("PRODUCER_HDR_TRANSFER");
      if (raw === "hlg" || raw === "pq") return { transfer: raw };
      return undefined;
    })(),
    hdrAutoDetect: envBool("PRODUCER_HDR_AUTO_DETECT", DEFAULT_CONFIG.hdrAutoDetect),

    audioGain: envNum("PRODUCER_AUDIO_GAIN", DEFAULT_CONFIG.audioGain),
    frameDataUriCacheLimit: Math.max(
      32,
      envNum("PRODUCER_FRAME_DATA_URI_CACHE_LIMIT", DEFAULT_CONFIG.frameDataUriCacheLimit),
    ),

    playerReadyTimeout: envNum(
      "PRODUCER_PLAYER_READY_TIMEOUT_MS",
      DEFAULT_CONFIG.playerReadyTimeout,
    ),
    renderReadyTimeout: envNum(
      "PRODUCER_RENDER_READY_TIMEOUT_MS",
      DEFAULT_CONFIG.renderReadyTimeout,
    ),

    verifyRuntime: env("PRODUCER_VERIFY_HYPERFRAME_RUNTIME") !== "false",
    runtimeManifestPath: env("PRODUCER_HYPERFRAME_MANIFEST_PATH"),
  };

  // Remove undefined values so they don't override defaults
  const cleanEnv = Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined));

  return {
    ...DEFAULT_CONFIG,
    ...cleanEnv,
    ...overrides,
  };
}
