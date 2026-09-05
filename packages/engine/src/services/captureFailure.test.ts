import { describe, expect, it } from "vitest";
import { CaptureFailure, classifyCaptureFailure, isFatalCaptureFailure } from "./captureFailure.js";

describe("classifyCaptureFailure", () => {
  it.each([
    ["Target closed", "transient_browser"],
    ["connect ETIMEDOUT 127.0.0.1:49152", "transient_browser"],
    ["net::ERR_TIMED_OUT at http://localhost:49152/index.html", "transient_browser"],
    ["Runtime.callFunctionOn timed out after 30000ms", "protocol_timeout"],
    ["Runtime.evaluate timed out", "protocol_timeout"],
    [
      "Page.captureScreenshot timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
      "protocol_timeout",
    ],
    ["drawElement worker encode timed out (frame 42)", "protocol_timeout"],
    ["Waiting failed: 30000ms exceeded", "protocol_timeout"],
    ["JavaScript heap out of memory", "memory_exhaustion"],
    ["drawElement self-verify failed", "verification"],
    ["Composition has zero duration. Runtime ready: true", "authoring"],
    ["connect ETIMEDOUT 203.0.113.10:443", "authoring"],
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

  it("retains loopback endpoint provenance for capture diagnostics", () => {
    expect(classifyCaptureFailure(new Error("connect ETIMEDOUT 127.0.0.1:49152"))).toMatchObject({
      kind: "transient_browser",
      endpoint: { host: "127.0.0.1", port: 49152 },
    });
    expect(
      classifyCaptureFailure(new Error("net::ERR_TIMED_OUT at http://localhost:4173/index.html")),
    ).toMatchObject({ endpoint: { host: "localhost", port: 4173 } });
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
