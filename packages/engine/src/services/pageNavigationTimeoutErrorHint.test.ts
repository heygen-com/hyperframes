import { describe, expect, it } from "vitest";
import {
  augmentPageNavigationTimeoutError,
  isPageNavigationTimeoutError,
} from "./pageNavigationTimeoutErrorHint.js";

describe("augmentPageNavigationTimeoutError", () => {
  it("passes non-Navigation-timeout errors through unchanged (same instance)", () => {
    const original = new Error("Runtime.callFunctionOn timed out");
    const result = augmentPageNavigationTimeoutError(original, 60_000);
    expect(result).toBe(original);
    expect(result.message).toBe("Runtime.callFunctionOn timed out");
  });

  it("augments 'Navigation timeout of Xms exceeded' with the effective timeout", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000);
    expect(result).not.toBe(original);
    expect(result.message).toContain(original.message);
    expect(result.message).toContain(
      "HyperFrames effective page.goto navigation timeout: 60000 ms",
    );
  });

  it("includes the env + CLI + browser-path hints in the generic augmentation", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000);
    expect(result.message).toContain("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS");
    expect(result.message).toContain("--browser-timeout");
    expect(result.message).toContain("HYPERFRAMES_BROWSER_PATH");
  });

  it("preserves err.cause on the augmented error", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000);
    expect((result as Error & { cause?: unknown }).cause).toBe(original);
  });

  it("augments net::ERR_TIMED_OUT errors as well", () => {
    const original = new Error("net::ERR_TIMED_OUT at http://127.0.0.1:4173/index.html");
    const result = augmentPageNavigationTimeoutError(original, 120_000);
    expect(result).not.toBe(original);
    expect(result.message).toContain("HyperFrames effective page.goto navigation timeout: 120000");
  });

  it("coerces non-Error thrown values into Error without augmenting", () => {
    const result = augmentPageNavigationTimeoutError("plain string failure", 60_000);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("plain string failure");
    // Not augmented: coerced string doesn't match the Nav-timeout regex.
    expect(result.message).not.toContain("HyperFrames effective page.goto navigation timeout");
  });

  it("fires the darwin/arm64 + CSS 3D + audio Docker hint only when all three match", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000, {
      platform: "darwin",
      arch: "arm64",
      hasCss3D: true,
      hasAudio: true,
    });
    expect(result.message).toContain("ts=1784146416");
    expect(result.message).toContain("--docker");
    expect(result.message).toContain("CSS 3D rendering context");
  });

  it("does not surface the Docker hint on non-darwin platforms even when CSS 3D + audio are true", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000, {
      platform: "linux",
      arch: "x64",
      hasCss3D: true,
      hasAudio: true,
    });
    expect(result.message).not.toContain("ts=1784146416");
    expect(result.message).not.toContain("--docker");
    // Generic hints still fire.
    expect(result.message).toContain("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS");
    expect(result.message).toContain("HYPERFRAMES_BROWSER_PATH");
  });

  it("does not surface the Docker hint on darwin/x64 (Intel Macs)", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000, {
      platform: "darwin",
      arch: "x64",
      hasCss3D: true,
      hasAudio: true,
    });
    expect(result.message).not.toContain("ts=1784146416");
    expect(result.message).not.toContain("--docker");
  });

  it("does not surface the Docker hint on darwin/arm64 without CSS 3D", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000, {
      platform: "darwin",
      arch: "arm64",
      hasCss3D: false,
      hasAudio: true,
    });
    expect(result.message).not.toContain("ts=1784146416");
    expect(result.message).not.toContain("--docker");
  });

  it("does not surface the Docker hint on darwin/arm64 without audio", () => {
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000, {
      platform: "darwin",
      arch: "arm64",
      hasCss3D: true,
      hasAudio: false,
    });
    expect(result.message).not.toContain("ts=1784146416");
    expect(result.message).not.toContain("--docker");
  });

  it("does not surface the Docker hint when CSS 3D / audio inputs are unknown (fallback documented)", () => {
    // Current wire-up in renderOrchestrator passes hasCss3D: undefined because
    // no compile-time CSS-3D signal is threaded through the pipeline. The
    // Docker hint is intentionally strict about `=== true` — this test locks
    // that behaviour so a future compile-time hasCss3D scan can flip it on
    // by supplying the flag, without accidentally firing before then.
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000, {
      platform: "darwin",
      arch: "arm64",
      // hasCss3D + hasAudio omitted (undefined).
    });
    expect(result.message).not.toContain("ts=1784146416");
    expect(result.message).not.toContain("--docker");
    // Generic hints still fire.
    expect(result.message).toContain("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS");
    expect(result.message).toContain("HYPERFRAMES_BROWSER_PATH");
  });

  it("defaults platform/arch to the current process when context omits them", () => {
    // Regression: earlier draft required an explicit platform. Make sure the
    // helper still augments (with generic hints) when no context is passed.
    const original = new Error("Navigation timeout of 60000 ms exceeded");
    const result = augmentPageNavigationTimeoutError(original, 60_000);
    expect(result).not.toBe(original);
    expect(result.message).toContain("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS");
    expect(result.message).toContain("HYPERFRAMES_BROWSER_PATH");
  });
});

describe("isPageNavigationTimeoutError", () => {
  it("returns true for matching messages", () => {
    expect(isPageNavigationTimeoutError(new Error("Navigation timeout of 60000 ms exceeded"))).toBe(
      true,
    );
    expect(isPageNavigationTimeoutError("net::ERR_TIMED_OUT")).toBe(true);
  });

  it("returns false for non-matching messages", () => {
    expect(isPageNavigationTimeoutError(new Error("Runtime.callFunctionOn timed out"))).toBe(false);
    expect(isPageNavigationTimeoutError(new Error("Target closed"))).toBe(false);
    expect(isPageNavigationTimeoutError(null)).toBe(false);
    expect(isPageNavigationTimeoutError(undefined)).toBe(false);
    expect(isPageNavigationTimeoutError(42)).toBe(false);
  });
});
