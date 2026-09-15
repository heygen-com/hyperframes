import { describe, expect, it } from "vitest";
import { classifyCaptureFailure, isLoopbackConnectionLoss } from "@hyperframes/engine";
import { CaptureStageError, wrapCaptureStageError } from "./captureStageError.js";
import { EncoderInterruptedError } from "./encoderInterruption.js";

describe("CaptureStageError", () => {
  it("carries the classified loopback endpoint through the streaming-stage wrapper", () => {
    const wrapped = wrapCaptureStageError(new Error("connect ETIMEDOUT ::1:49152"), ["console"]);

    expect(wrapped).toBeInstanceOf(CaptureStageError);
    expect(wrapped).toMatchObject({
      kind: "transient_browser",
      endpoint: { host: "::1", port: 49152 },
      browserConsole: ["console"],
    });
  });

  it("keeps the endpoint when the orchestrator re-classifies the stage error", () => {
    // Production path: captureStreamingStage throws wrapCaptureStageError(err)
    // and the orchestrator's catch calls classifyCaptureFailure on that result,
    // which early-returns the CaptureFailure it was handed.
    const wrapped = wrapCaptureStageError(
      new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:4173") }),
      [],
    );
    const controller = new AbortController();

    const reclassified = classifyCaptureFailure(wrapped, { signal: controller.signal });

    expect(reclassified).toBe(wrapped);
    expect(isLoopbackConnectionLoss(reclassified)).toBe(true);
    expect(reclassified.endpoint).toEqual({ host: "127.0.0.1", port: 4173 });
  });

  it("leaves a bare target loss without an endpoint", () => {
    const wrapped = wrapCaptureStageError(new Error("Target closed"), []);

    expect(wrapped).toMatchObject({ kind: "transient_browser" });
    expect((wrapped as CaptureStageError).endpoint).toBeUndefined();
  });

  it("passes encoder interruptions through unchanged", () => {
    const interrupted = new EncoderInterruptedError("Encoder interrupted", "SIGTERM");
    expect(wrapCaptureStageError(interrupted, [])).toBe(interrupted);
  });
});
