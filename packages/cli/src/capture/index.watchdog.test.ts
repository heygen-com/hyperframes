import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPartialCaptureState } from "./partialCapture.js";
import { CAPTURE_PHASE_SCHEMA } from "./types.js";
import type { CaptureOptions, CaptureResult } from "./types.js";
import { captureBrowserArgs } from "./browserLaunchArgs.js";
import { NavigationDeadlineError } from "./captureErrors.js";
import type { CaptureWatchdog } from "./captureWatchdog.js";

const { captureWebsiteAttemptMock } = vi.hoisted(() => ({
  captureWebsiteAttemptMock: vi.fn(),
}));

vi.mock("./captureAttempt.js", () => ({
  captureWebsiteAttempt: captureWebsiteAttemptMock,
}));

describe("capture navigation retry launch", () => {
  it("uses the normal WebGL launch for the first attempt", () => {
    const args = captureBrowserArgs(false, 1920, 1080);
    expect(args).toContain("--enable-webgl");
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).not.toContain("--disable-gpu");
  });

  it("uses only the reduced GPU launch for the retry", () => {
    const args = captureBrowserArgs(true, 1920, 1080);
    expect(args).toContain("--disable-gpu");
    expect(args).not.toContain("--enable-webgl");
    expect(args).not.toContain("--use-angle=swiftshader");
    expect(args).not.toContain("--use-gl=angle");
  });

  it("retries a WebGL navigation deadline and carries the degradation warning into the result", async () => {
    const options: CaptureOptions = {
      url: "https://example.com",
      outputDir: "/tmp/hf-capture-test",
    };
    const partial = createPartialCaptureState(options);
    const result: CaptureResult = {
      ok: true,
      projectDir: options.outputDir,
      url: options.url,
      httpStatus: 200,
      title: "Example",
      extracted: partial.extracted,
      screenshots: [],
      tokens: partial.tokens,
      assets: [],
      dropped: partial.dropped,
      warnings: [],
      lastPhase: {
        schema: CAPTURE_PHASE_SCHEMA,
        phase: "complete",
        status: "completed",
        remainingMs: 1,
      },
    };
    captureWebsiteAttemptMock
      .mockRejectedValueOnce(new NavigationDeadlineError(new Error("timeout"), true))
      .mockResolvedValueOnce(result);
    const phases: string[] = [];

    const { captureWebsite } = await import("./index.js");
    const actual = await captureWebsite({
      ...options,
      onPhase: (event) => phases.push(event.reason ?? event.phase),
    });

    expect(captureWebsiteAttemptMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining(options),
      undefined,
      true,
      expect.anything(),
      expect.anything(),
      undefined,
    );
    expect(actual.warnings).toContain("Navigation timed out; retrying once with WebGL disabled");
    expect(phases).toContain("webgl-disabled-retry");
  });

  it("does not retry a navigation deadline without observed WebGL", async () => {
    const options: CaptureOptions = {
      url: "https://example.com",
      outputDir: "/tmp/hf-capture-test-no-webgl",
    };
    captureWebsiteAttemptMock.mockReset();
    captureWebsiteAttemptMock.mockRejectedValueOnce(
      new NavigationDeadlineError(new Error("timeout"), false),
    );

    const { captureWebsite } = await import("./index.js");
    await expect(captureWebsite(options)).rejects.toThrow("capture navigation timed out");
    expect(captureWebsiteAttemptMock).toHaveBeenCalledOnce();
  });
  it("a capture whose network step never answers ends at four minutes with its partial bundle", async () => {
    vi.useFakeTimers();
    try {
      const outputDir = mkdtempSync(join(tmpdir(), "hf-capture-deadline-"));
      captureWebsiteAttemptMock.mockImplementationOnce(
        (_opts, _progress, _webgl, watchdog: CaptureWatchdog) => {
          watchdog.registerBrowser({ close: async () => {} });
          return new Promise(() => {});
        },
      );
      const { captureWebsite } = await import("./index.js");
      let settled: CaptureResult | undefined;
      void captureWebsite({ url: "https://example.com", outputDir }).then((result) => {
        settled = result;
      });
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(settled?.lastPhase).toMatchObject({ status: "degraded", reason: "deadline" });
      expect(readdirSync(outputDir).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
