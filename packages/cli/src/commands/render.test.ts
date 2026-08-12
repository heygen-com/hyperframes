// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const producerState = vi.hoisted(() => ({
  createdJobs: [] as Array<Record<string, unknown>>,
  resolveConfigCalls: [] as Array<Record<string, unknown>>,
  // Overridable per-test hook so the DE-parallel-router-trial tests can
  // mutate the job (perfSummary/errorDetails) or throw, without perturbing
  // every other test in this file that expects a plain no-op resolve.
  executeImpl: async (_job: Record<string, unknown>): Promise<void> => undefined,
}));

// Defaults to "trial already fired" so the pre-existing renderLocal tests
// below (which predate the DE-parallel-router trial and don't expect
// HF_DE_PARALLEL_ROUTER to be touched) keep their exact prior behavior.
//
// `disk` is the authoritative "file"; `cache` models config.ts's real
// process-lifetime cachedConfig. Modeling them SEPARATELY matters: a mock
// where readConfig/readConfigFresh both read one live object hides exactly
// the class of bug where production code reads the stale cache when it
// needed a fresh disk read (review finding). `failWrites` simulates the
// real writeConfig's silent fs-error swallowing (unwritable ~/.hyperframes):
// the next N writes are recorded but never reach `disk`.
const configState = vi.hoisted(
  (): {
    disk: Record<string, unknown>;
    cache: Record<string, unknown> | null;
    writeConfigCalls: Array<Record<string, unknown>>;
    failWrites: number;
    /** Config write lands but the install-state mirror does not. */
    failMirrors: number;
  } => ({
    disk: { telemetryEnabled: true, deParallelRouterTrialFired: true },
    cache: null,
    writeConfigCalls: [],
    failWrites: 0,
    failMirrors: 0,
  }),
);

const trackingState = vi.hoisted(() => ({
  // maybeEnableDeParallelRouterTrial gates on the real shouldTrack(), which
  // (via isDevMode()) always returns false when this file itself runs as
  // `.ts` source under vitest — mocked here so the CLI-trial tests can
  // control it directly instead of inheriting that environment quirk.
  shouldTrack: true,
  renderObservations: [] as Array<Record<string, unknown>>,
}));

const preflightState = vi.hoisted(() => ({
  result: {
    outcomes: [
      { name: "FFmpeg", ok: true, level: "ok", detail: "/usr/bin/ffmpeg", path: "/usr/bin/ffmpeg" },
      {
        name: "FFprobe",
        ok: true,
        level: "ok",
        detail: "/usr/bin/ffprobe",
        path: "/usr/bin/ffprobe",
      },
      {
        name: "Chrome",
        ok: true,
        level: "ok",
        detail: "cache: /mock/chrome",
        path: "/mock/chrome",
      },
    ],
    ffmpegPath: "/usr/bin/ffmpeg",
    ffprobePath: "/usr/bin/ffprobe",
    browser: { executablePath: "/mock/chrome", source: "cache" },
  },
}));

const ffmpegEncoderState = vi.hoisted(() => ({
  mode: "software" as "software" | "gpu",
  error: null as Error | null,
}));
const orphanCleanupState = vi.hoisted(() => ({
  calls: 0,
  killed: 0,
}));

vi.mock("../utils/producer.js", () => ({
  loadProducer: vi.fn(async () => ({
    resolveConfig: vi.fn((overrides: Record<string, unknown>) => {
      producerState.resolveConfigCalls.push(overrides);
      return { ...overrides, resolved: true };
    }),
    createRenderRequest: vi.fn(
      (input: {
        projectDir: string;
        outputPath: string;
        engineConfig: unknown;
        options: object;
      }) => ({
        version: 1,
        projectDir: input.projectDir,
        outputPath: input.outputPath,
        options: { ...input.options, engineConfig: input.engineConfig },
      }),
    ),
    renderConfigFromRequest: vi.fn(
      (request: { options: Record<string, unknown> }, runtime: { logger?: unknown }) => {
        const { engineConfig, ...options } = request.options;
        return { ...options, producerConfig: engineConfig, logger: runtime.logger };
      },
    ),
    createRenderJob: vi.fn((config: Record<string, unknown>) => {
      producerState.createdJobs.push(config);
      return { config, progress: 100, outcome: "completed", warnings: [] };
    }),
    executeRenderJob: vi.fn(async (job: Record<string, unknown>) => producerState.executeImpl(job)),
  })),
}));

