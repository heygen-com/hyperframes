// fallow-ignore-file code-duplication
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  } => ({
    disk: { telemetryEnabled: true, deParallelRouterTrialFired: true },
    cache: null,
    writeConfigCalls: [],
    failWrites: 0,
  }),
);

const trackingState = vi.hoisted(() => ({
  // maybeEnableDeParallelRouterTrial gates on the real shouldTrack(), which
  // (via isDevMode()) always returns false when this file itself runs as
  // `.ts` source under vitest — mocked here so the CLI-trial tests can
  // control it directly instead of inheriting that environment quirk.
  shouldTrack: true,
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

vi.mock("../utils/producer.js", () => ({
  loadProducer: vi.fn(async () => ({
    resolveConfig: vi.fn((overrides: Record<string, unknown>) => {
      producerState.resolveConfigCalls.push(overrides);
      return { ...overrides, resolved: true };
    }),
    createRenderJob: vi.fn((config: Record<string, unknown>) => {
      producerState.createdJobs.push(config);
      return { config, progress: 100 };
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
}));

vi.mock("../telemetry/client.js", () => ({
  shouldTrack: vi.fn(() => trackingState.shouldTrack),
}));

vi.mock("../telemetry/events.js", () => ({
  trackRenderComplete: vi.fn(),
  trackRenderError: vi.fn(),
}));

vi.mock("../browser/ffmpeg.js", () => ({
  findFFmpeg: vi.fn(() => "/usr/bin/ffmpeg"),
  getFFmpegInstallHint: vi.fn(() => "brew install ffmpeg"),
}));

vi.mock("../browser/preflight.js", () => ({
  runEnvironmentChecks: vi.fn(async () => preflightState.result),
}));

describe("renderLocal browser GPU config", () => {
  const savedEnv = new Map<string, string | undefined>();
  // Pre-resolve once. The first dynamic `import("./render.js")` in this file
  // cold-loads a heavy module graph (core + engine + producer, incl. linkedom),
  // slow under the parallel monorepo run — the generous hook timeout that
  // absorbs that contention now lives in vitest.config.ts (shared by all CLI
  // suites). Importing once in `beforeAll` keeps every test fast and isolated.
  let renderLocal: typeof import("./render.js").renderLocal;
  let resolveBrowserGpuForCli: typeof import("./render.js").resolveBrowserGpuForCli;
  let renderLintContinuationHint: typeof import("./render.js").renderLintContinuationHint;
  let resetTrialState: typeof import("./render.js").__resetDeParallelRouterTrialStateForTests;

  beforeAll(async () => {
    ({
      renderLocal,
      resolveBrowserGpuForCli,
      renderLintContinuationHint,
      __resetDeParallelRouterTrialStateForTests: resetTrialState,
    } = await import("./render.js"));
  });

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
    configState.writeConfigCalls = [];
    trackingState.shouldTrack = true;
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

  it("can force the CLI process to exit after a successful local render", async () => {
    vi.useFakeTimers();
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null): never => {
        throw new Error(`process.exit:${code ?? ""}`);
      });

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

    expect(exit).not.toHaveBeenCalled();
    expect(() => vi.advanceTimersByTime(100)).toThrow("process.exit:0");
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("renderLocal — DE parallel-router CLI trial", () => {
  let renderLocal: typeof import("./render.js").renderLocal;
  let resetTrialState: typeof import("./render.js").__resetDeParallelRouterTrialStateForTests;
  const savedEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    ({ renderLocal, __resetDeParallelRouterTrialStateForTests: resetTrialState } =
      await import("./render.js"));
  });

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
    // The trial is OPT-IN (review): only the CLI's own sequential call sites
    // set this. These tests simulate those call sites.
    enableDeParallelRouterTrial: true,
  };

  it("enables the trial (sets the env var) on a fresh install with telemetry on", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("true");
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

  it("does not enable the trial once it has already fired for this install", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: true,
      telemetryNoticeShown: true,
    };
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("does not enable the trial when shouldTrack() is false (dev mode / DO_NOT_TRACK)", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    trackingState.shouldTrack = false;
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("does not enable the trial when config.telemetryEnabled is false, even if shouldTrack() is stale-true (e.g. `hyperframes telemetry off` mid-batch)", async () => {
    configState.disk = {
      telemetryEnabled: false,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    trackingState.shouldTrack = true;
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("does not enable the trial before the first-run telemetry disclosure has been shown at least once", async () => {
    // cli.ts shows this notice via a fire-and-forget, unawaited dynamic
    // import — there's no guarantee it printed before renderLocal runs on a
    // brand-new install's very first invocation. Requiring
    // telemetryNoticeShown means the trial never races an opt-in message
    // against the disclosure it depends on.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: false,
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
    // Regression test for the exact scenario a --batch run hits: multiple
    // renderLocal calls in one process. Before the fix, row 2's
    // maybeEnableDeParallelRouterTrial saw process.env.HF_DE_PARALLEL_ROUTER
    // already "true" (set by row 1) and mistook that for "the user set it",
    // returning trialArmed=false — silently dropping row 2's revert.
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
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("true");
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
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("does not arm the trial for programmatic callers that never opted in (opt-in polarity — also covers --batch-concurrency N>=2, which leaves it unset)", async () => {
    // The trial's process-wide env var and module-level flags are only safe
    // under sequential invocation, so enableDeParallelRouterTrial is OPT-IN
    // (review): a programmatic renderLocal consumer that doesn't know about
    // the trial must get no trial. The CLI's concurrent-batch path relies on
    // the same default by leaving the option unset.
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    const { enableDeParallelRouterTrial: _omitted, ...programmaticOptions } = baseOptions;
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
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("true");

    // A real interactive user can't do this mid-batch, but a wrapper script
    // invoking the CLI programmatically in the same process could — the
    // explicit override must still win on the next call.
    process.env.HF_DE_PARALLEL_ROUTER = "false";
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("false");
  });

  it("caps exposure at DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS even when the router never reverts", async () => {
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

    for (let i = 0; i < 25; i++) {
      await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    }

    expect(configState.writeConfigCalls).toContainEqual(
      expect.objectContaining({
        deParallelRouterTrialFired: true,
        deParallelRouterTrialRenderCount: 25,
      }),
    );
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();

    // The 26th eligible render must not re-arm it.
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });

  it("observes a telemetry opt-out written by another process mid-batch (arm site reads fresh, not cached)", async () => {
    configState.disk = {
      telemetryEnabled: true,
      deParallelRouterTrialFired: false,
      telemetryNoticeShown: true,
    };
    // Row 1 arms and primes the config cache.
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBe("true");

    // Another process runs `hyperframes telemetry off`, writing straight to
    // "disk" — this process's cache still says telemetryEnabled: true, so a
    // cached read at the arm site would keep arming (review finding).
    configState.disk = { ...configState.disk, telemetryEnabled: false };

    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
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
    // re-running the experiment that just failed (review finding).
    producerState.executeImpl = async () => undefined;
    await renderLocal("/tmp/project", "/tmp/out.mp4", baseOptions);
    expect(process.env.HF_DE_PARALLEL_ROUTER).toBeUndefined();
  });
});

describe("checkRenderResolutionPreflight", () => {
  let checkRenderResolutionPreflight: typeof import("./render.js").checkRenderResolutionPreflight;

  // Cold-imports render.js (heavy graph); the generous hook timeout for parallel
  // CI contention lives in vitest.config.ts. See the note above.
  beforeAll(async () => {
    ({ checkRenderResolutionPreflight } = await import("./render.js"));
  });

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

// Variables-helper tests live in `../utils/variables.test.ts`.
