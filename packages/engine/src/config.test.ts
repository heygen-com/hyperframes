import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, DEFAULT_CONFIG, scaleProtocolTimeoutForComposition } from "./config.js";
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
