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

  // The producer's deployed runtime is Bun (JavaScriptCore), not Node (V8) —
  // none of the V8-specific patterns above match JSC's allocation-failure
  // message. Verified against real Bun behavior: `new
  // Uint8Array(Number.MAX_SAFE_INTEGER)`, an unbounded `Set`, and
  // `"x".repeat(2**53)` all throw exactly "Out of memory" under `bun run`.
  it("recognizes Bun/JavaScriptCore's exact OOM message", () => {
    expect(isMemoryExhaustionError(new Error("Out of memory"))).toBe(true);
    expect(isMemoryExhaustionError(new Error("out of memory"))).toBe(true);
    expect(isMemoryExhaustionError(new Error("Out of memory."))).toBe(true);
    expect(isMemoryExhaustionError(new Error("  Out of memory  "))).toBe(true);
  });

  // Exact-message match only — a compound message merely containing the
  // phrase (e.g. wrapped with extra context) must NOT trip this, same
  // rationale as the WebGL/GPU noise case above.
  it("does not match 'out of memory' as a mere substring of a longer message", () => {
    expect(isMemoryExhaustionError(new Error("Worker crashed: Out of memory during capture"))).toBe(
      false,
    );
  });

  // The parallel-DE capture path (the exact cohort the OOM-aware retry
  // targets) never delivers a bare message — executeParallelCapture /
  // formatWorkerFailure (parallelCoordinator.ts) wrap it as
  // "[Parallel] Capture failed: Worker N: <message>", optionally joined with
  // other workers' segments and/or suffixed "; diagnostics: ...". Confirmed
  // against the real wrapping logic (not a hand-typed guess at its shape).
  it("recognizes Bun's OOM message through this codebase's own parallel-worker error wrapping", () => {
    expect(
      isMemoryExhaustionError(new Error("[Parallel] Capture failed: Worker 2: Out of memory")),
    ).toBe(true);
    expect(
      isMemoryExhaustionError(
        new Error("[Parallel] Capture failed: Worker 1: net::ERR_FAILED; Worker 2: Out of memory"),
      ),
    ).toBe(true);
    expect(
      isMemoryExhaustionError(
        new Error(
          "[Parallel] Capture failed: Worker 2: Out of memory; diagnostics: ERROR foo | bar",
        ),
      ),
    ).toBe(true);
  });

  // The wrapped-worker-message pattern must stay as exact-match-per-segment
  // as the bare-message one — a worker's own error text merely containing
  // "out of memory" (e.g. surfaced WebGL/GPU noise) must not misclassify.
  it("does not match 'out of memory' as a mere substring inside a wrapped worker segment", () => {
    expect(
      isMemoryExhaustionError(
        new Error("Worker 2: WebGL context lost, out of memory reported by driver"),
      ),
    ).toBe(false);
  });
});