vi.mock("../telemetry/config.js", () => ({
  readConfig: vi.fn(() => {
    if (!configState.cache) configState.cache = { ...configState.disk };
    return { ...configState.cache };
  }),
  readConfigFresh: vi.fn(() => {
    configState.cache = { ...configState.disk };
    return { ...configState.disk };
  }),
  recordRecentRender: vi.fn((id: string, ok: boolean) => {
    // Mirrors the real ring update (readConfigFresh → append, cap 5 → write)
    // against the mock's disk state, so a render's recent-renders write is
    // modeled like every other config mutation here. Fixed timestamp keeps it
    // deterministic (tests never assert on `at`).
    const disk = configState.disk as Record<string, unknown>;
    const ring = [
      ...((disk.recentRenders as unknown[]) ?? []),
      { id, at: "2026-01-01T00:00:00Z", ok },
    ];
    const next = { ...disk, recentRenders: ring.slice(-5) };
    configState.disk = next;
    configState.cache = { ...next };
  }),
  writeConfig: vi.fn((config: Record<string, unknown>) => {
    configState.writeConfigCalls.push({ ...config });
    if (configState.failWrites > 0) {
      configState.failWrites--;
      return false; // swallowed silently, like the real writeConfig's catch {}
    }
    configState.disk = { ...config };
    configState.cache = { ...config };
    return true;
  }),
  // The breaker's safety path uses this rather than writeConfig, so it can
  // see a mirror failure instead of having it collapsed into `true`.
  writeConfigWithResult: vi.fn((config: Record<string, unknown>) => {
    configState.writeConfigCalls.push({ ...config });
    if (configState.failWrites > 0) {
      configState.failWrites--;
      return { ok: false, error: "mock write failure" };
    }
    configState.disk = { ...config };
    configState.cache = { ...config };
    if (configState.failMirrors > 0) {
      configState.failMirrors--;
      return { ok: true, mirrored: false };
    }
    return { ok: true };
  }),
}));

vi.mock("../telemetry/client.js", () => ({
  shouldTrack: vi.fn(() => trackingState.shouldTrack),
}));

vi.mock("../telemetry/events.js", () => ({
  trackRenderComplete: vi.fn(),
  trackRenderError: vi.fn(),
  trackRenderObservation: vi.fn((props: Record<string, unknown>) => {
    trackingState.renderObservations.push(props);
  }),
}));

vi.mock("../browser/ffmpeg.js", () => ({
  detectH264EncoderMode: vi.fn(() => {
    if (ffmpegEncoderState.error) throw ffmpegEncoderState.error;
    return ffmpegEncoderState.mode;
  }),
  findFFmpeg: vi.fn(() => "/usr/bin/ffmpeg"),
  getFFmpegInstallHint: vi.fn(() => "brew install ffmpeg"),
}));

vi.mock("../browser/preflight.js", () => ({
  runEnvironmentChecks: vi.fn(async () => preflightState.result),
}));

vi.mock("../utils/orphanCleanup.js", () => ({
  killOrphanedProcesses: vi.fn(() => {
    orphanCleanupState.calls += 1;
    return orphanCleanupState.killed;
  }),
}));

// Collect the heavy render module once, after Vitest has hoisted the mocks
// above. Keeping this import out of a hook means parallel monorepo contention
// cannot turn module collection into a `beforeAll` timeout.
const renderModule = await import("./render.js");

