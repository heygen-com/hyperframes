import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderCancelBody, renderSuccessBody } from "./renderJsonResult.js";

describe("renderSuccessBody", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-render-json-body-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("carries the raw path and the stats the render reported", () => {
    const outputPath = join(dir, "out.mp4");
    writeFileSync(outputPath, Buffer.alloc(1234));
    expect(renderSuccessBody(outputPath, { durationMs: 53_200, renderTimeMs: 31_178 })).toEqual({
      ok: true,
      outputPath,
      durationMs: 53_200,
      renderTimeMs: 31_178,
      bytes: 1234,
    });
  });

  it("leaves durationMs out when the result has none", () => {
    const outputPath = join(dir, "out.mp4");
    writeFileSync(outputPath, "x");
    expect(renderSuccessBody(outputPath, { renderTimeMs: 7 })).toEqual({
      ok: true,
      outputPath,
      renderTimeMs: 7,
      bytes: 1,
    });
  });

  it("omits bytes for a directory output, such as png-sequence or hls", () => {
    const outputPath = join(dir, "frames");
    mkdirSync(outputPath);
    writeFileSync(join(outputPath, "frame-0001.png"), "png");
    expect(renderSuccessBody(outputPath, { renderTimeMs: 7 })).toEqual({
      ok: true,
      outputPath,
      renderTimeMs: 7,
    });
  });

  it("omits bytes when the output cannot be read", () => {
    const outputPath = join(dir, "missing.mp4");
    expect(renderSuccessBody(outputPath, { renderTimeMs: 7 })).toEqual({
      ok: true,
      outputPath,
      renderTimeMs: 7,
    });
  });

  it("keeps a path's own characters rather than terminal-wrapping them", () => {
    const outputPath = join("renders", "out final.mp4");
    expect(renderSuccessBody(outputPath, { renderTimeMs: 1 }).outputPath).toBe(outputPath);
  });
});

describe("renderCancelBody", () => {
  it.each([
    ["render_cancelled_by_sigint", "SIGINT"],
    ["render_cancelled_by_sigterm", "SIGTERM"],
    ["render_cancelled_by_sighup", "SIGHUP"],
  ])("derives the signal from %s", (reason, signal) => {
    expect(renderCancelBody(reason)).toEqual({
      ok: false,
      error: { code: "cancelled", signal, message: `Render cancelled: ${reason}` },
    });
  });

  it("has no object for a cancellation that no signal caused", () => {
    expect(renderCancelBody("render_cancelled_parent_exited")).toBeUndefined();
  });
});
