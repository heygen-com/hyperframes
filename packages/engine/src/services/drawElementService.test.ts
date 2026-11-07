import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import {
  classifyGpuRenderer,
  detectGpuBackend,
  detectSwiftShader,
  drawElementGate,
  resolveDrawElementCaptureMode,
} from "./drawElementService.js";
import { SOFTWARE_WEBGL_RENDERER_TOKENS } from "./browserManager.js";

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
      webglAvailable: true,
      renderer: "ANGLE (NVIDIA, D3D11 vs_5_0 ps_5_0, D3D11)",
    });
    expect(await detectGpuBackend(page)).toEqual({
      isSwiftShader: false,
      webglAvailable: true,
      renderer: "ANGLE (NVIDIA, D3D11 vs_5_0 ps_5_0, D3D11)",
    });
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
    const page = makePage({ isSwiftShader: false, webglAvailable: false, renderer: null });
    await detectGpuBackend(page);
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      SOFTWARE_WEBGL_RENDERER_TOKENS,
    );
  });
});

// ── detectGpuBackend: the in-page probe itself ────────────────────────────────
// The mocks above hand back a canned verdict, so none of them exercise the probe that
// produces it. These run the real in-page function against a stand-in `document`.

describe("detectGpuBackend in-page probe", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A page whose evaluate runs the probe against a fake canvas. */
  function pageWithCanvas(getContext: (type: string) => unknown): Page {
    vi.stubGlobal("document", { createElement: () => ({ getContext }) });
    return {
      evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
    } as unknown as Page;
  }

  /** The gate for a screenshot launch, where only the backend can close it. */
  const gateFor = (backend: Awaited<ReturnType<typeof detectGpuBackend>>) =>
    drawElementGate({ backend, launchCaptureMode: "screenshot", forceDE: false });

  const glWithRenderer = (renderer: string) => ({
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
    getParameter: () => renderer,
  });

  it("reads a host with no WebGL context as unavailable, not as a real GPU", async () => {
    const backend = await detectGpuBackend(pageWithCanvas(() => null));
    expect(backend).toEqual({ isSwiftShader: false, webglAvailable: false, renderer: null });
    expect(gateFor(backend)).toBe("webgl_unavailable");
  });

  it("reads a getContext that throws as unavailable too", async () => {
    const backend = await detectGpuBackend(
      pageWithCanvas(() => {
        throw new Error("GPU process crashed");
      }),
    );
    expect(backend.webglAvailable).toBe(false);
    expect(gateFor(backend)).toBe("webgl_unavailable");
  });

  it("leaves a real GPU unchanged: WebGL available, not software, gate open", async () => {
    const renderer = "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)";
    const backend = await detectGpuBackend(pageWithCanvas(() => glWithRenderer(renderer)));
    expect(backend).toEqual({ isSwiftShader: false, webglAvailable: true, renderer });
    expect(gateFor(backend)).toBeNull();
  });

  it("leaves real SwiftShader unchanged: software, gated as swiftshader", async () => {
    const renderer =
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)";
    const backend = await detectGpuBackend(pageWithCanvas(() => glWithRenderer(renderer)));
    expect(backend).toEqual({ isSwiftShader: true, webglAvailable: true, renderer });
    expect(gateFor(backend)).toBe("swiftshader");
  });

  it.each([
    ["llvmpipe", "ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)"],
    [
      "Microsoft Basic Render Driver",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)",
    ],
  ])("reads %s as software GL, gated like SwiftShader", async (_name, renderer) => {
    const backend = await detectGpuBackend(pageWithCanvas(() => glWithRenderer(renderer)));
    expect(backend).toEqual({ isSwiftShader: true, webglAvailable: true, renderer });
    expect(gateFor(backend)).toBe("swiftshader");
  });

  it("keeps a context whose renderer string is hidden as available (a real GL context)", async () => {
    const backend = await detectGpuBackend(
      pageWithCanvas(() => ({ getExtension: () => null, getParameter: () => "" })),
    );
    expect(backend).toEqual({ isSwiftShader: false, webglAvailable: true, renderer: null });
    expect(gateFor(backend)).toBeNull();
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

// ── drawElementGate ────────────────────────────────────────────────────────────

describe("drawElementGate", () => {
  const gpu = { isSwiftShader: false, webglAvailable: true };

  it("gates an opaque drawElement session launched for BeginFrame, even with a GPU backend", () => {
    expect(drawElementGate({ backend: gpu, launchCaptureMode: "beginframe", forceDE: false })).toBe(
      "beginframe_no_self_verify",
    );
  });

  it("lets a screenshot launch with a GPU backend engage", () => {
    expect(
      drawElementGate({ backend: gpu, launchCaptureMode: "screenshot", forceDE: false }),
    ).toBeNull();
  });

  it("names the backend before the launch mode, so a GPU-less BeginFrame host reads as webgl_unavailable", () => {
    const none = { isSwiftShader: false, webglAvailable: false };
    expect(
      drawElementGate({ backend: none, launchCaptureMode: "beginframe", forceDE: false }),
    ).toBe("webgl_unavailable");
    const soft = { isSwiftShader: true, webglAvailable: true };
    expect(
      drawElementGate({ backend: soft, launchCaptureMode: "beginframe", forceDE: false }),
    ).toBe("swiftshader");
  });

  it("lets HF_FORCE_DRAWELEMENT past the launch gate only, for R&D", () => {
    expect(
      drawElementGate({ backend: gpu, launchCaptureMode: "beginframe", forceDE: true }),
    ).toBeNull();
    const soft = { isSwiftShader: true, webglAvailable: true };
    expect(drawElementGate({ backend: soft, launchCaptureMode: "beginframe", forceDE: true })).toBe(
      "swiftshader",
    );
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
