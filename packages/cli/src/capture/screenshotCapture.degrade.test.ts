import { describe, expect, it, onTestFinished, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimeoutError } from "puppeteer-core";
import type { Page } from "puppeteer-core";
import { captureScrollScreenshots } from "./screenshotCapture.js";

describe("captureScrollScreenshots degradation", () => {
  it("rethrows protocol evaluate timeouts for the caller warning path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-scroll-degrade-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const page = {
      evaluate: vi.fn(async () => {
        throw new TimeoutError(
          "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
        );
      }),
      screenshot: vi.fn(),
    } as unknown as Page;

    await expect(
      captureScrollScreenshots(page, dir, { remainingMs: () => 5_000 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
