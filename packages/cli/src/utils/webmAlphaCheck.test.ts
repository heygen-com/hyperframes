import { describe, expect, it } from "vitest";
import { pixelFormatHasAlpha, webmAlphaAdvisory } from "./webmAlphaCheck.js";

describe("pixelFormatHasAlpha", () => {
  it("recognizes alpha-capable pixel formats", () => {
    for (const f of [
      "yuva420p",
      "yuva444p10le",
      "gbrap",
      "gbrap10le",
      "rgba",
      "bgra",
      "argb",
      "abgr",
      "ya8",
      "ya16le",
    ]) {
      expect(pixelFormatHasAlpha(f), f).toBe(true);
    }
  });

  it("rejects opaque pixel formats", () => {
    for (const f of ["yuv420p", "yuv444p", "yuv420p10le", "gbrp", "rgb24", "bgr0", ""]) {
      expect(pixelFormatHasAlpha(f), f).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(pixelFormatHasAlpha("  YUVA420P \n")).toBe(true);
    expect(pixelFormatHasAlpha(" YUV420P ")).toBe(false);
  });
});

describe("webmAlphaAdvisory", () => {
  it("warns when a webm output lost its requested alpha", () => {
    const msg = webmAlphaAdvisory("webm", "yuv420p");
    expect(msg).toBeDefined();
    expect(msg).toContain("yuv420p");
    expect(msg).toContain("--format mov");
  });

  it("stays silent when the webm output kept alpha", () => {
    expect(webmAlphaAdvisory("webm", "yuva420p")).toBeUndefined();
  });

  it("stays silent for non-webm formats (mp4 is intentionally opaque)", () => {
    expect(webmAlphaAdvisory("mp4", "yuv420p")).toBeUndefined();
    expect(webmAlphaAdvisory("mov", "yuva444p10le")).toBeUndefined();
  });

  it("stays silent when the pixel format could not be probed", () => {
    expect(webmAlphaAdvisory("webm", undefined)).toBeUndefined();
  });
});
