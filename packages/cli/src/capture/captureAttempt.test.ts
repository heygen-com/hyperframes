import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { captureWebsiteAttempt } from "./captureAttempt.js";
import { CaptureDirRefusedError } from "./captureErrors.js";
import type { CaptureWatchdog } from "./captureWatchdog.js";
import { createPartialCaptureState } from "./partialCapture.js";

const { ensureBrowserMock } = vi.hoisted(() => ({
  ensureBrowserMock: vi.fn(async () => {
    throw new Error("the browser must not start");
  }),
}));
vi.mock("../browser/manager.js", () => ({ ensureBrowser: ensureBrowserMock }));

const watchdog: CaptureWatchdog = {
  expired: () => false,
  promise: new Promise(() => {}),
  registerBrowser: () => {},
  unregisterBrowser: () => {},
  dispose: () => {},
};

describe("captureWebsiteAttempt output folders", () => {
  // Creating symlinks needs elevated rights on Windows.
  it.skipIf(process.platform === "win32").each(["extracted", "screenshots", "assets"])(
    "refuses a planted %s/ symlink before the browser starts (#4304)",
    async (link) => {
      const root = mkdtempSync(join(tmpdir(), "hf-capture-attempt-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const outputDir = join(root, "capture");
      const outside = join(root, "outside");
      mkdirSync(outputDir);
      mkdirSync(outside);
      symlinkSync(outside, join(outputDir, link));
      const opts = { url: "https://example.com", outputDir };

      await expect(
        captureWebsiteAttempt(opts, undefined, false, watchdog, createPartialCaptureState(opts)),
      ).rejects.toThrow(CaptureDirRefusedError);

      expect(readdirSync(outside)).toEqual([]);
      expect(ensureBrowserMock).not.toHaveBeenCalled();
    },
  );
});
