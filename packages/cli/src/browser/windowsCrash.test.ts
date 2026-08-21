import { describe, it, expect } from "vitest";
import { isWindowsChromeCrashError, windowsChromeCrashRemediation } from "./windowsCrash.js";

describe("isWindowsChromeCrashError", () => {
  it("matches Puppeteer launch-failure wrapper + decimal exit code", () => {
    expect(
      isWindowsChromeCrashError(
        "Failed to launch the browser process! Code: 3221225595, with no stderr.",
      ),
    ).toBe(true);
  });

  it("matches Puppeteer launch-failure wrapper + hex exit code", () => {
    expect(
      isWindowsChromeCrashError("Failed to launch the browser process (exited with 0xC0000409)"),
    ).toBe(true);
  });

  it("matches Puppeteer launch-failure wrapper + named Windows status symbol", () => {
    expect(
      isWindowsChromeCrashError(
        "Failed to launch the browser process — STATUS_STACK_BUFFER_OVERRUN",
      ),
    ).toBe(true);
  });

  it("does not match a launch failure without the crash-code signal", () => {
    // Linux shared-library launch failures land in the sibling
    // chromeLaunchRemediation path, not this one.
    expect(
      isWindowsChromeCrashError(
        "Failed to launch the browser process (libnss3.so: cannot open shared object file)",
      ),
    ).toBe(false);
  });

  it("does not match the crash code alone without the launch-failure wrapper", () => {
    expect(isWindowsChromeCrashError("some other Windows process exited with 3221225595")).toBe(
      false,
    );
  });

  it("does not match unrelated errors", () => {
    expect(isWindowsChromeCrashError("Composition HTML is empty")).toBe(false);
  });
});

describe("windowsChromeCrashRemediation", () => {
  it("returns undefined off Windows even for a matching error", () => {
    if (process.platform === "win32") return;
    expect(
      windowsChromeCrashRemediation("Failed to launch the browser process! Code: 3221225595"),
    ).toBeUndefined();
  });

  it("returns undefined for non-launch errors on any platform", () => {
    expect(windowsChromeCrashRemediation("Composition HTML is empty")).toBeUndefined();
  });

  it("returns undefined for a launch failure without the crash code on any platform", () => {
    expect(
      windowsChromeCrashRemediation(
        "Failed to launch the browser process (libnss3.so cannot open)",
      ),
    ).toBeUndefined();
  });
});
