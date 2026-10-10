import { buildChromeArgs } from "@hyperframes/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocalBrowserGpuMode, resolveLocalWebGpu } from "./gpuPolicy.js";

// compositionRequiresWebGpu and assertWebGpuAdapterAvailable are implemented
// in @hyperframes/engine (browserManager.ts) and only re-exported here — see
// that package's browserManager.test.ts for their coverage.
describe("local browser GPU policy", () => {
  it("defaults to auto and preserves explicit CLI/env overrides", () => {
    expect(resolveLocalBrowserGpuMode(undefined, undefined)).toBe("auto");
    expect(resolveLocalBrowserGpuMode(undefined, "hardware")).toBe("hardware");
    expect(resolveLocalBrowserGpuMode(undefined, "software")).toBe("software");
    expect(resolveLocalBrowserGpuMode(true, "software")).toBe("hardware");
    expect(resolveLocalBrowserGpuMode(false, "hardware")).toBe("software");
  });
});

describe("resolveLocalWebGpu", () => {
  afterEach(() => vi.unstubAllEnvs());
  const launchArgs = (gpuConfig: ReturnType<typeof resolveLocalWebGpu>["gpuConfig"]) =>
    buildChromeArgs(
      { width: 640, height: 360, captureMode: "screenshot", requiresWebGpu: true },
      gpuConfig,
    );

  it("runs a WebGPU composition on SwiftShader in software mode when render's opt-in is set", () => {
    vi.stubEnv("PRODUCER_ALLOW_SOFTWARE_WEBGPU", "true");
    const { gpuConfig, softwareWebGpu } = resolveLocalWebGpu("software", true);
    expect(softwareWebGpu).toBe(true);
    expect(launchArgs(gpuConfig)).toContain("--use-vulkan=swiftshader");
  });

  it("stays off without the opt-in, on a GPU, or for a composition that does not need WebGPU", () => {
    vi.stubEnv("PRODUCER_ALLOW_SOFTWARE_WEBGPU", "");
    expect(resolveLocalWebGpu("software", true).softwareWebGpu).toBe(false);
    expect(launchArgs(resolveLocalWebGpu("software", true).gpuConfig)).not.toContain(
      "--use-vulkan=swiftshader",
    );
    vi.stubEnv("PRODUCER_ALLOW_SOFTWARE_WEBGPU", "true");
    expect(resolveLocalWebGpu("hardware", true).softwareWebGpu).toBe(false);
    expect(resolveLocalWebGpu("software", false).softwareWebGpu).toBe(false);
  });
});