describe("renderLocal browser GPU config", () => {
  const savedEnv = new Map<string, string | undefined>();
  const {
    renderLocal,
    resolveBrowserGpuForCli,
    renderLintContinuationHint,
    __resetDeParallelRouterTrialStateForTests: resetTrialState,
  } = renderModule;

  it("points strict warning-only renders to --strict-all", () => {
    expect(renderLintContinuationHint(true)).toContain("--strict-all");
    expect(renderLintContinuationHint(true)).not.toContain("Use --strict to block");
  });

  it("points non-strict renders to --strict for lint errors", () => {
    expect(renderLintContinuationHint(false)).toContain("Use --strict to block errors");
  });

  function setEnv(key: string, value: string) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  beforeEach(() => {
    producerState.createdJobs = [];
    producerState.resolveConfigCalls = [];
    producerState.executeImpl = async () => undefined;
    configState.disk = { telemetryEnabled: true, deParallelRouterTrialFired: true };
    configState.cache = null;
    configState.failWrites = 0;
    configState.failMirrors = 0;
    configState.writeConfigCalls = [];
    trackingState.shouldTrack = true;
    trackingState.renderObservations = [];
    ffmpegEncoderState.mode = "software";
    ffmpegEncoderState.error = null;
    orphanCleanupState.calls = 0;
    orphanCleanupState.killed = 0;
    resetTrialState();
    savedEnv.clear();
    savedEnv.set("HYPERFRAMES_FFMPEG_PATH", process.env.HYPERFRAMES_FFMPEG_PATH);
    savedEnv.set("HYPERFRAMES_FFPROBE_PATH", process.env.HYPERFRAMES_FFPROBE_PATH);
    savedEnv.set("PRODUCER_HEADLESS_SHELL_PATH", process.env.PRODUCER_HEADLESS_SHELL_PATH);
    savedEnv.set("HF_DE_PARALLEL_ROUTER", process.env.HF_DE_PARALLEL_ROUTER);
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    delete process.env.HYPERFRAMES_FFPROBE_PATH;
    delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
    delete process.env.HF_DE_PARALLEL_ROUTER;
  });

  it("cleans orphaned browser trees before starting a local render", async () => {
    orphanCleanupState.killed = 1;

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(orphanCleanupState.calls).toBe(1);
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("passes an explicit software override for --no-browser-gpu even when env requests hardware", async () => {
    setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.resolveConfigCalls).toContainEqual({ browserGpuMode: "software" });
    expect(producerState.createdJobs[0]?.producerConfig).toMatchObject({
      browserGpuMode: "software",
      resolved: true,
    });
  }, 15_000);

  it("forwards render stage start and end lifecycle events to telemetry", async () => {
    producerState.executeImpl = async (job) => {
      const logger = (job.config as { logger: { info: (message: string, meta: object) => void } })
        .logger;
      logger.info("[Render:trace]", {
        renderJobId: "render-lifecycle",
        phase: "capture_streaming",
        status: "start",
        elapsedMs: 100,
        workerCount: 1,
        captureMode: "screenshot",
        captureOperation: "captureScreenshot",
        framesCompleted: 12,
        totalFrames: 900,
      });
      logger.info("[Render:trace]", {
        renderJobId: "render-lifecycle",
        phase: "capture_streaming",
        status: "end",
        elapsedMs: 250,
        durationMs: 150,
      });
    };

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      skipFeedback: true,
    });

    expect(trackingState.renderObservations).toEqual([
      expect.objectContaining({
        renderJobId: "render-lifecycle",
        phase: "capture_streaming",
        status: "start",
        captureOperation: "captureScreenshot",
        framesCompleted: 12,
        totalFrames: 900,
      }),
      expect.objectContaining({
        renderJobId: "render-lifecycle",
        phase: "capture_streaming",
        status: "end",
        durationMs: 150,
      }),
    ]);
  });

  it("forwards browserGpuMode='auto' into producer config (probe-then-choose)", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "auto",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.resolveConfigCalls).toContainEqual({ browserGpuMode: "auto" });
    expect(producerState.createdJobs[0]?.producerConfig).toMatchObject({
      browserGpuMode: "auto",
      resolved: true,
    });
  });

  it("passes an explicit hardware override for default local browser GPU", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "hardware",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.resolveConfigCalls).toContainEqual({ browserGpuMode: "hardware" });
    expect(producerState.createdJobs[0]?.producerConfig).toMatchObject({
      browserGpuMode: "hardware",
      resolved: true,
    });
  });

  it("passes preflight-resolved FFmpeg, FFprobe, and browser paths through env", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(process.env.HYPERFRAMES_FFMPEG_PATH).toBe("/usr/bin/ffmpeg");
    expect(process.env.HYPERFRAMES_FFPROBE_PATH).toBe("/usr/bin/ffprobe");
    expect(process.env.PRODUCER_HEADLESS_SHELL_PATH).toBe("/mock/chrome");
  });

  it("falls back to hardware encoding when FFmpeg omits libx264", async () => {
    ffmpegEncoderState.mode = "gpu";

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "high",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "force-sdr",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.useGpu).toBe(true);
  });

  it("lets the encoder surface its own error when capability detection fails", async () => {
    ffmpegEncoderState.error = new Error("encoder probe timed out");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "high",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "force-sdr",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.useGpu).toBe(false);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("encoder probe timed out"));
  });

  it("diagnoses advisory encoder probe failures unless quiet", async () => {
    ffmpegEncoderState.error = new Error("encoder probe timed out");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "high",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "force-sdr",
      quiet: false,
    });

    expect(producerState.createdJobs[0]?.useGpu).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("encoder probe timed out"));
  });

  it("resolves browser GPU from CLI flags, Docker mode, and env fallback", () => {
    // Default (no flag, no env): auto — engine probes and chooses.
    expect(resolveBrowserGpuForCli(false, undefined, undefined)).toBe("auto");
    // Env override
    expect(resolveBrowserGpuForCli(false, undefined, "hardware")).toBe("hardware");
    expect(resolveBrowserGpuForCli(false, undefined, "software")).toBe("software");
    expect(resolveBrowserGpuForCli(false, undefined, "auto")).toBe("auto");
    // Explicit CLI flag wins over env
    expect(resolveBrowserGpuForCli(false, true, "software")).toBe("hardware");
    expect(resolveBrowserGpuForCli(false, false, "hardware")).toBe("software");
    // Docker forces software regardless of flags/env
    expect(resolveBrowserGpuForCli(true, undefined, "hardware")).toBe("software");
    expect(resolveBrowserGpuForCli(true, undefined, "auto")).toBe("software");
  });

  it("forwards parsed --variables payload to createRenderJob", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      variables: { title: "Hello", count: 3 },
    });

    expect(producerState.createdJobs[0]?.variables).toEqual({ title: "Hello", count: 3 });
  });

  it("forwards format: png-sequence through to createRenderJob", async () => {
    await renderLocal("/tmp/project", "/tmp/frames", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "png-sequence",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.format).toBe("png-sequence");
  });

  it("forwards format: gif and gifLoop through to createRenderJob", async () => {
    await renderLocal("/tmp/project", "/tmp/demo.gif", {
      fps: { num: 15, den: 1 },
      quality: "standard",
      format: "gif",
      gifLoop: 3,
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.format).toBe("gif");
    expect(producerState.createdJobs[0]?.gifLoop).toBe(3);
  });

  it("forwards videoFrameFormat to createRenderJob", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      videoFrameFormat: "png",
    });

    expect(producerState.createdJobs[0]?.videoFrameFormat).toBe("png");
  });

  it("forwards debug mode to createRenderJob", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      debug: true,
    });

    expect(producerState.createdJobs[0]?.debug).toBe(true);
  });

  it("defaults to best-effort readiness", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.strictness).toBe("best-effort");
  });

  it("forwards an explicit strict readiness opt-in", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      bestEffort: false,
    });

    expect(producerState.createdJobs[0]?.strictness).toBe("strict");
  });

  it("omits variables from createRenderJob when not provided", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.variables).toBeUndefined();
  });

  it("forwards entryFile to createRenderJob when --composition is set", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      entryFile: "compositions/intro.html",
    });

    expect(producerState.createdJobs[0]?.entryFile).toBe("compositions/intro.html");
  });

  it("omits entryFile from createRenderJob when --composition is not set", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.entryFile).toBeUndefined();
  });

  it("forwards --browser-timeout into resolveConfig as pageNavigationTimeout (ms)", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      pageNavigationTimeoutMs: 180_000,
    });

    expect(producerState.resolveConfigCalls[0]).toMatchObject({
      pageNavigationTimeout: 180_000,
    });
  });

  it("forwards vp9CpuUsed into resolveConfig when set", async () => {
    await renderLocal("/tmp/project", "/tmp/out.webm", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "webm",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      vp9CpuUsed: 2,
    });

    expect(producerState.resolveConfigCalls[0]).toMatchObject({
      vp9CpuUsed: 2,
    });
  });

  it("omits pageNavigationTimeout from resolveConfig when --browser-timeout is not set", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    // Issue #1199: when the flag is omitted, the engine's DEFAULT_CONFIG must
    // own the navigation timeout. Forwarding `undefined` would override
    // `pageNavigationTimeout: 60_000` to `undefined` and re-introduce the
    // bug in a different shape.
    expect(producerState.resolveConfigCalls[0]).not.toHaveProperty("pageNavigationTimeout");
  });

  it("forwards outputResolution to createRenderJob when --resolution is set", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
      outputResolution: "landscape-4k",
    });

    expect(producerState.createdJobs[0]?.outputResolution).toBe("landscape-4k");
  });

  it("omits outputResolution from createRenderJob by default", async () => {
    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "software",
      hdrMode: "auto",
      quiet: true,
    });

    expect(producerState.createdJobs[0]?.outputResolution).toBeUndefined();
  });

  it("requests a root-owned CLI exit after a successful local render", async () => {
    vi.useFakeTimers();
    const { consumeCommandResult } = await import("../utils/commandResult.js");
    consumeCommandResult();

    await renderLocal("/tmp/project", "/tmp/out.mp4", {
      fps: { num: 30, den: 1 },
      quality: "standard",
      format: "mp4",
      gpu: false,
      browserGpuMode: "hardware",
      hdrMode: "auto",
      quiet: true,
      exitAfterComplete: true,
    });

    vi.advanceTimersByTime(100);
    expect(consumeCommandResult().exitCode).toBe(0);
  });
});

