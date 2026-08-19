/** Tests for render failure-detail construction. */

import { describe, expect, it } from "vitest";
import { buildRenderErrorDetails } from "./cleanup.js";

describe("buildRenderErrorDetails", () => {
  const baseDiagnostics = { videoExtractionFailures: 0, imageDecodeFailures: 0 };

  it("extracts message + stack from Error instances", () => {
    const err = new Error("nope");
    const result = buildRenderErrorDetails({
      error: err,
      pipelineStartMs: Date.now() - 5000,
      lastBrowserConsole: [],
      perfStages: {},
      hdrDiagnostics: baseDiagnostics,
    });
    expect(result.message).toBe("nope");
    expect(result.stack).toBeDefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(5000);
    expect(typeof result.freeMemoryMB).toBe("number");
  });

  it("stringifies non-Error rejections", () => {
    const result = buildRenderErrorDetails({
      error: "raw string failure",
      pipelineStartMs: Date.now(),
      lastBrowserConsole: [],
      perfStages: {},
      hdrDiagnostics: baseDiagnostics,
    });
    expect(result.message).toBe("raw string failure");
    expect(result.stack).toBeUndefined();
  });

  it("includes browserConsoleTail only when buffer is non-empty (last 30 lines)", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const result = buildRenderErrorDetails({
      error: new Error("x"),
      pipelineStartMs: Date.now(),
      lastBrowserConsole: lines,
      perfStages: {},
      hdrDiagnostics: baseDiagnostics,
    });
    expect(result.browserConsoleTail).toHaveLength(30);
    expect(result.browserConsoleTail?.[0]).toBe("line 20");
    expect(result.browserConsoleTail?.[29]).toBe("line 49");
  });

  it("omits browserConsoleTail when buffer is empty", () => {
    const result = buildRenderErrorDetails({
      error: new Error("x"),
      pipelineStartMs: Date.now(),
      lastBrowserConsole: [],
      perfStages: {},
      hdrDiagnostics: baseDiagnostics,
    });
    expect(result.browserConsoleTail).toBeUndefined();
  });

  it("includes perfStages snapshot only when non-empty", () => {
    const empty = buildRenderErrorDetails({
      error: new Error("x"),
      pipelineStartMs: Date.now(),
      lastBrowserConsole: [],
      perfStages: {},
      hdrDiagnostics: baseDiagnostics,
    });
    expect(empty.perfStages).toBeUndefined();

    const populated = buildRenderErrorDetails({
      error: new Error("x"),
      pipelineStartMs: Date.now(),
      lastBrowserConsole: [],
      perfStages: { compileMs: 12, captureMs: 340 },
      hdrDiagnostics: baseDiagnostics,
    });
    expect(populated.perfStages).toEqual({ compileMs: 12, captureMs: 340 });
  });

  it("includes hdrDiagnostics only when at least one failure counter > 0", () => {
    const clean = buildRenderErrorDetails({
      error: new Error("x"),
      pipelineStartMs: Date.now(),
      lastBrowserConsole: [],
      perfStages: {},
      hdrDiagnostics: baseDiagnostics,
    });
    expect(clean.hdrDiagnostics).toBeUndefined();

    const failed = buildRenderErrorDetails({
      error: new Error("x"),
      pipelineStartMs: Date.now(),
      lastBrowserConsole: [],
      perfStages: {},
      hdrDiagnostics: { videoExtractionFailures: 2, imageDecodeFailures: 0 },
    });
    expect(failed.hdrDiagnostics).toEqual({ videoExtractionFailures: 2, imageDecodeFailures: 0 });
  });
});
