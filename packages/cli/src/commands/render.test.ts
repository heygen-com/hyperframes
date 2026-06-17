// fallow-ignore-file code-duplication
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const producerState = vi.hoisted(() => ({
  createdJobs: [] as Array<Record<string, unknown>>,
  resolveConfigCalls: [] as Array<Record<string, unknown>>,
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
    executeRenderJob: vi.fn(async () => undefined),
  })),
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
  // takes >5 s on Windows runners (cold module load) — long enough to blow
  // vitest's default 5 s timeout in whichever test happens to be first. When
  // that test times out, its leaked late `createRenderJob` call lands AFTER
  // the next test's `beforeEach` clears `producerState.createdJobs`, shifting
  // index 0 and corrupting unrelated assertions. Importing once in
  // `beforeAll` keeps every test fast and isolated.
  let renderLocal: typeof import("./render.js").renderLocal;
  let resolveBrowserGpuForCli: typeof import("./render.js").resolveBrowserGpuForCli;

  beforeAll(async () => {
    ({ renderLocal, resolveBrowserGpuForCli } = await import("./render.js"));
  });

  function setEnv(key: string, value: string) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  beforeEach(() => {
    producerState.createdJobs = [];
    producerState.resolveConfigCalls = [];
    savedEnv.clear();
    savedEnv.set("HYPERFRAMES_FFMPEG_PATH", process.env.HYPERFRAMES_FFMPEG_PATH);
    savedEnv.set("HYPERFRAMES_FFPROBE_PATH", process.env.HYPERFRAMES_FFPROBE_PATH);
    savedEnv.set("PRODUCER_HEADLESS_SHELL_PATH", process.env.PRODUCER_HEADLESS_SHELL_PATH);
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    delete process.env.HYPERFRAMES_FFPROBE_PATH;
    delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
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

// Variables-helper tests live in `../utils/variables.test.ts`.