// Suite renamed with the breaker work: this is no longer an opt-in trial. The
// bindings come from main's shared top-level `renderModule` import rather than
// this suite's own beforeAll — same module instance every other suite uses, so
// module-scope arm/consume state resets through the one `resetTrialState()`.
describe("renderLocal — DE parallel-router circuit breaker", () => {
  const { renderLocal, __resetDeParallelRouterTrialStateForTests: resetTrialState } = renderModule;
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    producerState.createdJobs = [];
    producerState.executeImpl = async () => undefined;
    configState.cache = null;
    configState.failWrites = 0;
    configState.writeConfigCalls = [];
    trackingState.shouldTrack = true;
    // The "managed by us" flag lives at module scope in render.ts (real CLI
    // processes only ever run one --batch sequence, so it never needs
    // resetting there) — reset explicitly here so tests don't leak arm/
    // consume state into each other via shared module instance + test order.
    resetTrialState();
    savedEnv.clear();
    savedEnv.set("HF_DE_PARALLEL_ROUTER", process.env.HF_DE_PARALLEL_ROUTER);
    savedEnv.set("HYPERFRAMES_FFMPEG_PATH", process.env.HYPERFRAMES_FFMPEG_PATH);
    savedEnv.set("HYPERFRAMES_FFPROBE_PATH", process.env.HYPERFRAMES_FFPROBE_PATH);
    savedEnv.set("PRODUCER_HEADLESS_SHELL_PATH", process.env.PRODUCER_HEADLESS_SHELL_PATH);
    delete process.env.HF_DE_PARALLEL_ROUTER;
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    delete process.env.HYPERFRAMES_FFPROBE_PATH;
    delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  const baseOptions = {
    fps: { num: 30, den: 1 },
    quality: "standard" as const,
    format: "mp4" as const,
    gpu: false,
    browserGpuMode: "software" as const,
    hdrMode: "auto" as const,
    quiet: true,
    // Breaker management is OPT-IN (review): only the CLI's own sequential
    // call sites set it. These tests simulate those call sites.
    manageDeParallelRouterBreaker: true,
  };

  // The canary that used to gate this is gone (registry entry + guard removed
  // together). The router is now a shipped default for every install, so the
  // guarantee worth pinning is the inverse of the old one: an ordinary install
  // must come out of the breaker with the var UNSET, so the producer's
  // default-ON applies. Writing "false" here would silently disarm the fleet —
  // that is exactly what gating at 5% did.
  it("leaves the var unset for an ordinary install so the producer default applies", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    delete process.env.HF_DE_PARALLEL_ROUTER;
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  // An explicit user choice outranks enrolment in both directions — the
  // documented escalation path for anyone who wants the router regardless.
  it("never overrides an explicit user value", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    process.env.HF_DE_PARALLEL_ROUTER = "true";
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("true");
  });

  it("leaves the env var untouched on a fresh install — the router is default-ON", async () => {
    // Under the old opt-in trial this armed HF_DE_PARALLEL_ROUTER="true".
    // The router now ships on, so the breaker's job is to stay out of the
    // way until something actually fails.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("does not override an env var the user already set themselves", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    process.env.HF_DE_PARALLEL_ROUTER = "false";
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
  });

  it("writes an explicit false once the breaker has tripped for this install", async () => {
    // THE regression this rework exists for: the old code disabled the
    // router by DELETING the var. With a default-ON router, absent means ON,
    // so deleting would silently re-enable it on the very host that just
    // failed. Only an explicit "false" is a real off-switch.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: true,
      telemetryNoticeShown: true,
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
  });

  for (const emptyish of ["", "   "]) {
    it(`treats a set-but-empty env var (${JSON.stringify(emptyish)}) as default, not a user choice`, async () => {
      // Both parsers read empty/whitespace as "unset → default ON", so the
      // producer routes. If ownership instead treated any defined value as a
      // user choice, the breaker would no-op and this install would keep
      // retrying a failing router forever — losing the first-fallback
      // protection that is the point of the breaker.
      configState.disk = {
        telemetryEnabled: true,
        deParallelRouterTrialFired: false,
        telemetryNoticeShown: true,
      };
      process.env.HF_DE_PARALLEL_ROUTER = emptyish;
      producerState.executeImpl = async (job) => {
        job.perfSummary = {
          resolution: { width: 100, height: 100 },
          drawElement: { parallelRouter: "reverted" },
        };
      };
      await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
      expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
      expect(configState.writeConfigCalls).toContainEqual(
        expect.objectContaining({ deParallelRouterTrialFired: true }),
      );
    });
  }

  it("does not override an explicit user opt-in even after a fallback", async () => {
    // "Explicit user choice wins in both directions" — the opt-in half.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    process.env.HF_DE_PARALLEL_ROUTER = "true";
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "reverted" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("true");
  });

  it("keeps the router on for a telemetry opt-out — analytics choice must not cost performance", async () => {
    // The old trial refused to arm without recordable telemetry (no point
    // running an experiment you can't measure). Now that the router is a
    // shipped default, gating it on telemetry would punish a privacy choice
    // with a slower renderer.
    configState.disk = {
      telemetryEnabled: false,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("does NOT persist the trial as fired on a clean 'routed' success — keeps trying on future renders", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "routed" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    // A write DOES happen — the render-count backstop is tracked on every
    // engaged render — but it must not flip deParallelRouterTrialFired.
    expect(configState.writeConfigCalls).toContainEqual(
      expect.objectContaining({
        deParallelRouterTrialFired: false,
        deParallelRouterTrialRenderCount: 1,
      }),
    );
  });

  it("persists the trial as fired when the router's own safety net actually reverted", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "reverted" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(configState.writeConfigCalls).toContainEqual(
      expect.objectContaining({ deParallelRouterTrialFired: true }),
    );
  });

  it("does not persist the trial as fired or increment the render count when the router never became eligible for this render", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      // aggregateDrawElement (perfSummary.ts) ALWAYS defaults parallelRouter
      // to the string "none" for every render, whether or not drawElement
      // ever ran — never undefined. This fixture must match that shape, not
      // an unrealistic empty object, or the test doesn't actually exercise
      // the "none"-vs-undefined distinction (review finding).
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "none" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(configState.writeConfigCalls).toHaveLength(0);
  });

  it("does NOT persist the trial as fired when a render merely 'routed' crashes for an unrelated reason (e.g. cancellation) — not a router failure", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      job.errorDetails = { observability: { capture: { deParallelRouter: "routed" } } };
      throw new Error("render cancelled");
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", { ...baseOptions, throwOnError: true }).catch(
      () => {},
    );
    // Still counts toward the render-count backstop (the router DID engage),
    // but must not flip deParallelRouterTrialFired — the crash wasn't the
    // router's own safety net firing.
    expect(configState.writeConfigCalls).toContainEqual(
      expect.objectContaining({
        deParallelRouterTrialFired: false,
        deParallelRouterTrialRenderCount: 1,
      }),
    );
  });

  it("persists the trial as fired from the failure path when the router's safety net reverted but the retry still failed", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      job.errorDetails = { observability: { capture: { deParallelRouter: "reverted" } } };
      throw new Error("worker crashed even after fallback");
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", { ...baseOptions, throwOnError: true }).catch(
      () => {},
    );
    expect(configState.writeConfigCalls).toContainEqual(
      expect.objectContaining({ deParallelRouterTrialFired: true }),
    );
  });

  it("persists a later --batch row's revert even though this process already armed the trial on an earlier row", async () => {
    // The --batch scenario: multiple renderLocal calls in one process. Row 1
    // succeeds (breaker stays out of the way, env untouched); row 2 reverts
    // and must still be recorded and trip the breaker.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };

    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "routed" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
    expect(configState.disk.deParallelRouterTrialFired).toBe(false);

    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "reverted" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);

    expect(configState.writeConfigCalls).toContainEqual(
      expect.objectContaining({ deParallelRouterTrialFired: true }),
    );
    // Explicit "false", not deleted: with a default-ON router, unsetting the
    // var would re-enable it on the host that just reverted.
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
  });

  it("does not arm the trial for programmatic callers that never opted in (opt-in polarity — also covers --batch-concurrency N>=2, which leaves it unset)", async () => {
    // The trial's process-wide env var and module-level flags are only safe
    // under sequential invocation, so manageDeParallelRouterBreaker is OPT-IN
    // (review): a programmatic renderLocal consumer that doesn't know about
    // the trial must get no trial. The CLI's concurrent-batch path relies on
    // the same default by leaving the option unset.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    const { manageDeParallelRouterBreaker: _omitted, ...programmaticOptions } = baseOptions;
    await renderLocal("/tmp/project", "/tmp/out.mp4", programmaticOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
    expect(configState.writeConfigCalls).toHaveLength(0);
  });

  it("does not override an env var the user set between two renders in the same process", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "routed" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();

    // A real interactive user can't do this mid-batch, but a wrapper script
    // invoking the CLI programmatically in the same process could — the
    // explicit override must still win on the next call.
    process.env.HF_DE_PARALLEL_ROUTER = "false";
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
  });

  it("never trips on healthy renders, however many — the old 25-render cap is gone", async () => {
    // The cap was sampling logic for an opt-in experiment. Under a shipped
    // default it would switch the feature off behind the user's back after
    // 25 good renders.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "routed" },
      };
    };

    for (let i = 0; i < 30; i++) {
      await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    }

    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
    expect(
      configState.writeConfigCalls.some((call) => call.deParallelRouterTrialFired === true),
    ).toBe(false);
  });

  // The config write landing is NOT enough: config.json is the copy a stale
  // writer or a re-mint can erase, so a run that mirrored nothing has left the
  // safety fact on the erasable store only. writeConfig() collapsed
  // {ok:true, mirrored:false} to success and the loop stopped there.
  it("retries when the install-state mirror fails even though config.json landed", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    configState.failMirrors = 1; // first attempt mirrors nothing
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "reverted" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);

    expect(configState.disk.deParallelRouterTrialFired).toBe(true);
    // Two writes: the one whose mirror failed, then the retry that mirrored.
    const firedWrites = configState.writeConfigCalls.filter(
      (c) => c.deParallelRouterTrialFired === true,
    );
    expect(firedWrites.length).toBeGreaterThanOrEqual(2);
  });

  it("re-asserts the fired flag when the write is lost (concurrent clobber / transient failure), without re-counting the render", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    configState.failWrites = 1; // the consume's main write is silently dropped
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "reverted" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    // The fired flag was verified and re-asserted (idempotent)...
    expect(configState.disk.deParallelRouterTrialFired).toBe(true);
    // ...but the render counter is deliberately NOT re-applied — a lost
    // increment under a race is benign, a re-applied one double-counts the
    // render and trips the exposure cap early (review finding).
    expect(configState.disk.deParallelRouterTrialRenderCount).toBeUndefined();
  });

  it("blocks re-arming for the rest of the process when the fired flag can never persist (unwritable config)", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    configState.failWrites = Number.MAX_SAFE_INTEGER; // ~/.hyperframes is unwritable
    producerState.executeImpl = async (job) => {
      job.perfSummary = {
        resolution: { width: 100, height: 100 },
        drawElement: { parallelRouter: "reverted" },
      };
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    // Nothing could persist...
    expect(configState.disk.deParallelRouterTrialFired).toBe(false);
    // ...but the in-process latch still blocks the next render from
    // re-running the path that just failed (review finding) — and now does
    // it by writing an explicit "false", since absent means ON.
    producerState.executeImpl = async () => undefined;
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
  });
});

