import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
});

// fails without the fix: initSandboxRuntimeModular crashed in createPausedVideoFrames
// (MutationObserver.observe(document.body)), initVfx(document.body), and
// collectRuntimeTimelinePayload(root ?? document.body) when document.body was null.
it("initializes and tears down cleanly when document.body is null", () => {
  vi.spyOn(document, "body", "get").mockReturnValue(null as unknown as HTMLElement);
  initSandboxRuntimeModular();
  expect(typeof window.__hfRuntimeTeardown).toBe("function");
});
