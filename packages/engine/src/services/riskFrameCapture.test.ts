import { describe, expect, it } from "vitest";
import { captureFrameToBufferPipelined, captureFramesBatchPipelined } from "./frameCapture.js";
import { isDrawElementCaptureError } from "./drawElementCaptureError.js";
import type { CaptureSession } from "./frameCapture.js";

// A drawElement path handed a risk frame must fail the attempt before touching the page, so a
// caller that ignores deRiskFrames re-renders by screenshot instead of shipping damaged frames.
const session = {
  deRiskFrames: new Set([5]),
  isInitialized: true,
  options: { fps: { num: 30, den: 1 }, width: 1920, height: 1080 },
  page: new Proxy(
    {},
    {
      get() {
        throw new Error("the page must not be touched");
      },
    },
  ),
} as unknown as CaptureSession;

describe("drawElement capture of a risk frame", () => {
  it("is refused by the per-frame pipelined path", async () => {
    const failure = await captureFrameToBufferPipelined(session, 5, 5 / 30).catch((e) => e);
    expect(isDrawElementCaptureError(failure)).toBe(true);
  });

  it("is refused by the batch path when any frame of the batch is a risk frame", async () => {
    const failure = await captureFramesBatchPipelined(
      session,
      [3, 4, 5, 6],
      [0.1, 0.13, 0.17, 0.2],
    ).catch((e) => e);
    expect(isDrawElementCaptureError(failure)).toBe(true);
  });
});