describe("checkRenderResolutionPreflight", () => {
  const { checkRenderResolutionPreflight } = renderModule;

  // Dims must be read the same way the producer's compiler reads them:
  // `data-width` / `data-height` on the `[data-composition-id]` root.
  const comp = (w: number, h: number) =>
    `<html><body><div data-composition-id="root" data-width="${w}" data-height="${h}"></div></body></html>`;
  const portraitHtml = comp(1080, 1920);
  const landscapeHtml = comp(1920, 1080);
  const noModes = { alphaRequested: false, hdrRequested: false } as const;

  it("returns undefined when no outputResolution is requested", async () => {
    expect(await checkRenderResolutionPreflight(portraitHtml, undefined, noModes)).toBeUndefined();
  });

  it("returns undefined when the preset matches the composition orientation", async () => {
    expect(await checkRenderResolutionPreflight(portraitHtml, "portrait", noModes)).toBeUndefined();
  });

  it("returns a suggestion + aspect-mismatch kind when a landscape preset is used on a portrait composition", async () => {
    const result = await checkRenderResolutionPreflight(portraitHtml, "landscape", noModes);
    expect(result?.message).toContain("--resolution portrait");
    expect(result?.kind).toBe("aspect-mismatch");
  });

  it("suggests landscape for a landscape composition rendered with a portrait preset", async () => {
    const result = await checkRenderResolutionPreflight(landscapeHtml, "portrait", noModes);
    expect(result?.message).toContain("--resolution landscape");
  });

  it("preserves the 4K tier when suggesting a matching preset (square comp + landscape-4k → square-4k)", async () => {
    // Tier-aware suggestion is the load-bearing new behavior; square-4k is the
    // preset that only surfaces via a same-tier swap, so guard it explicitly.
    const result = await checkRenderResolutionPreflight(comp(2160, 2160), "landscape-4k", noModes);
    expect(result?.message).toContain("--resolution square-4k");
  });

  it("does not false-abort a landscape registry-block composition (data-width/height, no data-resolution)", async () => {
    // Regression guard: registry blocks carry data-width/height and no
    // data-resolution — a preset-snapping heuristic would misread this as
    // portrait and wrongly reject the correct --resolution landscape.
    expect(
      await checkRenderResolutionPreflight(landscapeHtml, "landscape", noModes),
    ).toBeUndefined();
  });

  it("flags alpha output combined with outputResolution", async () => {
    const result = await checkRenderResolutionPreflight(landscapeHtml, "landscape-4k", {
      alphaRequested: true,
      hdrRequested: false,
    });
    expect(result?.message).toContain("alpha output");
    expect(result?.kind).toBe("alpha-incompatible");
  });

  // The three remaining kinds share the same rejection sink (→ one emit each);
  // guard their classification so the telemetry dimension stays accurate.
  it("classifies an HDR + outputResolution combination as hdr-incompatible", async () => {
    const result = await checkRenderResolutionPreflight(landscapeHtml, "landscape", {
      alphaRequested: false,
      hdrRequested: true,
    });
    expect(result?.kind).toBe("hdr-incompatible");
  });

  it("classifies a preset smaller than the composition as downsampling", async () => {
    // 3840×2160 comp + landscape (1920×1080): same 16:9 aspect, target smaller.
    const result = await checkRenderResolutionPreflight(comp(3840, 2160), "landscape", noModes);
    expect(result?.kind).toBe("downsampling");
  });

  it("classifies a non-integer upscale as non-integer-scale", async () => {
    // 1280×720 comp + landscape (1920×1080): same 16:9 aspect, 1.5× scale.
    const result = await checkRenderResolutionPreflight(comp(1280, 720), "landscape", noModes);
    expect(result?.kind).toBe("non-integer-scale");
  });

  it("returns undefined when composition dimensions can't be determined (defers to the pipeline)", async () => {
    // No [data-composition-id] root / no data-width/height → defer, never guess.
    expect(await checkRenderResolutionPreflight("", "landscape", noModes)).toBeUndefined();
    expect(
      await checkRenderResolutionPreflight("<html><body></body></html>", "landscape", noModes),
    ).toBeUndefined();
  });

  // Aspect-agnostic aliases (`--resolution 1080p` / `hd` / `4k` / `uhd`) name a
  // resolution tier without pinning an orientation. When the flag is
  // aspect-agnostic the pre-flight must NOT block on an aspect-ratio mismatch —
  // the compile stage adapts the preset to the composition's orientation
  // downstream (see `outputResolutionAspectAgnostic` on RenderConfig).
  // Field signal ts=1784176662 (darwin/arm64, CLI 0.7.59):
  //   "--resolution 1080p rejects a 1080x1920 portrait comp"
  describe("aspect-agnostic (--resolution 1080p / hd / 4k / uhd)", () => {
    const agnostic = { ...noModes, aspectAgnostic: true } as const;

    it("clears a landscape preset on a portrait composition (the field-signal scenario)", async () => {
      // The bug: --resolution 1080p normalized to `landscape` (1920×1080),
      // then errored on a 1080×1920 portrait comp with "Output resolution
      // incompatible." With aspectAgnostic=true the pre-flight steps aside
      // and the compile stage re-maps landscape → portrait.
      expect(
        await checkRenderResolutionPreflight(portraitHtml, "landscape", agnostic),
      ).toBeUndefined();
    });

    it("clears a landscape-4k preset on a portrait composition (4K tier)", async () => {
      // `--resolution 4k` → normalized `landscape-4k`. Portrait comp is fine
      // when aspect-agnostic.
      expect(
        await checkRenderResolutionPreflight(portraitHtml, "landscape-4k", agnostic),
      ).toBeUndefined();
    });

    it("clears a landscape preset on a square composition", async () => {
      // aspect > 1 → landscape, aspect = 1 → square. Both self-heal.
      expect(
        await checkRenderResolutionPreflight(comp(1080, 1080), "landscape", agnostic),
      ).toBeUndefined();
    });

    it("still flags alpha + aspect-agnostic (orientation isn't the issue)", async () => {
      // alpha-incompatible is orthogonal to aspect: the alpha capture path
      // can't apply deviceScaleFactor regardless of orientation. The
      // aspect-agnostic downgrade must NOT swallow this.
      const result = await checkRenderResolutionPreflight(portraitHtml, "landscape", {
        aspectAgnostic: true,
        alphaRequested: true,
        hdrRequested: false,
      });
      expect(result?.kind).toBe("alpha-incompatible");
    });

    it("still flags HDR + aspect-agnostic", async () => {
      const result = await checkRenderResolutionPreflight(landscapeHtml, "landscape", {
        aspectAgnostic: true,
        alphaRequested: false,
        hdrRequested: true,
      });
      expect(result?.kind).toBe("hdr-incompatible");
    });

    it("still flags downsampling + aspect-agnostic (same-orientation, smaller preset)", async () => {
      // 3840×2160 comp with `--resolution 1080p` → `landscape` (1920×1080).
      // Same orientation, but tier smaller than comp — user asked for a
      // downsample. That's a real incompatibility, not an orientation swap.
      const result = await checkRenderResolutionPreflight(comp(3840, 2160), "landscape", agnostic);
      expect(result?.kind).toBe("downsampling");
    });

    it("does NOT auto-clear when the flag was explicit (orientation-locked preset stays strict)", async () => {
      // The negative case: `--resolution landscape` on a portrait comp — the
      // user explicitly asked for landscape orientation, and the mismatch is
      // a genuine mistake. Pre-flight must still block with the actionable
      // "did you mean --resolution portrait?" suggestion.
      const result = await checkRenderResolutionPreflight(portraitHtml, "landscape", noModes);
      expect(result?.kind).toBe("aspect-mismatch");
      expect(result?.message).toContain("--resolution portrait");
    });

    // Rames Δ2 on PR #2529: the earlier "downgrade aspect-mismatch to
    // undefined" preflight cleared *un-remapped* mismatches, so two input
    // classes below regressed from an early actionable error to a late throw
    // deep in `resolveDeviceScaleFactor` (browser + ffmpeg already up).
    // The fix computes the *effective* preset via `suggestMatchingPreset`
    // (mirroring the compile stage) and re-checks against that, so only
    // genuinely-fixable mismatches clear early.

    it("blocks IG 4:5 (non-preset aspect) early with an aspect-aware message", async () => {
      // 1080×1350 is a 4:5 portrait — no canonical preset shares that aspect,
      // so `suggestMatchingPreset` returns undefined and `adaptAspectAgnosticResolution`
      // keeps the original preset. Before the fix, aspect-agnostic downgraded
      // the mismatch here to undefined; now the preflight surfaces it early.
      const result = await checkRenderResolutionPreflight(comp(1080, 1350), "landscape", agnostic);
      expect(result?.kind).toBe("aspect-mismatch");
      // No sibling preset to suggest → message falls back to the "pick a preset
      // whose orientation matches" hint (see `buildAspectMismatch` in
      // `@hyperframes/parsers/outputResolutionCompatibility`).
      expect(result?.message).toMatch(/preset whose orientation matches|omit --resolution/i);
    });

    it("blocks a portrait-4K comp + `1080p` downsample early (orientation-flip masks the tier gap)", async () => {
      // 2160×3840 (portrait 4K) + `--resolution 1080p` — the compile stage
      // remaps `landscape` → `portrait` (1080×1920), and *then* the preset
      // is smaller than the composition. The un-remapped preflight let this
      // slip through as an aspect-mismatch downgrade; the remap-then-check
      // catches the real failure — downsampling — early.
      const result = await checkRenderResolutionPreflight(comp(2160, 3840), "landscape", agnostic);
      expect(result?.kind).toBe("downsampling");
    });

    it("blocks a portrait 720p comp + `1080p` non-integer upscale early (orientation-flip masks the fractional DPR)", async () => {
      // 720×1280 (portrait 720p) + `--resolution 1080p` — remap `landscape`
      // → `portrait` (1080×1920). widthRatio = 1080 / 720 = 1.5, which
      // `resolveDeviceScaleFactor` rejects. Surfacing it in preflight beats
      // failing after Chrome + ffmpeg spin up. Same class as Miga's
      // important note on PR #2529.
      const result = await checkRenderResolutionPreflight(comp(720, 1280), "landscape", agnostic);
      expect(result?.kind).toBe("non-integer-scale");
    });
  });
});

