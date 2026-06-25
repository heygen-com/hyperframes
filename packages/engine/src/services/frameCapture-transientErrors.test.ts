import { describe, expect, it } from "vitest";
import { isTransientBrowserError } from "./frameCapture.js";

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
  ])("returns true for transient error: %s", (message) => {
    expect(isTransientBrowserError(new Error(message))).toBe(true);
  });

  it.each([
    "net::ERR_NAME_NOT_RESOLVED",
    "FONT_FETCH_FAILED: Inter",
    "Composition duration is 0",
    "SYSTEM_FONT_USED: -apple-system",
    "",
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
