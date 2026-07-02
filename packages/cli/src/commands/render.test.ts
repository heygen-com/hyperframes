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
  // cold-loads a heavy module graph (core + engine + producer, incl. linkedom)
  // and takes >5 s on Windows runners — and materially longer under the full
  // parallel monorepo test run, where it can exceed the default 10 s hook
  // timeout on a contended CI runner. Importing once in `beforeAll` keeps every
  // test fast and isolated; the explicit 30 s hook timeout absorbs cold-import
  // contention so this doesn't flake (the failure was a pre-existing
  // `Hook timed out in 10000ms`, reproducible on `main` under load).
  let renderLocal: typeof import("./render.js").renderLocal;
  let resolveBrowserGpuForCli: typeof import("./render.js").resolveBrowserGpuForCli;

  beforeAll(async () => {
    ({ renderLocal, resolveBrowserGpuForCli } = await import("./render.js"));
  }, 30_000);

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

describe("checkRenderResolutionPreflight", () => {
  let checkRenderResolutionPreflight: typeof import("./render.js").checkRenderResolutionPreflight;

  // 30 s hook timeout: cold-importing render.js (heavy graph) can exceed the
  // default 10 s under parallel CI contention. See the note on the
  // "renderLocal browser GPU config" beforeAll above.
  beforeAll(async () => {
    ({ checkRenderResolutionPreflight } = await import("./render.js"));
  }, 30_000);

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

  it("returns a suggestion when a landscape preset is used on a portrait composition", async () => {
    const message = await checkRenderResolutionPreflight(portraitHtml, "landscape", noModes);
    expect(message).toBeDefined();
    expect(message).toContain("--resolution portrait");
  });

  it("suggests landscape for a landscape composition rendered with a portrait preset", async () => {
    const message = await checkRenderResolutionPreflight(landscapeHtml, "portrait", noModes);
    expect(message).toContain("--resolution landscape");
  });

  it("preserves the 4K tier when suggesting a matching preset (square comp + landscape-4k → square-4k)", async () => {
    // Tier-aware suggestion is the load-bearing new behavior; square-4k is the
    // preset that only surfaces via a same-tier swap, so guard it explicitly.
    const message = await checkRenderResolutionPreflight(comp(2160, 2160), "landscape-4k", noModes);
    expect(message).toContain("--resolution square-4k");
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
    const message = await checkRenderResolutionPreflight(landscapeHtml, "landscape-4k", {
      alphaRequested: true,
      hdrRequested: false,
    });
    expect(message).toContain("alpha output");
  });

  it("returns undefined when composition dimensions can't be determined (defers to the pipeline)", async () => {
    // No [data-composition-id] root / no data-width/height → defer, never guess.
    expect(await checkRenderResolutionPreflight("", "landscape", noModes)).toBeUndefined();
    expect(
      await checkRenderResolutionPreflight("<html><body></body></html>", "landscape", noModes),
    ).toBeUndefined();
  });
});

// Variables-helper tests live in `../utils/variables.test.ts`.