describe("render fps arg definition", () => {
  it("declares no citty default for --fps (so data-fps resolution can run)", async () => {
    // Regression guard: a `default: "30"` here makes citty set args.fps="30"
    // on omission, which short-circuits resolveDefaultFpsArg (explicitFps is
    // never null) and silently reverts the command to always-30 — the exact
    // no-op caught in review. The "30" fallback must live at the
    // parseFps(fpsArg ?? "30") call, not on the arg.
    const cmd = (await import("./render.js")).default;
    // citty types `args` as Resolvable (it could be a promise/factory); in
    // practice it's the literal object, so read it through a plain record.
    const args = cmd.args as unknown as Record<string, { default?: unknown } | undefined>;
    const fpsArg = args.fps;
    expect(fpsArg).toBeDefined();
    expect(fpsArg?.default).toBeUndefined();
  });
});

describe("render command explicit composition", () => {
  it("renders an explicit composition from a project with no index.html", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-render-explicit-"));
    const outputPath = join(projectDir, "out.mp4");
    writeFileSync(
      join(projectDir, "standalone.html"),
      `<html><body>
        <div data-composition-id="standalone" data-width="1920" data-height="1080" data-duration="1"></div>
        <script>window.__timelines = { standalone: gsap.timeline({ paused: true }) };</script>
      </body></html>`,
    );
    vi.useFakeTimers();

    try {
      const command = (await import("./render.js")).default;
      await command.run?.({
        args: {
          dir: projectDir,
          composition: "standalone.html",
          output: outputPath,
          quiet: true,
          quality: "standard",
          format: "mp4",
        },
      } as never);

      expect(producerState.createdJobs.at(-1)).toMatchObject({
        entryFile: "standalone.html",
      });
    } finally {
      vi.clearAllTimers();
      rmSync(projectDir, { recursive: true, force: true });
    }
  }, 60_000);
});

// Variables-helper tests live in `../utils/variables.test.ts`.
