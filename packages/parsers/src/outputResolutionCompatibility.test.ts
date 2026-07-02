import { describe, it, expect } from "vitest";
import { checkOutputResolutionCompatibility } from "./outputResolutionCompatibility.js";

describe("checkOutputResolutionCompatibility", () => {
  it("returns ok when no outputResolution is requested", () => {
    expect(
      checkOutputResolutionCompatibility({
        compositionWidth: 1080,
        compositionHeight: 1920,
        outputResolution: undefined,
      }),
    ).toEqual({ ok: true });
  });

  it("returns ok when the preset matches the composition exactly", () => {
    expect(
      checkOutputResolutionCompatibility({
        compositionWidth: 1920,
        compositionHeight: 1080,
        outputResolution: "landscape",
      }).ok,
    ).toBe(true);
  });

  it("returns ok when supersampling by an integer factor (same aspect)", () => {
    // 1920×1080 composition, 4K landscape preset (3840×2160) → 2× DPR.
    expect(
      checkOutputResolutionCompatibility({
        compositionWidth: 1920,
        compositionHeight: 1080,
        outputResolution: "landscape-4k",
      }).ok,
    ).toBe(true);
  });

  describe("aspect-ratio mismatch (the dominant P1-3 failure)", () => {
    it("flags a landscape preset against a portrait composition and suggests portrait", () => {
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1080,
        compositionHeight: 1920,
        outputResolution: "landscape",
      });
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("aspect-mismatch");
      expect(result.suggestedResolution).toBe("portrait");
      expect(result.message).toContain("does not match the aspect ratio");
      expect(result.message).toContain("--resolution portrait");
    });

    it("preserves the 4K tier when suggesting a swap", () => {
      // portrait composition + landscape-4k preset → suggest portrait-4k, not portrait.
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1080,
        compositionHeight: 1920,
        outputResolution: "landscape-4k",
      });
      expect(result.suggestedResolution).toBe("portrait-4k");
      expect(result.message).toContain("--resolution portrait-4k");
    });

    it("flags a portrait preset against a landscape composition and suggests landscape", () => {
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1920,
        compositionHeight: 1080,
        outputResolution: "portrait",
      });
      expect(result.suggestedResolution).toBe("landscape");
    });

    it("does not suggest a preset for a custom aspect ratio with no preset match", () => {
      // 2000×1000 (2:1) has no matching preset → no unambiguous swap.
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 2000,
        compositionHeight: 1000,
        outputResolution: "portrait",
      });
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("aspect-mismatch");
      expect(result.suggestedResolution).toBeUndefined();
      expect(result.message).toContain("omit --resolution");
    });
  });

  describe("alpha / HDR incompatibility", () => {
    it("flags alpha output combined with outputResolution", () => {
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1920,
        compositionHeight: 1080,
        outputResolution: "landscape-4k",
        alphaRequested: true,
      });
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("alpha-incompatible");
      expect(result.message).toContain("alpha output");
      expect(result.message).toContain("--format mp4");
    });

    it("flags HDR combined with outputResolution", () => {
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1920,
        compositionHeight: 1080,
        outputResolution: "landscape-4k",
        hdrRequested: true,
      });
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("hdr-incompatible");
      expect(result.message).toContain("hdrMode='force-hdr'");
    });

    it("prioritizes HDR over aspect mismatch when both are wrong", () => {
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1080,
        compositionHeight: 1920,
        outputResolution: "landscape",
        hdrRequested: true,
      });
      expect(result.kind).toBe("hdr-incompatible");
    });
  });

  describe("scale constraints", () => {
    it("flags downsampling (preset smaller than composition)", () => {
      // 3840×2160 composition, landscape (1920×1080) preset → 0.5× DPR.
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 3840,
        compositionHeight: 2160,
        outputResolution: "landscape",
      });
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("downsampling");
    });

    it("flags a non-integer scale factor for a same-aspect custom composition", () => {
      // 1000×1000 (square aspect) + square preset (1080×1080) → 1.08× DPR.
      const result = checkOutputResolutionCompatibility({
        compositionWidth: 1000,
        compositionHeight: 1000,
        outputResolution: "square",
      });
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("non-integer-scale");
    });
  });
});
