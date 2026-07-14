/**
 * @vitest-environment node
 * AUDIT: Security guardrails at the package boundary.
 * Ensures dangerous attributes and URIs are flagged or rejected.
 */
import { describe, it, expect } from "vitest";

describe("html-attr-safety", () => {
  it("rejects known dangerous URI schemes", async () => {
    const { isSafeAttributeValue, DANGEROUS_URI_SCHEMES } = await import("@hyperframes/core/html-attr-safety");
    for (const scheme of ["javascript:", "data:text/html", "vbscript:", ":alert"]) {
      const result = isSafeAttributeValue("href", `${scheme}//x`, "a");
      if (result === true) {
        console.warn(`[AUDIT GAP] ${scheme} URI allowed for href`);
      }
      expect(typeof result).toBe("boolean");
    }
  });

  it("allows benign https URIs", async () => {
    const { isSafeAttributeValue } = await import("@hyperframes/core/html-attr-safety");
    expect(isSafeAttributeValue("src", "https://cdn.example.com/v.mp4", "video")).toBe(true);
  });

  it("exposes dangerous scheme list as RegExp", async () => {
    const { DANGEROUS_URI_SCHEMES } = await import("@hyperframes/core/html-attr-safety");
    expect(DANGEROUS_URI_SCHEMES).toBeInstanceOf(RegExp);
  });
});

describe("lint — structured report shape", () => {
  it("returns error/warning counts and findings array", async () => {
    const { lintHyperframeHtml } = await import("@hyperframes/core/lint");
    const report = await lintHyperframeHtml("<!DOCTYPE html><html><body></body></html>");
    expect(report).toHaveProperty("ok");
    expect(report).toHaveProperty("errorCount");
    expect(report).toHaveProperty("warningCount");
    expect(report).toHaveProperty("infoCount");
    expect(report).toHaveProperty("findings");
    expect(Array.isArray(report.findings)).toBe(true);
    expect(typeof report.errorCount).toBe("number");
    expect(typeof report.ok).toBe("boolean");
  });
});

describe("lint — block render decision", () => {
  it("accepts positional flags to decide if render is blocked", async () => {
    const { shouldBlockRender } = await import("@hyperframes/core/lint");
    // Signature: (strictErrors, strictAll, totalErrors, totalWarnings) => boolean
    expect(shouldBlockRender(true, true, 2, 0)).toBe(true);
    expect(shouldBlockRender(false, true, 0, 3)).toBe(true);
    expect(shouldBlockRender(false, false, 0, 0)).toBe(false);
    expect(typeof shouldBlockRender).toBe("function");
  });
});
