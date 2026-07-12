import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { detectSwiftShader, resolveDrawElementCaptureMode } from "./drawElementService.js";

// ── detectSwiftShader ──────────────────────────────────────────────────────────

describe("detectSwiftShader", () => {
  function makePage(evaluateResult: unknown): Page {
    return {
      evaluate: vi.fn().mockResolvedValue(evaluateResult),
    } as unknown as Page;
  }

  it("returns true when renderer includes 'swiftshader'", async () => {
    const page = makePage(true);
    expect(await detectSwiftShader(page)).toBe(true);
  });

  it("returns false for a standard GPU renderer string", async () => {
    const page = makePage(false);
    expect(await detectSwiftShader(page)).toBe(false);
  });

  it("returns false when WebGL is unavailable", async () => {
    const page = makePage(false);
    expect(await detectSwiftShader(page)).toBe(false);
  });

  it("passes a function to page.evaluate", async () => {
    const page = makePage(false);
    await detectSwiftShader(page);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
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
