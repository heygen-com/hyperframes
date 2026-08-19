import { describe, expect, it } from "vitest";
import { CaptureFailure, classifyCaptureFailure, isFatalCaptureFailure } from "./captureFailure.js";

describe("classifyCaptureFailure", () => {
  it.each([
    ["Target closed", "transient_browser"],
    ["Runtime.callFunctionOn timed out after 30000ms", "protocol_timeout"],
    ["Runtime.evaluate timed out", "protocol_timeout"],
    ["drawElement worker encode timed out (frame 42)", "protocol_timeout"],
    ["Waiting failed: 30000ms exceeded", "protocol_timeout"],
    ["JavaScript heap out of memory", "memory_exhaustion"],
    ["drawElement self-verify failed", "verification"],
    ["Composition has zero duration. Runtime ready: true", "authoring"],
  ] as const)("classifies %s as %s", (message, kind) => {
    expect(classifyCaptureFailure(new Error(message)).kind).toBe(kind);
  });

  it("lets the composed signal authoritatively classify cancellation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      classifyCaptureFailure(new Error("Target closed"), { signal: controller.signal }).kind,
    ).toBe("cancelled");
  });

  it("lets a later cancellation override an already typed transient failure", () => {
    const controller = new AbortController();
    const transient = new CaptureFailure({
      kind: "transient_browser",
      message: "Target closed",
      workerDiagnostics: [
        { workerId: 1, framesCaptured: 2, startFrame: 0, endFrame: 4, lines: ["Target closed"] },
      ],
    });
    controller.abort();

    const cancelled = classifyCaptureFailure(transient, { signal: controller.signal });

    expect(cancelled.kind).toBe("cancelled");
    expect(cancelled.cause).toBe(transient);
    expect(cancelled.workerDiagnostics).toEqual(transient.workerDiagnostics);
  });

  it("preserves cause and immutable worker diagnostics", () => {
    const cause = Object.assign(new Error("write failed"), { code: "ENOSPC" });
    const failure = classifyCaptureFailure(cause, {
      workerDiagnostics: [
        { workerId: 2, framesCaptured: 3, startFrame: 0, endFrame: 10, lines: ["disk full"] },
      ],
    });

    expect(failure.kind).toBe("io");
    expect(failure.cause).toBe(cause);
    expect(failure.workerDiagnostics[0]?.workerId).toBe(2);
    expect(Object.isFrozen(failure.workerDiagnostics)).toBe(true);
    expect(Object.isFrozen(failure.workerDiagnostics[0]?.lines)).toBe(true);
  });

  it("classifies repeated operation text in linear time", () => {
    const repeatedCopy = "copy".repeat(25_000);

    expect(classifyCaptureFailure(new Error(repeatedCopy)).kind).toBe("authoring");
    expect(classifyCaptureFailure(new Error(`${repeatedCopy} failed`)).kind).toBe("io");
    expect(classifyCaptureFailure(new Error("copy\nfailed")).kind).toBe("authoring");
  });

  it("marks structural failures fatal but leaves retryable failures non-fatal", () => {
    expect(
      isFatalCaptureFailure(new CaptureFailure({ kind: "authoring", message: "bad source" })),
    ).toBe(true);
    expect(
      isFatalCaptureFailure(
        new CaptureFailure({ kind: "protocol_timeout", message: "protocol timeout" }),
      ),
    ).toBe(false);
  });
});
