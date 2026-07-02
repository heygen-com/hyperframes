import { describe, expect, it } from "vitest";
import { isMemoryExhaustionError, isTransientBrowserError } from "./frameCapture.js";

describe("isTransientBrowserError", () => {
  it.each([
    "Navigating frame was detached",
    "Target closed",
    "Session closed. Most likely the page has been closed.",
    "Protocol error (Runtime.callFunctionOn): Target closed",
    "Navigation failed because browser has disconnected",
    "browser has disconnected",
    "Page crashed!",
    "Execution context was destroyed",
    "Cannot find context with specified id",
    "Failed to launch the browser process! TROUBLESHOOTING: https://pptr.dev/troubleshooting",
    "connect ECONNREFUSED 127.0.0.1:9222",
    "Navigation timeout of 60000 ms exceeded",
    // pollHfReady timed out before window.__renderReady flipped true — the
    // classic symptom of a slow/contended host (e.g. several renders running
    // concurrently); a fresh browser session on retry usually clears it.
    "[FrameCapture] Composition has zero duration.\n  Runtime ready: false, __player: true, __hf.seek: true, GSAP timeline: true, data-duration: 53.3s",
  ])("returns true for transient error: %s", (message) => {
    expect(isTransientBrowserError(new Error(message))).toBe(true);
  });

  it.each([
    "net::ERR_NAME_NOT_RESOLVED",
    "FONT_FETCH_FAILED: Inter",
    "Composition duration is 0",
    "SYSTEM_FONT_USED: -apple-system",
    "",
    // The runtime finished initializing (renderReady: true) and still reports
    // zero duration — a genuine authoring bug (no timeline, no data-duration),
    // not a transient host hiccup. Must keep fast-failing without a retry.
    "[FrameCapture] Composition has zero duration.\n  Runtime ready: true, __player: true, __hf.seek: true, GSAP timeline: false, data-duration: not set",
  ])("returns false for non-transient error: %s", (message) => {
    expect(isTransientBrowserError(new Error(message))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isTransientBrowserError("Navigating frame was detached")).toBe(true);
    expect(isTransientBrowserError("some other string")).toBe(false);
    expect(isTransientBrowserError(null)).toBe(false);
    expect(isTransientBrowserError(undefined)).toBe(false);
    expect(isTransientBrowserError(42)).toBe(false);
  });
});

describe("isMemoryExhaustionError", () => {
  it.each([
    "Set maximum size exceeded",
    "Map maximum size exceeded",
    "Invalid array length",
    "Invalid string length",
    "Array buffer allocation failed",
    "Cannot create a string longer than 0x1fffffe8 characters",
    "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
    "JavaScript heap out of memory",
  ])("returns true for memory-exhaustion error: %s", (message) => {
    expect(isMemoryExhaustionError(new Error(message))).toBe(true);
  });

  it.each([
    "Target closed",
    "Runtime.callFunctionOn timed out",
    "net::ERR_NAME_NOT_RESOLVED",
    "Composition duration is 0",
    "",
    // Deliberately NOT matched — a bare "out of memory" substring appears in
    // benign WebGL/GPU console noise; only the specific V8/Node allocation
    // signatures (and "JavaScript heap out of memory") count.
    "WebGL: CONTEXT_LOST_WEBGL loseContext: context out of memory",
    "GL_OUT_OF_MEMORY: out of memory",
  ])("returns false for non-memory error: %s", (message) => {
    expect(isMemoryExhaustionError(new Error(message))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isMemoryExhaustionError("Set maximum size exceeded")).toBe(true);
    expect(isMemoryExhaustionError("some other string")).toBe(false);
    expect(isMemoryExhaustionError(null)).toBe(false);
    expect(isMemoryExhaustionError(undefined)).toBe(false);
  });

  // A memory-exhaustion error is a resource ceiling, not a flaky-tab hiccup —
  // it must NOT be classified as transient (a retry re-hits the same wall).
  it("is disjoint from transient classification", () => {
    expect(isTransientBrowserError(new Error("Set maximum size exceeded"))).toBe(false);
    expect(isMemoryExhaustionError(new Error("Target closed"))).toBe(false);
  });
});
