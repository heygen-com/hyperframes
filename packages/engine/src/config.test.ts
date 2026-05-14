import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig, DEFAULT_CONFIG } from "./config.js";

describe("resolveConfig", () => {
  const savedEnv = new Map<string, string | undefined>();

  function setEnv(key: string, value: string) {
    savedEnv.set(key, process.env[key]);
    process.env[key] = value;
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
});
