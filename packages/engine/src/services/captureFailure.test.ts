import { describe, expect, it } from "vitest";
import {
  CaptureFailure,
  classifyCaptureFailure,
  isFatalCaptureFailure,
  isLoopbackConnectionLoss,
} from "./captureFailure.js";

describe("classifyCaptureFailure", () => {
  it.each([
    ["Target closed", "transient_browser"],
    ["connect ETIMEDOUT 127.0.0.1:49152", "transient_browser"],
    ["connect ETIMEDOUT ::1:49152", "transient_browser"],
    ["connect ETIMEDOUT [::1]:49152", "transient_browser"],
    ["connect ECONNREFUSED ::1:49152", "transient_browser"],
    ["net::ERR_TIMED_OUT at http://localhost:49152/index.html", "transient_browser"],
    ["net::ERR_CONNECTION_TIMED_OUT at http://localhost:49152/index.html", "transient_browser"],
    ["net::ERR_CONNECTION_REFUSED at http://localhost:49152/index.html", "transient_browser"],
    ["net::ERR_CONNECTION_REFUSED at http://[::1]:49152/index.html", "transient_browser"],
    ["net::ERR_CONNECTION_CLOSED at http://localhost:49152/index.html", "transient_browser"],
    ["net::ERR_EMPTY_RESPONSE at http://127.0.0.1:49152/index.html", "transient_browser"],
    ["Runtime.callFunctionOn timed out after 30000ms", "protocol_timeout"],
    ["Runtime.evaluate timed out", "protocol_timeout"],
    ["Network.enable timed out. Increase the protocolTimeout setting.", "protocol_timeout"],
    ["[Parallel] Capture failed: Worker 0: Network.enable timed out", "protocol_timeout"],
    [
      "Page.captureScreenshot timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
      "protocol_timeout",
    ],
    ["drawElement worker encode timed out (frame 42)", "protocol_timeout"],
    ["Waiting failed: 30000ms exceeded", "protocol_timeout"],
    ["JavaScript heap out of memory", "memory_exhaustion"],
    ["drawElement self-verify failed", "verification"],
    ["Composition has zero duration. Runtime ready: true", "authoring"],
    ["Protocol error (Page.captureScreenshot): Unable to capture screenshot", "transient_browser"],
    [
      "[Parallel] Capture failed: Worker 0: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
      "transient_browser",
    ],
    // The timed-out variant of the same call stays protocol_timeout (checked first).
    ["Protocol error (Page.captureScreenshot): waiting for debugger timed out", "protocol_timeout"],
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

  it.each([
    ["connect ETIMEDOUT 127.0.0.1:49152", { host: "127.0.0.1", port: 49152 }],
    ["connect ETIMEDOUT ::1:49152", { host: "::1", port: 49152 }],
    ["connect ETIMEDOUT [::1]:49152", { host: "::1", port: 49152 }],
    ["connect ECONNREFUSED 127.0.0.1:49152", { host: "127.0.0.1", port: 49152 }],
    ["net::ERR_TIMED_OUT at http://localhost:4173/index.html", { host: "localhost", port: 4173 }],
    [
      "net::ERR_CONNECTION_TIMED_OUT at http://localhost:4173/index.html",
      { host: "localhost", port: 4173 },
    ],
    [
      "net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/index.html",
      { host: "127.0.0.1", port: 4173 },
    ],
    ["net::ERR_CONNECTION_REFUSED at http://[::1]:4173/", { host: "::1", port: 4173 }],
    // Chrome's spelling when the file server destroys live sockets mid-request.
    [
      "net::ERR_CONNECTION_CLOSED at http://localhost:4173/index.html",
      { host: "localhost", port: 4173 },
    ],
    [
      "net::ERR_EMPTY_RESPONSE at http://localhost:4173/index.html",
      { host: "localhost", port: 4173 },
    ],
  ] as const)("retains loopback endpoint provenance for %s", (message, endpoint) => {
    const failure = classifyCaptureFailure(new Error(message));
    expect(failure).toMatchObject({ kind: "transient_browser", endpoint });
    expect(isLoopbackConnectionLoss(failure)).toBe(true);
  });

  it("reads the loopback endpoint through a Node fetch wrapper's cause chain", () => {
    const wrapped = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ETIMEDOUT ::1:49152"), {
        code: "ETIMEDOUT",
        address: "::1",
        port: 49152,
      }),
    });

    const failure = classifyCaptureFailure(wrapped);

    expect(failure.kind).toBe("transient_browser");
    expect(failure.endpoint).toEqual({ host: "::1", port: 49152 });
    expect(failure.message).toBe("fetch failed");
    expect(failure.cause).toBe(wrapped);
  });

  it("reads the loopback endpoint out of a dual-stack AggregateError with an empty message", () => {
    const aggregate = new AggregateError(
      [
        new Error("connect ECONNREFUSED ::1:49152"),
        new Error("connect ECONNREFUSED 127.0.0.1:49152"),
      ],
      "",
    );
    const wrapped = new TypeError("fetch failed", { cause: aggregate });

    expect(classifyCaptureFailure(wrapped)).toMatchObject({
      kind: "transient_browser",
      endpoint: { host: "::1", port: 49152 },
    });
  });

  it("stops walking a cause chain deeper than five levels", () => {
    let error: Error = new Error("connect ETIMEDOUT ::1:49152");
    for (let depth = 0; depth < 5; depth++) error = new Error(`wrapper ${depth}`, { cause: error });

    expect(classifyCaptureFailure(error).endpoint).toBeUndefined();
  });

  it("keeps remote connection losses and bare target losses outside loopback recovery", () => {
    for (const message of [
      "connect ETIMEDOUT 203.0.113.10:443",
      "net::ERR_CONNECTION_REFUSED at https://example.com/",
      "Target closed",
      "Failed to launch the browser process! spawn ENOENT",
    ]) {
      const failure = classifyCaptureFailure(new Error(message));
      expect(failure.endpoint).toBeUndefined();
      expect(isLoopbackConnectionLoss(failure)).toBe(false);
    }
  });

  it("does not let a loopback host inside a protocol timeout override the timeout kind", () => {
    expect(
      classifyCaptureFailure(
        new Error("Page.captureScreenshot timed out\nconnect ETIMEDOUT 127.0.0.1:49152"),
      ).kind,
    ).toBe("protocol_timeout");
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
