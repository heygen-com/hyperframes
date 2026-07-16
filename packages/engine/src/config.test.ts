import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveConfig,
  DEFAULT_CONFIG,
  scaleProtocolTimeoutForComposition,
  shouldClampToScreenshotForConcreteGpu,
  applyConcreteGpuScreenshotClamp,
  shouldAutoDisableStreamingEncodeOnWin32Compound,
} from "./config.js";
import type { EngineConfig } from "./config.js";
import { isLowMemorySystem } from "./services/systemMemory.js";

describe("resolveConfig", () => {
  const savedEnv = new Map<string, string | undefined>();

  function setEnv(key: string, value: string) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  function unsetEnv(key: string) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  beforeEach(() => {
    savedEnv.clear();
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns defaults when no overrides or env vars are set", () => {
    const config = resolveConfig();
    expect(config.fps).toBe(30);
    expect(config.quality).toBe("standard");
    expect(config.format).toBe("jpeg");
    expect(config.jpegQuality).toBe(80);
    expect(config.browserGpuMode).toBe("software");
    expect(config.enableStreamingEncode).toBe(true);
    expect(config.streamingEncodeMaxDurationSeconds).toBe(240);
    expect((config as Record<string, unknown>).vp9CpuUsed).toBe(4);
    expect(config.audioGain).toBe(1);
    expect(config.debug).toBe(false);
  });

  it("applies explicit overrides over defaults", () => {
    const config = resolveConfig({ fps: 60, debug: true });
    expect(config.fps).toBe(60);
    expect(config.debug).toBe(true);
    // Non-overridden fields remain at defaults
    expect(config.quality).toBe("standard");
  });

  it("reads numeric env vars with PRODUCER_ prefix", () => {
    setEnv("PRODUCER_MAX_WORKERS", "4");
    setEnv("PRODUCER_CORES_PER_WORKER", "3");

    const config = resolveConfig();
    expect(config.concurrency).toBe(4);
    expect(config.coresPerWorker).toBe(3);
  });

  it("reads boolean env vars (true/false strings)", () => {
    setEnv("PRODUCER_DISABLE_GPU", "true");
    setEnv("PRODUCER_ENABLE_BROWSER_POOL", "true");

    const config = resolveConfig();
    expect(config.disableGpu).toBe(true);
    expect(config.enableBrowserPool).toBe(true);
  });

  it("lets env vars opt out of default streaming encode", () => {
    setEnv("PRODUCER_ENABLE_STREAMING_ENCODE", "false");

    const config = resolveConfig();
    expect(config.enableStreamingEncode).toBe(false);
  });

  it("reads the streaming encode duration cutoff from env", () => {
    setEnv("PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS", "120");

    const config = resolveConfig();
    expect(config.streamingEncodeMaxDurationSeconds).toBe(120);
  });

  it("clamps negative streaming encode duration cutoff env values to zero", () => {
    setEnv("PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS", "-1");

    const config = resolveConfig();
    expect(config.streamingEncodeMaxDurationSeconds).toBe(0);
  });

  it("reads VP9 cpu-used from env", () => {
    setEnv("PRODUCER_VP9_CPU_USED", "6");

    const config = resolveConfig();
    expect((config as Record<string, unknown>).vp9CpuUsed).toBe(6);
  });

  it("falls back to the VP9 cpu-used default for invalid env values", () => {
    setEnv("PRODUCER_VP9_CPU_USED", "fast");

    const config = resolveConfig();
    expect((config as Record<string, unknown>).vp9CpuUsed).toBe(4);
  });

  it("clamps VP9 cpu-used env values to libvpx's supported range", () => {
    setEnv("PRODUCER_VP9_CPU_USED", "99");
    expect((resolveConfig() as Record<string, unknown>).vp9CpuUsed).toBe(8);

    process.env.PRODUCER_VP9_CPU_USED = "-99";
    expect((resolveConfig() as Record<string, unknown>).vp9CpuUsed).toBe(-8);
  });

  it("treats non-'true' boolean env vars as false", () => {
    setEnv("PRODUCER_DISABLE_GPU", "yes");

    const config = resolveConfig();
    expect(config.disableGpu).toBe(false);
  });

  it("reads browser GPU mode from env", () => {
    setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");

    const config = resolveConfig();
    expect(config.browserGpuMode).toBe("hardware");
  });

  it("accepts 'auto' as a valid browser GPU mode env value", () => {
    setEnv("PRODUCER_BROWSER_GPU_MODE", "auto");

    const config = resolveConfig();
    expect(config.browserGpuMode).toBe("auto");
  });

  it("falls back to software browser GPU mode for invalid env values", () => {
    setEnv("PRODUCER_BROWSER_GPU_MODE", "native");

    const config = resolveConfig();
    expect(config.browserGpuMode).toBe("software");
  });

  it("explicit overrides take precedence over env vars", () => {
    setEnv("PRODUCER_CORES_PER_WORKER", "5");

    const config = resolveConfig({ coresPerWorker: 8 });
    expect(config.coresPerWorker).toBe(8);
  });

  it("falls back to defaults for invalid numeric env vars", () => {
    setEnv("PRODUCER_CORES_PER_WORKER", "not-a-number");

    const config = resolveConfig();
    expect(config.coresPerWorker).toBe(DEFAULT_CONFIG.coresPerWorker);
  });

  it("clamps chunkSizeFrames to minimum of 120", () => {
    setEnv("PRODUCER_CHUNK_SIZE_FRAMES", "50");

    const config = resolveConfig();
    expect(config.chunkSizeFrames).toBe(120);
  });

  it("clamps frameDataUriCacheLimit to minimum of 32", () => {
    setEnv("PRODUCER_FRAME_DATA_URI_CACHE_LIMIT", "10");

    const config = resolveConfig();
    expect(config.frameDataUriCacheLimit).toBe(32);
  });

  describe("enablePageSideCompositing (HF_PAGE_SIDE_COMPOSITING)", () => {
    it("defaults to true", () => {
      const config = resolveConfig();
      expect(config.enablePageSideCompositing).toBe(true);
    });

    it("disabled when HF_PAGE_SIDE_COMPOSITING=false", () => {
      setEnv("HF_PAGE_SIDE_COMPOSITING", "false");
      const config = resolveConfig();
      expect(config.enablePageSideCompositing).toBe(false);
    });

    it("explicit override wins over the env var", () => {
      setEnv("HF_PAGE_SIDE_COMPOSITING", "true");
      const config = resolveConfig({ enablePageSideCompositing: false });
      expect(config.enablePageSideCompositing).toBe(false);
    });
  });

  describe("extraction cache env", () => {
    it("defaults the extract cache directory to tmpdir plus uid when env is unset", () => {
      unsetEnv("HYPERFRAMES_EXTRACT_CACHE_DIR");

      const config = resolveConfig();

      expect(config.extractCacheDir).toBe(
        join(tmpdir(), `hyperframes-extract-cache-${process.getuid?.() ?? "u"}`),
      );
    });

    it("disables the extract cache when env is an opt-out token", () => {
      for (const value of ["off", "none", "false", "0", " OFF "]) {
        setEnv("HYPERFRAMES_EXTRACT_CACHE_DIR", value);

        expect(resolveConfig().extractCacheDir).toBeUndefined();
      }
    });

    it("uses an explicit extract cache path from env", () => {
      setEnv("HYPERFRAMES_EXTRACT_CACHE_DIR", "/tmp/custom-hf-cache");

      expect(resolveConfig().extractCacheDir).toBe("/tmp/custom-hf-cache");
    });

    it("converts HYPERFRAMES_EXTRACT_CACHE_MAX_MB to bytes", () => {
      setEnv("HYPERFRAMES_EXTRACT_CACHE_MAX_MB", "512");

      expect(resolveConfig().extractCacheMaxBytes).toBe(512 * 1024 ** 2);
    });
  });

  describe("useDrawElement (PRODUCER_EXPERIMENTAL_FAST_CAPTURE)", () => {
    it("default is clamped off on software-GPU hosts (page-side compositing preserved)", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      unsetEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE");
      unsetEnv("HF_DE_WORKER_ENCODE");
      const config = resolveConfig();
      expect(config.useDrawElement).toBe(false);
      expect(config.enablePageSideCompositing).toBe(true);
    });

    it("default engages on macOS with a hardware-GPU browser", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      unsetEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE");
      unsetEnv("HF_DE_WORKER_ENCODE");
      const config = resolveConfig();
      expect(config.useDrawElement).toBe(process.platform === "darwin");
    });

    it("default engages on macOS with auto GPU mode (the stock CLI path)", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "auto");
      unsetEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE");
      unsetEnv("HF_DE_WORKER_ENCODE");
      const config = resolveConfig();
      expect(config.useDrawElement).toBe(process.platform === "darwin");
    });

    it("default requires worker-encode (the verified drain)", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      setEnv("HF_DE_WORKER_ENCODE", "false");
      unsetEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE");
      const config = resolveConfig();
      expect(config.useDrawElement).toBe(false);
    });

    it("explicit env opt-in skips the platform clamp", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", "true");
      const config = resolveConfig();
      expect(config.useDrawElement).toBe(true);
    });

    it("env kill switch wins over the default", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      setEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", "false");
      const config = resolveConfig();
      expect(config.useDrawElement).toBe(false);
    });

    it("explicit override wins over the env var", () => {
      setEnv("PRODUCER_EXPERIMENTAL_FAST_CAPTURE", "true");
      const config = resolveConfig({ useDrawElement: false });
      expect(config.useDrawElement).toBe(false);
    });

    it("forces page-side compositing off when enabled (incompatible strategies)", () => {
      const config = resolveConfig({ useDrawElement: true, enablePageSideCompositing: true });
      expect(config.useDrawElement).toBe(true);
      expect(config.enablePageSideCompositing).toBe(false);
      // The auto-disable is recorded so compile-time gates can restore it.
      expect(config.pageSideCompositingAutoDisabled).toBe(true);
    });

    it("does NOT mark auto-disabled when the caller explicitly opted out of page-side compositing", () => {
      const config = resolveConfig({ useDrawElement: true, enablePageSideCompositing: false });
      expect(config.enablePageSideCompositing).toBe(false);
      // Explicit caller intent — a compile-time drawElement gate must not restore it.
      expect(config.pageSideCompositingAutoDisabled).not.toBe(true);
    });

    it("leaves page-side compositing on when fast capture is off", () => {
      const config = resolveConfig({ useDrawElement: false });
      expect(config.enablePageSideCompositing).toBe(true);
    });
  });

  describe("forceScreenshot (software-GPU clamp)", () => {
    it("forces screenshot capture when browserGpuMode resolves to software", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig();
      expect(config.forceScreenshot).toBe(true);
    });

    it("leaves forceScreenshot alone on hardware GPU (default off)", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig();
      expect(config.forceScreenshot).toBe(false);
    });

    it("does not force screenshot on auto (auto probes to hardware on real GPUs)", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "auto");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig();
      expect(config.forceScreenshot).toBe(false);
    });

    it("explicit env opt-out (PRODUCER_FORCE_SCREENSHOT=false) is honored on software", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_FORCE_SCREENSHOT", "false");
      const config = resolveConfig();
      expect(config.forceScreenshot).toBe(false);
    });

    it("explicit programmatic opt-out is honored on software", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig({ forceScreenshot: false });
      expect(config.forceScreenshot).toBe(false);
    });

    it("caller override forceScreenshot=true stays true regardless of GPU mode", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      const config = resolveConfig({ forceScreenshot: true });
      expect(config.forceScreenshot).toBe(true);
    });

    it("documents the auto-branch gap: resolveConfig leaves auto→software as forceScreenshot=false", () => {
      // resolveConfig's clamp keys on the string `browserGpuMode`; `"auto"`
      // that runtime-probes to software is invisible to this layer. The
      // runtime companion `shouldClampToScreenshotForConcreteGpu` (below)
      // closes the gap at the frameCapture + renderOrchestrator sites.
      setEnv("PRODUCER_BROWSER_GPU_MODE", "auto");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig();
      expect(config.browserGpuMode).toBe("auto");
      expect(config.forceScreenshot).toBe(false);
    });
  });

  describe("shouldClampToScreenshotForConcreteGpu (runtime companion for auto→software)", () => {
    it("returns true when resolved GPU is software AND forceScreenshot is currently false", () => {
      // Env explicitly cleared so PRODUCER_FORCE_SCREENSHOT="false" opt-out
      // doesn't fire.
      expect(
        shouldClampToScreenshotForConcreteGpu("software", false, {} as NodeJS.ProcessEnv),
      ).toBe(true);
    });

    it("returns false when resolved GPU is hardware (no clamp needed)", () => {
      expect(
        shouldClampToScreenshotForConcreteGpu("hardware", false, {} as NodeJS.ProcessEnv),
      ).toBe(false);
    });

    it("returns false when forceScreenshot is already true (invariant already satisfied)", () => {
      expect(shouldClampToScreenshotForConcreteGpu("software", true, {} as NodeJS.ProcessEnv)).toBe(
        false,
      );
    });

    it("honors PRODUCER_FORCE_SCREENSHOT=false env opt-out on software", () => {
      // BeginFrame-on-software debugging escape hatch.
      expect(
        shouldClampToScreenshotForConcreteGpu("software", false, {
          PRODUCER_FORCE_SCREENSHOT: "false",
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });

    it("does NOT treat other PRODUCER_FORCE_SCREENSHOT values as opt-out", () => {
      // Only literal "false" opts out; "true", "0", missing, anything else clamps.
      for (const value of [undefined, "true", "1", "0", "no", ""]) {
        const env = (
          value === undefined ? {} : { PRODUCER_FORCE_SCREENSHOT: value }
        ) as NodeJS.ProcessEnv;
        expect(shouldClampToScreenshotForConcreteGpu("software", false, env)).toBe(true);
      }
    });

    it("honors the programmatic opt-out via opts.programmaticOptOut on software", () => {
      // The auto→software probe path is what this really guards: `resolveConfig`
      // sets `forceScreenshotExplicitlyOptedOut = true` when the caller passed
      // `overrides.forceScreenshot === false`, and the helper reads it here so
      // the concrete-resolution route matches the config-time behavior.
      expect(
        shouldClampToScreenshotForConcreteGpu("software", false, {} as NodeJS.ProcessEnv, {
          programmaticOptOut: true,
        }),
      ).toBe(false);
    });

    it("programmatic opt-out beats a missing env opt-out (both escape hatches independent)", () => {
      // Even with no env opt-out set, a programmatic opt-out preserves BeginFrame-
      // on-software debugging on the auto→software probe path.
      expect(
        shouldClampToScreenshotForConcreteGpu(
          "software",
          false,
          { PRODUCER_FORCE_SCREENSHOT: "true" } as NodeJS.ProcessEnv,
          { programmaticOptOut: true },
        ),
      ).toBe(false);
    });
  });

  describe("applyConcreteGpuScreenshotClamp (caller-level contract)", () => {
    // This is the helper both frameCapture.ts and renderOrchestrator.ts call
    // to compute the value the AUTHORITATIVE `forceScreenshot` local should
    // hold after the concrete GPU is resolved. Routing AND telemetry read
    // from that one value, so this contract must hold across default and
    // opt-out combinations.
    type OptOutCfg = Pick<EngineConfig, "forceScreenshotExplicitlyOptedOut">;
    const cleanEnv = {} as NodeJS.ProcessEnv;

    it("resolved software + default false → promotes to true (screenshot route)", () => {
      // The core auto→software fix: routing AND downstream telemetry read
      // the promoted value, so `updateCaptureObservability({ forceScreenshot:
      // captureForceScreenshot })` at the capture_strategy site reports
      // screenshot instead of overwriting back to beginframe.
      expect(applyConcreteGpuScreenshotClamp(false, "software", {} as OptOutCfg, cleanEnv)).toBe(
        true,
      );
    });

    it("resolved software + programmatic opt-out → stays false (BeginFrame preserved)", () => {
      // The programmatic escape hatch caller-level contract: setting
      // overrides.forceScreenshot=false must keep BeginFrame across BOTH
      // routing (frameCapture) and telemetry (renderOrchestrator) — since
      // resolveConfig lifts the flag onto the config, both callers converge.
      expect(
        applyConcreteGpuScreenshotClamp(
          false,
          "software",
          { forceScreenshotExplicitlyOptedOut: true } as OptOutCfg,
          cleanEnv,
        ),
      ).toBe(false);
    });

    it("resolved hardware + default false → stays false (no clamp needed)", () => {
      expect(applyConcreteGpuScreenshotClamp(false, "hardware", {} as OptOutCfg, cleanEnv)).toBe(
        false,
      );
    });

    it("resolved software + already-true forceScreenshot → stays true (idempotent)", () => {
      // Config-time clamp already fired (literal browserGpuMode:"software"),
      // so re-applying at the concrete-resolved site is a no-op.
      expect(applyConcreteGpuScreenshotClamp(true, "software", {} as OptOutCfg, cleanEnv)).toBe(
        true,
      );
    });

    it("resolved software + env PRODUCER_FORCE_SCREENSHOT=false → stays false", () => {
      // Env opt-out preserved even when programmatic flag is not set (some
      // callers, like debugging BeginFrame-on-software from CI, opt-out via
      // env only).
      expect(
        applyConcreteGpuScreenshotClamp(
          false,
          "software",
          {} as OptOutCfg,
          {
            PRODUCER_FORCE_SCREENSHOT: "false",
          } as NodeJS.ProcessEnv,
        ),
      ).toBe(false);
    });

    it("resolved software + undefined cfg → default (no programmatic opt-out) → clamps to true", () => {
      // Sanity: frameCapture.ts calls with `config` possibly undefined.
      // Default case must still promote.
      expect(applyConcreteGpuScreenshotClamp(false, "software", undefined, cleanEnv)).toBe(true);
    });
  });

  describe("forceScreenshotExplicitlyOptedOut provenance", () => {
    it("is set to true when programmatic override forceScreenshot=false is passed", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig({ forceScreenshot: false });
      expect(config.forceScreenshotExplicitlyOptedOut).toBe(true);
    });

    it("is set to true when env PRODUCER_FORCE_SCREENSHOT=false is set", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      setEnv("PRODUCER_FORCE_SCREENSHOT", "false");
      const config = resolveConfig();
      expect(config.forceScreenshotExplicitlyOptedOut).toBe(true);
    });

    it("stays unset when neither opt-out is present (default)", () => {
      setEnv("PRODUCER_BROWSER_GPU_MODE", "hardware");
      unsetEnv("PRODUCER_FORCE_SCREENSHOT");
      const config = resolveConfig();
      expect(config.forceScreenshotExplicitlyOptedOut).toBeUndefined();
    });
  });

  describe("shouldAutoDisableStreamingEncodeOnWin32Compound (helper)", () => {
    // Baseline: field-signal compound — win32 + software-GPU forced + workers=1,
    // duration unknown, user hasn't touched the env / overrides.
    const compound = {
      platform: "win32" as NodeJS.Platform,
      softwareGpuForced: true,
      workers: 1,
      compositionDurationSec: undefined as number | undefined,
      userExplicitlySet: false,
    };

    it("triggers on the field-signal compound (win32 + software-GPU + workers=1)", () => {
      expect(shouldAutoDisableStreamingEncodeOnWin32Compound(compound)).toBe(true);
    });

    it("does NOT trigger on linux or darwin (platform gate)", () => {
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({ ...compound, platform: "linux" }),
      ).toBe(false);
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({ ...compound, platform: "darwin" }),
      ).toBe(false);
    });

    it("does NOT trigger without software-GPU forced (bypass on hardware paths)", () => {
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({ ...compound, softwareGpuForced: false }),
      ).toBe(false);
    });

    it("does NOT trigger with parallel workers (workers > 1 has a different failure surface)", () => {
      expect(shouldAutoDisableStreamingEncodeOnWin32Compound({ ...compound, workers: 2 })).toBe(
        false,
      );
      expect(shouldAutoDisableStreamingEncodeOnWin32Compound({ ...compound, workers: 4 })).toBe(
        false,
      );
    });

    it("does NOT trigger when the user explicitly set enableStreamingEncode (escape hatch)", () => {
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({ ...compound, userExplicitlySet: true }),
      ).toBe(false);
    });

    it("does NOT trigger for short (<=120s) compositions when duration is known", () => {
      // 120s boundary is off (edge)
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({
          ...compound,
          compositionDurationSec: 120,
        }),
      ).toBe(false);
      // 60s — clearly short, off
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({
          ...compound,
          compositionDurationSec: 60,
        }),
      ).toBe(false);
    });

    it("triggers when duration is known and exceeds 120s (heavy Windows composition)", () => {
      // 121s — just past the boundary, on
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({
          ...compound,
          compositionDurationSec: 121,
        }),
      ).toBe(true);
      // 156s — matches the field signal, on
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({
          ...compound,
          compositionDurationSec: 156,
        }),
      ).toBe(true);
    });

    it("triggers when duration is undefined (config-layer wire-up reduces to 3-cond)", () => {
      // resolveConfig can't see composition duration at config time; the
      // three-condition compound is conservative on its own.
      expect(
        shouldAutoDisableStreamingEncodeOnWin32Compound({
          ...compound,
          compositionDurationSec: undefined,
        }),
      ).toBe(true);
    });
  });

  describe("enableStreamingEncode (Windows compound auto-disable wire-up)", () => {
    const originalPlatform = process.platform;

    function setPlatform(platform: NodeJS.Platform) {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
    }

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("auto-disables on win32 + software-GPU + workers=1 + no user opt-in", () => {
      setPlatform("win32");
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_MAX_WORKERS", "1");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(false);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBe(true);
    });

    it("leaves streaming-encode on when platform is linux", () => {
      setPlatform("linux");
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_MAX_WORKERS", "1");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(true);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBeUndefined();
    });

    it("leaves streaming-encode on when workers > 1", () => {
      setPlatform("win32");
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_MAX_WORKERS", "4");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(true);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBeUndefined();
    });

    it("respects explicit env opt-in (PRODUCER_ENABLE_STREAMING_ENCODE=true) on the compound", () => {
      setPlatform("win32");
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_MAX_WORKERS", "1");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      setEnv("PRODUCER_ENABLE_STREAMING_ENCODE", "true");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(true);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBeUndefined();
    });

    it("respects programmatic override enableStreamingEncode=true on the compound", () => {
      setPlatform("win32");
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      setEnv("PRODUCER_MAX_WORKERS", "1");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig({ enableStreamingEncode: true });
      expect(config.enableStreamingEncode).toBe(true);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBeUndefined();
    });

    it("triggers via disableGpu on win32 + workers=1 (browserGpuMode may still be 'auto')", () => {
      // --disable-gpu path: browserGpuMode may not be literal "software" but
      // Chrome is still routed to CPU raster. Field-signal compound applies.
      setPlatform("win32");
      unsetEnv("PRODUCER_BROWSER_GPU_MODE");
      setEnv("PRODUCER_DISABLE_GPU", "true");
      setEnv("PRODUCER_MAX_WORKERS", "1");
      unsetEnv("PRODUCER_LOW_MEMORY_MODE");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(false);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBe(true);
    });

    it("triggers via lowMemoryMode alone on win32 + workers=1 (screenshot capture implied)", () => {
      // --low-memory-mode implies screenshot capture. Compound applies even
      // if browserGpuMode is not literal "software" (defense-in-depth: matches
      // the OR semantics in `softwareGpuForced`).
      setPlatform("win32");
      unsetEnv("PRODUCER_BROWSER_GPU_MODE");
      unsetEnv("PRODUCER_DISABLE_GPU");
      setEnv("PRODUCER_MAX_WORKERS", "1");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(false);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBe(true);
    });

    it("does not trigger when concurrency is 'auto' (workers not explicitly pinned)", () => {
      // Config-layer sees `concurrency === "auto"`, not a number — the
      // helper's numeric workers check treats NaN as "unknown, don't trigger".
      // Downstream workers may still resolve to 1 via lowMemoryMode, but the
      // config-time clamp is deliberately conservative.
      setPlatform("win32");
      setEnv("PRODUCER_BROWSER_GPU_MODE", "software");
      unsetEnv("PRODUCER_MAX_WORKERS");
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      unsetEnv("PRODUCER_ENABLE_STREAMING_ENCODE");

      const config = resolveConfig();
      expect(config.enableStreamingEncode).toBe(true);
      expect(config.streamingEncodeAutoDisabledOnWin32Compound).toBeUndefined();
    });
  });

  describe("lowMemoryMode", () => {
    it("forces on for truthy PRODUCER_LOW_MEMORY_MODE values", () => {
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      for (const v of ["true", "on", "1", "TRUE"]) {
        process.env.PRODUCER_LOW_MEMORY_MODE = v;
        expect(resolveConfig().lowMemoryMode).toBe(true);
      }
    });

    it("forces off for falsy PRODUCER_LOW_MEMORY_MODE values", () => {
      setEnv("PRODUCER_LOW_MEMORY_MODE", "false");
      for (const v of ["false", "off", "0", "OFF"]) {
        process.env.PRODUCER_LOW_MEMORY_MODE = v;
        expect(resolveConfig().lowMemoryMode).toBe(false);
      }
    });

    it("auto-detects from total RAM when the env var is unset", () => {
      setEnv("PRODUCER_LOW_MEMORY_MODE", "");
      delete process.env.PRODUCER_LOW_MEMORY_MODE;
      expect(resolveConfig().lowMemoryMode).toBe(isLowMemorySystem());
    });

    it("explicit override beats both env and auto-detection", () => {
      setEnv("PRODUCER_LOW_MEMORY_MODE", "true");
      expect(resolveConfig({ lowMemoryMode: false }).lowMemoryMode).toBe(false);
    });
  });
});

