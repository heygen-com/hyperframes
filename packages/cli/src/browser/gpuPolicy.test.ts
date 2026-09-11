import { describe, expect, it } from "vitest";
import {
  assertWebGpuRequirement,
  compositionRequiresWebGpu,
  compositionUsesColorGrading,
  resolveLocalBrowserGpuMode,
} from "./gpuPolicy.js";

describe("local browser GPU policy", () => {
  it("defaults to auto and preserves explicit CLI/env overrides", () => {
    expect(resolveLocalBrowserGpuMode(undefined, undefined)).toBe("auto");
    expect(resolveLocalBrowserGpuMode(undefined, "hardware")).toBe("hardware");
    expect(resolveLocalBrowserGpuMode(undefined, "software")).toBe("software");
    expect(resolveLocalBrowserGpuMode(true, "software")).toBe("hardware");
    expect(resolveLocalBrowserGpuMode(false, "hardware")).toBe("software");
  });

  it("detects the explicit WebGPU capability marker on the composition root", () => {
    expect(
      compositionRequiresWebGpu(
        '<div data-requires-webgpu data-composition-id="gpu" data-duration="2"></div>',
      ),
    ).toBe(true);
    expect(compositionRequiresWebGpu('<div data-composition-id="dom"></div>')).toBe(false);
  });

  it("rejects an auto software fallback for required WebGPU compositions", () => {
    const html = '<div data-composition-id="gpu" data-requires-webgpu></div>';
    expect(() => assertWebGpuRequirement(html, "auto", "software")).toThrow(
      "PRODUCER_BROWSER_GPU_MODE=hardware",
    );
    expect(() => assertWebGpuRequirement(html, "hardware", "hardware")).not.toThrow();
    expect(() => assertWebGpuRequirement(html, "software", "software")).not.toThrow();
  });

  it("detects data-color-grading on any element, not just the composition root", () => {
    expect(
      compositionUsesColorGrading(
        '<div data-composition-id="main"><img data-color-grading=\'{"adjust":{"saturation":-1}}\' src="a.jpg" /></div>',
      ),
    ).toBe(true);
    expect(
      compositionUsesColorGrading('<div data-composition-id="main"><img src="a.jpg" /></div>'),
    ).toBe(false);
  });
});
