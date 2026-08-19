import { describe, it, expect } from "vitest";
import {
  isMacosOldChromeCrashError,
  macosOldChromeCrashRemediation,
} from "./macosOldChromeCrash.js";

describe("isMacosOldChromeCrashError", () => {
  it("matches Puppeteer launch-failure wrapper + dyld Symbol-not-found + macOS-13 VideoToolbox symbol", () => {
    expect(
      isMacosOldChromeCrashError(
        "Failed to launch the browser process!\n" +
          "dyld: Symbol not found: _kVTCompressionPropertyKey_ReferenceBufferCount\n" +
          "  Referenced from: /Users/x/.cache/puppeteer/chrome-headless-shell/mac-152.0.7928.2/chrome-headless-shell\n" +
          "  Expected in: /System/Library/Frameworks/VideoToolbox.framework/Versions/A/VideoToolbox",
      ),
    ).toBe(true);
  });

  it("matches the VideoToolbox framework signal even without the exact ReferenceBufferCount symbol name", () => {
    // Future pinned builds may hit a sibling VT symbol from the same framework
    // (they all migrated to macOS 13); the framework signal is enough to fire
    // the same remediation.
    expect(
      isMacosOldChromeCrashError(
        "Failed to launch the browser process. Symbol not found: _kVTSomeFutureSymbol from VideoToolbox",
      ),
    ).toBe(true);
  });

  it("does not match a launch failure without dyld Symbol-not-found", () => {
    expect(
      isMacosOldChromeCrashError(
        "Failed to launch the browser process (libnss3.so: cannot open shared object file)",
      ),
    ).toBe(false);
  });

  it("does not match a darwin Symbol-not-found from an unrelated framework (needs different remediation)", () => {
    expect(
      isMacosOldChromeCrashError(
        "Failed to launch the browser process. dyld: Symbol not found: _some_libcxx_symbol from libc++.dylib",
      ),
    ).toBe(false);
  });

  it("does not match the symbol name alone without the launch-failure wrapper", () => {
    expect(
      isMacosOldChromeCrashError(
        "unrelated tool crashed with Symbol not found: _kVTCompressionPropertyKey_ReferenceBufferCount",
      ),
    ).toBe(false);
  });

  it("does not match unrelated errors", () => {
    expect(isMacosOldChromeCrashError("Composition HTML is empty")).toBe(false);
  });
});

describe("macosOldChromeCrashRemediation", () => {
  it("returns undefined off darwin even for a matching error", () => {
    if (process.platform === "darwin") return;
    expect(
      macosOldChromeCrashRemediation(
        "Failed to launch the browser process. dyld: Symbol not found: _kVTCompressionPropertyKey_ReferenceBufferCount from VideoToolbox",
      ),
    ).toBeUndefined();
  });

  it("returns undefined for non-launch errors on any platform", () => {
    expect(macosOldChromeCrashRemediation("Composition HTML is empty")).toBeUndefined();
  });

  it("returns undefined for a launch failure without the dyld signal on any platform", () => {
    expect(
      macosOldChromeCrashRemediation(
        "Failed to launch the browser process (libnss3.so cannot open)",
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a darwin dyld failure from an unrelated framework", () => {
    if (process.platform !== "darwin") return;
    expect(
      macosOldChromeCrashRemediation(
        "Failed to launch the browser process. Symbol not found: _some_libcxx_symbol from libc++.dylib",
      ),
    ).toBeUndefined();
  });

  it("mentions HYPERFRAMES_BROWSER_PATH and the PRODUCER_HEADLESS_SHELL_PATH alias when firing on darwin", () => {
    if (process.platform !== "darwin") return;
    const remediation = macosOldChromeCrashRemediation(
      "Failed to launch the browser process. dyld: Symbol not found: _kVTCompressionPropertyKey_ReferenceBufferCount from VideoToolbox",
    );
    expect(remediation).toBeDefined();
    expect(remediation).toMatch(/HYPERFRAMES_BROWSER_PATH/);
    expect(remediation).toMatch(/PRODUCER_HEADLESS_SHELL_PATH/);
    expect(remediation).toMatch(/chrome-headless-shell@150/);
  });
});
