import { describe, expect, it, vi } from "vitest";
import { createPartialCaptureState } from "./partialCapture.js";
import { CAPTURE_PHASE_SCHEMA } from "./types.js";
import type { CaptureOptions, CaptureResult } from "./types.js";
import { captureBrowserArgs } from "./browserLaunchArgs.js";
import { NavigationDeadlineError, PageStoppedRespondingError } from "./captureErrors.js";

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

  it.each([
    [new NavigationDeadlineError(new Error("timeout")), "Navigation timed out"],
    [
      new PageStoppedRespondingError("design token extraction"),
      "The page stopped responding during design token extraction",
    ],
  ])("retries %s and carries the degradation warning into the result", async (error, why) => {
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
    captureWebsiteAttemptMock.mockRejectedValueOnce(error).mockResolvedValueOnce(result);
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
    );
    expect(actual.warnings).toContain(`${why}; retrying once with WebGL disabled`);
    expect(phases).toContain("webgl-disabled-retry");
  });

  it("retries only once when the WebGL-off attempt stops too", async () => {
    const options: CaptureOptions = {
      url: "https://example.com",
      outputDir: "/tmp/hf-capture-test-retry-once",
    };
    captureWebsiteAttemptMock.mockReset();
    captureWebsiteAttemptMock
      .mockRejectedValueOnce(new NavigationDeadlineError(new Error("timeout")))
      .mockRejectedValueOnce(new PageStoppedRespondingError("Lottie DOM scan"));

    const { captureWebsite } = await import("./index.js");
    await expect(captureWebsite(options)).rejects.toThrow(
      "the page stopped responding during Lottie DOM scan",
    );
    expect(captureWebsiteAttemptMock).toHaveBeenCalledTimes(2);
  });
});
