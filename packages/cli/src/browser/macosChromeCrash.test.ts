import { describe, expect, it } from "vitest";
import { macosChromeCrashRemediation } from "./macosChromeCrash.js";

describe("macosChromeCrashRemediation", () => {
  it.each([
    ["darwin", "arm64"],
    ["darwin", "x64"],
    ["linux", "arm64"],
  ] as const)("returns undefined for unrelated errors on %s/%s", (platform, arch) => {
    expect(macosChromeCrashRemediation("Composition has zero duration", platform, arch)).toBe(
      undefined,
    );
  });

  it("returns undefined on Intel macOS for browser crash messages", () => {
    expect(macosChromeCrashRemediation("Page crashed!", "darwin", "x64")).toBe(undefined);
  });

  it("returns undefined on non-macOS platforms for browser crash messages", () => {
    expect(macosChromeCrashRemediation("Target closed", "linux", "arm64")).toBe(undefined);
    expect(macosChromeCrashRemediation("Target closed", "win32", "arm64")).toBe(undefined);
  });

  it.each(["Target closed", "Page crashed!"])(
    "returns Docker guidance on Apple Silicon macOS for %s",
    (message) => {
      const remediation = macosChromeCrashRemediation(message, "darwin", "arm64");

      expect(remediation).toBeDefined();
      expect(remediation).toContain("known chrome-headless-shell crash pattern");
      expect(remediation).toContain("HYPERFRAMES_DOCKER_PLATFORM=linux/amd64");
      expect(remediation).toContain("--docker");
      expect(remediation).toContain("native macOS browser");
      expect(remediation).toContain("HYPERFRAMES_BROWSER_PATH");
    },
  );
});
