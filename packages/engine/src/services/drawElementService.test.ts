import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import {
  classifyGpuRenderer,
  detectGpuBackend,
  detectSwiftShader,
  resolveDrawElementCaptureMode,
} from "./drawElementService.js";

// ── detectGpuBackend / detectSwiftShader ───────────────────────────────────────

describe("detectGpuBackend", () => {
  function makePage(evaluateResult: unknown): Page {
    return {
      evaluate: vi.fn().mockResolvedValue(evaluateResult),
    } as unknown as Page;
  }

  it("carries the raw renderer string alongside the SwiftShader verdict", async () => {
    const page = makePage({
      isSwiftShader: false,
      renderer: "ANGLE (NVIDIA, D3D11 vs_5_0 ps_5_0, D3D11)",
    });
    expect(await detectGpuBackend(page)).toEqual({
      isSwiftShader: false,
      renderer: "ANGLE (NVIDIA, D3D11 vs_5_0 ps_5_0, D3D11)",
    });
  });

  it("reports null renderer when WebGL is unavailable", async () => {
    const page = makePage({ isSwiftShader: false, renderer: null });
    expect(await detectGpuBackend(page)).toEqual({ isSwiftShader: false, renderer: null });
  });

  it("detectSwiftShader wrapper returns true when renderer is SwiftShader", async () => {
    const page = makePage({ isSwiftShader: true, renderer: "Google SwiftShader" });
    expect(await detectSwiftShader(page)).toBe(true);
  });

  it("detectSwiftShader wrapper returns false for a hardware renderer", async () => {
    const page = makePage({ isSwiftShader: false, renderer: "ANGLE (Apple, ANGLE Metal)" });
    expect(await detectSwiftShader(page)).toBe(false);
  });

  it("passes a function to page.evaluate", async () => {
    const page = makePage({ isSwiftShader: false, renderer: null });
    await detectGpuBackend(page);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ── classifyGpuRenderer ────────────────────────────────────────────────────────

describe("classifyGpuRenderer", () => {
  it("buckets real ANGLE renderer strings to <backend>/<vendor>", () => {
    expect(
      classifyGpuRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)"),
    ).toBe("metal/apple");
    expect(
      classifyGpuRenderer(
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      ),
    ).toBe("d3d11/nvidia");
    expect(
      classifyGpuRenderer("ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)"),
    ).toBe("d3d11/intel");
    expect(classifyGpuRenderer("ANGLE (AMD, AMD Radeon RX 6800 Direct3D11 vs_5_0 ps_5_0)")).toBe(
      "d3d11/amd",
    );
    expect(classifyGpuRenderer("Google SwiftShader")).toBe("swiftshader/other");
  });

  it("drops the GPU model — the bucket must stay low cardinality", () => {
    // Two different NVIDIA cards must collapse to ONE bucket, otherwise the
    // property is unbounded and useless for aggregation.
    expect(classifyGpuRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11)")).toBe(
      classifyGpuRenderer("ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11)"),
    );
  });

  it("returns undefined for missing input rather than a bogus bucket", () => {
    expect(classifyGpuRenderer(null)).toBeUndefined();
    expect(classifyGpuRenderer(undefined)).toBeUndefined();
    expect(classifyGpuRenderer("")).toBeUndefined();
  });
});

// ── resolveDrawElementCaptureMode ──────────────────────────────────────────────

describe("resolveDrawElementCaptureMode", () => {
  // signature: (isSwiftShader, transparent)
  it("opaque + SwiftShader → screenshot (no GPU egress to skip — parity at best)", () => {
    expect(resolveDrawElementCaptureMode(true, false)).toBe("screenshot");
  });

  it("transparent + SwiftShader → screenshot (also drops sub-layers; crbug 521434899)", () => {
    expect(resolveDrawElementCaptureMode(true, true)).toBe("screenshot");
  });

  it("transparent + GPU → drawelement (GPU handles transparent correctly)", () => {
    expect(resolveDrawElementCaptureMode(false, true)).toBe("drawelement");
  });

  it("opaque + GPU → drawelement", () => {
    expect(resolveDrawElementCaptureMode(false, false)).toBe("drawelement");
  });

  // The <video> gate (proxy for the caption-pattern bug, crbug 521861819) was
  // removed once Chrome 151 fixed it — video comps now take the drawElement path.
});
