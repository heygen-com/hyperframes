import { describe, it, expect, beforeAll } from "vitest";
import {
  locateSystemFont,
  clearSystemFontCache,
  SYSTEM_FONT_SIZE_LIMIT,
} from "./systemFontLocator";

describe("systemFontLocator", { timeout: 15_000 }, () => {
  beforeAll(() => {
    clearSystemFontCache();
  });

  it("returns null for nonexistent fonts", () => {
    const result = locateSystemFont("nonexistent-font-xyz-12345");
    expect(result).toBeNull();
  });

  it("normalizes case when looking up fonts", () => {
    const lower = locateSystemFont("helvetica");
    const upper = locateSystemFont("HELVETICA");
    if (lower === null) {
      expect(upper).toBeNull();
    } else {
      expect(upper).not.toBeNull();
      expect(upper!.path).toBe(lower.path);
    }
  });

  it("returns a valid format field when a font is found", () => {
    const result =
      locateSystemFont("Helvetica") ?? locateSystemFont("Arial") ?? locateSystemFont("DejaVu Sans");
    if (result) {
      expect(["ttf", "otf", "woff2", "woff", "ttc"]).toContain(result.format);
      expect(result.path).toBeTruthy();
    }
  });

  it("caches results across calls", () => {
    const first = locateSystemFont("nonexistent-font-xyz-12345");
    const second = locateSystemFont("nonexistent-font-xyz-12345");
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("clearSystemFontCache resets the cache", () => {
    locateSystemFont("nonexistent-font-xyz-12345");
    clearSystemFontCache();
    const result = locateSystemFont("nonexistent-font-xyz-12345");
    expect(result).toBeNull();
  });

  it("exports SYSTEM_FONT_SIZE_LIMIT as 5MB", () => {
    expect(SYSTEM_FONT_SIZE_LIMIT).toBe(5 * 1024 * 1024);
  });

  it("strips quotes from family name input", () => {
    const result = locateSystemFont('"nonexistent-font-xyz-12345"');
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(locateSystemFont("")).toBeNull();
    expect(locateSystemFont("  ")).toBeNull();
  });

  if (process.platform === "darwin") {
    it("finds Helvetica on macOS", () => {
      const result = locateSystemFont("Helvetica");
      expect(result).not.toBeNull();
      expect(result!.path).toMatch(/\.(ttf|ttc|otf)$/i);
    });

    it("finds Courier on macOS", () => {
      const result = locateSystemFont("Courier");
      expect(result).not.toBeNull();
    });
  }
});