describe("scaleProtocolTimeoutForComposition", () => {
  const base = 300_000;

  it("keeps the base timeout for a reference-or-smaller canvas", () => {
    // 1080p == reference area → factor 1, no scale.
    expect(scaleProtocolTimeoutForComposition(base, { width: 1920, height: 1080 })).toBe(base);
    // Smaller than reference → still the base (never scales down).
    expect(scaleProtocolTimeoutForComposition(base, { width: 1280, height: 720 })).toBe(base);
  });

  it("scales up proportionally with output pixel area", () => {
    // 4K == 4× the reference area, which stays under the 30-minute ceiling.
    const scaled = scaleProtocolTimeoutForComposition(base, { width: 3840, height: 2160 });
    expect(scaled).toBeGreaterThan(base);
    expect(scaled).toBe(base * 4);
  });

  it("clamps at the 30-minute ceiling for a pathological canvas", () => {
    // 8K == 16× area → 4.8M ms, clamped to the 30-minute ceiling.
    const scaled = scaleProtocolTimeoutForComposition(base, { width: 7680, height: 4320 });
    expect(scaled).toBe(1_800_000);
  });

  it("never lowers a base timeout that already exceeds the ceiling", () => {
    // Base above the 30-min ceiling + a large canvas: must not clamp below base.
    const highBase = 2_400_000;
    expect(
      scaleProtocolTimeoutForComposition(highBase, { width: 3840, height: 2160 }),
    ).toBeGreaterThanOrEqual(highBase);
  });

  it("returns the base timeout for degenerate dimensions", () => {
    expect(scaleProtocolTimeoutForComposition(base, { width: 0, height: 1080 })).toBe(base);
    expect(scaleProtocolTimeoutForComposition(base, { width: 1920, height: 0 })).toBe(base);
    expect(scaleProtocolTimeoutForComposition(base, { width: Number.NaN, height: 1080 })).toBe(
      base,
    );
  });
});
