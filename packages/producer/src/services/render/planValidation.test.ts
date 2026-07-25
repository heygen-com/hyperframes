/**
 * Tests for plan-time validators. Each validator pins both branches:
 *
 *   - PASS — the config is acceptable; no throw.
 *   - FAIL — the config trips a banned-in-distributed-mode rule; throws
 *     PlanValidationError with the expected typed `code`.
 */

import { describe, expect, it } from "bun:test";
import {
  BROWSER_GPU_NOT_SOFTWARE,
  DISTRIBUTED_DURATION_OUT_OF_RANGE,
  MAX_DISTRIBUTED_DURATION_SECONDS,
  MAX_RENDER_DURATION_SECONDS,
  PlanValidationError,
  RENDER_DURATION_OUT_OF_RANGE,
  SYSTEM_FONT_USED,
  parseFontFamilyValue,
  validateDistributedDuration,
  validateRenderDuration,
  validateNoGpuEncode,
  validateNoSystemFonts,
} from "./planValidation.js";

describe("PlanValidationError", () => {
  it("preserves the typed `code` field", () => {
    const err = new PlanValidationError("EXAMPLE_CODE", "msg");
    expect(err.code).toBe("EXAMPLE_CODE");
    expect(err.message).toBe("msg");
    expect(err.name).toBe("PlanValidationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("validateNoGpuEncode", () => {
  it("accepts a software-only config (no fields set)", () => {
    expect(() => validateNoGpuEncode({})).not.toThrow();
  });

  it("accepts useGpu=false + browserGpuMode='software'", () => {
    expect(() => validateNoGpuEncode({ useGpu: false, browserGpuMode: "software" })).not.toThrow();
  });

  it("accepts useGpu=undefined (in-process default) + browserGpuMode='software'", () => {
    expect(() => validateNoGpuEncode({ browserGpuMode: "software" })).not.toThrow();
  });

  it("throws BROWSER_GPU_NOT_SOFTWARE when useGpu === true", () => {
    let caught: unknown;
    try {
      validateNoGpuEncode({ useGpu: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(BROWSER_GPU_NOT_SOFTWARE);
    expect((caught as PlanValidationError).code).toBe("BROWSER_GPU_NOT_SOFTWARE");
    expect((caught as Error).message).toContain("GPU encode is banned");
    expect((caught as Error).message).toContain("useGpu === true");
  });

  it("throws BROWSER_GPU_NOT_SOFTWARE when browserGpuMode === 'auto'", () => {
    let caught: unknown;
    try {
      validateNoGpuEncode({ browserGpuMode: "auto" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(BROWSER_GPU_NOT_SOFTWARE);
    expect((caught as Error).message).toContain("Hardware browser GPU is banned");
    expect((caught as Error).message).toContain(`"auto"`);
  });

  it("throws BROWSER_GPU_NOT_SOFTWARE for any non-'software' browserGpuMode value", () => {
    for (const mode of ["hardware", "discrete", "any", "swiftshader-fallback"]) {
      let caught: unknown;
      try {
        validateNoGpuEncode({ browserGpuMode: mode });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PlanValidationError);
      expect((caught as PlanValidationError).code).toBe(BROWSER_GPU_NOT_SOFTWARE);
    }
  });

  it("checks useGpu BEFORE browserGpuMode so the useGpu message wins when both trip", () => {
    let caught: unknown;
    try {
      validateNoGpuEncode({ useGpu: true, browserGpuMode: "auto" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as Error).message).toContain("GPU encode is banned");
  });
});

describe("validateDistributedDuration", () => {
  it("keeps the generic validator and legacy distributed API behavior aligned", () => {
    expect(MAX_RENDER_DURATION_SECONDS).toBe(MAX_DISTRIBUTED_DURATION_SECONDS);
    expect(RENDER_DURATION_OUT_OF_RANGE).toBe(DISTRIBUTED_DURATION_OUT_OF_RANGE);
    expect(() =>
      validateRenderDuration({
        duration: MAX_RENDER_DURATION_SECONDS,
        totalFrames: MAX_RENDER_DURATION_SECONDS * 30,
        fps: 30,
      }),
    ).not.toThrow();
  });

  it("accepts a finite duration within the distributed ceiling", () => {
    expect(() =>
      validateDistributedDuration({
        duration: MAX_DISTRIBUTED_DURATION_SECONDS,
        totalFrames: MAX_DISTRIBUTED_DURATION_SECONDS * 30,
        fps: 30,
      }),
    ).not.toThrow();
  });

  it("throws DISTRIBUTED_DURATION_OUT_OF_RANGE for the engine's infinite-timeline sentinel", () => {
    let caught: unknown;
    try {
      validateDistributedDuration({
        duration: 10_000_000_000,
        totalFrames: 300_000_000_000,
        fps: 30,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(DISTRIBUTED_DURATION_OUT_OF_RANGE);
    expect((caught as Error).message).toContain("300000000000");
    expect((caught as Error).message).toContain("GSAP repeat:-1");
  });

  it("throws DISTRIBUTED_DURATION_OUT_OF_RANGE for non-finite or zero values", () => {
    for (const input of [
      { duration: Number.POSITIVE_INFINITY, totalFrames: 1, fps: 30 },
      { duration: 0, totalFrames: 1, fps: 30 },
      { duration: 1, totalFrames: 0, fps: 30 },
      { duration: 1, totalFrames: 1, fps: Number.NaN },
    ]) {
      let caught: unknown;
      try {
        validateDistributedDuration(input);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PlanValidationError);
      expect((caught as PlanValidationError).code).toBe(DISTRIBUTED_DURATION_OUT_OF_RANGE);
    }
  });
});

describe("parseFontFamilyValue", () => {
  it("splits a comma-separated list and strips whitespace + quotes", () => {
    expect(parseFontFamilyValue(`"Inter", -apple-system, sans-serif`)).toEqual([
      "Inter",
      "-apple-system",
      "sans-serif",
    ]);
  });

  it("strips single quotes too", () => {
    expect(parseFontFamilyValue(`'My Custom Font', serif`)).toEqual(["My Custom Font", "serif"]);
  });

  it("ignores empty entries (trailing commas)", () => {
    expect(parseFontFamilyValue(`Inter,,sans-serif`)).toEqual(["Inter", "sans-serif"]);
  });

  it("handles a single value with no commas", () => {
    expect(parseFontFamilyValue(`"My Font"`)).toEqual(["My Font"]);
  });

  it("handles an all-whitespace value as empty", () => {
    expect(parseFontFamilyValue(`   `)).toEqual([]);
  });

  it("keeps commas inside quotes and var() fallbacks", () => {
    expect(parseFontFamilyValue(`"ACME, Inc", var(--heading, "Montserrat Bold"), serif`)).toEqual([
      "ACME, Inc",
      `var(--heading, "Montserrat Bold")`,
      "serif",
    ]);
  });

  it("rejects stray production close-paren artifacts as invalid values", () => {
    expect(parseFontFamilyValue(`Montserrat Bold")`)).toEqual([]);
    expect(parseFontFamilyValue("serif)")).toEqual([]);
  });
});

describe("validateNoSystemFonts", () => {
  const CLEAN_HTML = `<!doctype html>
<html><head><style>
  body { font-family: "Inter", -apple-system, sans-serif; margin: 0; }
  h1 { font-family: "Montserrat", "Helvetica Neue", sans-serif; }
</style></head>
<body><h1 data-font-family="Outfit, sans-serif">Hello</h1></body>
</html>`;

  it("passes a composition with deterministic web fonts as primary", () => {
    expect(() => validateNoSystemFonts(CLEAN_HTML)).not.toThrow();
  });

  it("passes when font-family is absent entirely (plain text composition)", () => {
    expect(() =>
      validateNoSystemFonts(`<!doctype html><html><body><p>no fonts here</p></body></html>`),
    ).not.toThrow();
  });

  it("throws SYSTEM_FONT_USED when primary family is `-apple-system`", () => {
    const offending = `<style>body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }</style>`;
    let caught: unknown;
    try {
      validateNoSystemFonts(offending);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(SYSTEM_FONT_USED);
    expect((caught as PlanValidationError).code).toBe("SYSTEM_FONT_USED");
    expect((caught as Error).message).toContain(`"-apple-system"`);
    expect((caught as Error).message).toContain("font-family");
  });

  it("throws SYSTEM_FONT_USED when primary family is `system-ui`", () => {
    const offending = `<div style="font-family: system-ui, sans-serif">text</div>`;
    let caught: unknown;
    try {
      validateNoSystemFonts(offending);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(SYSTEM_FONT_USED);
    expect((caught as Error).message).toContain(`"system-ui"`);
  });

  it("throws SYSTEM_FONT_USED when primary family is `sans-serif` (CSS generic alone)", () => {
    const offending = `<style>.x { font-family: sans-serif; }</style>`;
    let caught: unknown;
    try {
      validateNoSystemFonts(offending);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(SYSTEM_FONT_USED);
    expect((caught as Error).message).toContain(`"sans-serif"`);
  });

  it("treats data-font-family= as a valid surface for the same check", () => {
    const offending = `<h1 data-font-family="ui-monospace, monospace">hi</h1>`;
    let caught: unknown;
    try {
      validateNoSystemFonts(offending);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(SYSTEM_FONT_USED);
    expect((caught as Error).message).toContain("data-font-family");
  });

  it("is case-insensitive (`SYSTEM-UI` is the same as `system-ui`)", () => {
    const offending = `<style>p { font-family: SYSTEM-UI, sans-serif; }</style>`;
    let caught: unknown;
    try {
      validateNoSystemFonts(offending);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(SYSTEM_FONT_USED);
  });

  it("accepts generic families when used only as fallbacks", () => {
    // The whole point: `font-family: "Inter", -apple-system, sans-serif` is
    // the canonical fallback chain. We want this to pass.
    const ok = `<style>body { font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif; }</style>`;
    expect(() => validateNoSystemFonts(ok)).not.toThrow();
  });

  it("resolves simple CSS var() primary aliases before rejecting system fonts", () => {
    const offending = `<style>
      :root { --ui-font: -apple-system, BlinkMacSystemFont, sans-serif; }
      body { font-family: var(--ui-font), sans-serif; }
    </style>`;
    let caught: unknown;
    try {
      validateNoSystemFonts(offending);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).code).toBe(SYSTEM_FONT_USED);
    expect((caught as Error).message).toContain(`"-apple-system"`);
  });

  it("accepts CSS var() primary aliases that resolve to deterministic fonts", () => {
    const ok = `<style>
      :root { --ui-font: "Inter", -apple-system, sans-serif; }
      body { font-family: var(--ui-font), sans-serif; }
    </style>`;
    expect(() => validateNoSystemFonts(ok)).not.toThrow();
  });

  it("accepts quoted family names containing commas and no-space function shapes", () => {
    const ok = `<style>
      body {
        font-family: "ACME, Inc", "ACME(Display)", "var(--Display)",
          var(--runtime), env(font-name), sans-serif;
      }
    </style>`;
    expect(() => validateNoSystemFonts(ok)).not.toThrow();
  });

  it("handles CSS-wide keywords explicitly without treating them as font files", () => {
    for (const keyword of ["inherit", "initial", "unset", "revert", "revert-layer"]) {
      expect(() =>
        validateNoSystemFonts(`<style>body { font-family: ${keyword}; }</style>`),
      ).not.toThrow();
    }
  });

  it("does not classify quoted generic or CSS-wide names as keywords, including through root vars", () => {
    const quoted = `<style>
      :root { --display: "system-ui"; }
      body { font-family: var(--display), sans-serif; }
      h1 { font-family: "inherit"; }
      h2 { font-family: "serif"; }
    </style>`;
    expect(() => validateNoSystemFonts(quoted)).not.toThrow();
  });

  it("does not guess an unresolved variable from its fallback", () => {
    const dynamic = `<style>
      body { font-family: var(--runtime-font, "Inter"), sans-serif; }
    </style>`;
    expect(() => validateNoSystemFonts(dynamic)).not.toThrow();
  });

  it("does not guess when a scoped declaration makes a :root value ambiguous", () => {
    const scoped = `<style>
      :root { --ui-font: "Inter"; }
      .system-card { --ui-font: system-ui; }
      body { font-family: var(--ui-font), sans-serif; }
    </style>`;
    expect(() => validateNoSystemFonts(scoped)).not.toThrow();
  });

  it("does not guess cyclic root variables", () => {
    const cyclic = `<style>
      :root { --heading: var(--body); --body: var(--heading, "Inter"); }
      body { font-family: var(--heading), sans-serif; }
    </style>`;
    expect(() => validateNoSystemFonts(cyclic)).not.toThrow();
  });

  it("malformed CSS invalidates only matching static aliases", () => {
    const differentName = `
      <style>:root { --ui-font: system-ui; }</style>
      <style>.broken { --other: "Outfit";</style>
      <style>body { font-family: var(--ui-font), sans-serif; }</style>`;
    expect(() => validateNoSystemFonts(differentName)).toThrow(PlanValidationError);

    const sameName = `
      <style>:root { --ui-font: system-ui; }</style>
      <style>.broken { --ui-font: "Outfit";</style>
      <style>body { font-family: var(--ui-font), sans-serif; }</style>`;
    expect(() => validateNoSystemFonts(sameName)).not.toThrow();
  });
});
