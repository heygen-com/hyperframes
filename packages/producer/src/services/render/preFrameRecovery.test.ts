import { describe, expect, it, vi } from "vitest";
import { classifyCaptureFailure, CaptureFailure } from "@hyperframes/engine";
import {
  type LoopbackConnectionLoss,
  resolvePreFrameLoopbackLoss,
  recoverPreFrameFileServer,
} from "./preFrameRecovery.js";
import { wrapCaptureStageError } from "./captureStageError.js";

const lossFrom = (message: string) =>
  classifyCaptureFailure(new Error(message)) as LoopbackConnectionLoss;
const loopbackLoss = () => lossFrom("connect ETIMEDOUT ::1:49152");

describe("resolvePreFrameLoopbackLoss", () => {
  it("qualifies a loopback connection loss on a one-worker stream before the first frame", () => {
    expect(
      resolvePreFrameLoopbackLoss({
        failure: loopbackLoss(),
        workerCount: 1,
        framesRendered: 0,
      }),
    ).toBeDefined();
  });

  it("qualifies a stage-wrapped Node fetch failure with the errno in its cause", () => {
    const failure = wrapCaptureStageError(
      new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:49152") }),
      [],
    );
    expect(
      resolvePreFrameLoopbackLoss({
        failure: failure as CaptureFailure,
        workerCount: 1,
        framesRendered: 0,
      }),
    ).toBeDefined();
  });

  it.each([
    ["Target closed", "a SIGTERM-killed Chrome target"],
    ["Failed to launch the browser process! spawn ENOENT", "a browser that cannot launch"],
    ["Page crashed!", "a page crash"],
    ["Composition has zero duration. Runtime ready: false", "a runtime that never became ready"],
    ["Navigation timeout of 30000 ms exceeded", "a navigation timeout"],
    ["connect ETIMEDOUT 203.0.113.10:443", "a remote connect timeout"],
  ])("does not qualify %s (%s)", (message) => {
    const failure = classifyCaptureFailure(new Error(message));
    expect(
      resolvePreFrameLoopbackLoss({ failure, workerCount: 1, framesRendered: 0 }),
    ).toBeUndefined();
  });

  it("requires exactly one worker", () => {
    for (const workerCount of [0, 2, 4]) {
      expect(
        resolvePreFrameLoopbackLoss({
          failure: loopbackLoss(),
          workerCount,
          framesRendered: 0,
        }),
      ).toBeUndefined();
    }
  });

  it("requires that no frame has been written yet", () => {
    expect(
      resolvePreFrameLoopbackLoss({
        failure: loopbackLoss(),
        workerCount: 1,
        framesRendered: 1,
      }),
    ).toBeUndefined();
    expect(
      resolvePreFrameLoopbackLoss({
        failure: loopbackLoss(),
        workerCount: 1,
        framesRendered: 9_500,
      }),
    ).toBeUndefined();
  });

  it("does not qualify a cancelled failure even when it names a loopback endpoint", () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = classifyCaptureFailure(new Error("connect ETIMEDOUT ::1:49152"), {
      signal: controller.signal,
    });
    expect(cancelled.kind).toBe("cancelled");
    expect(
      resolvePreFrameLoopbackLoss({ failure: cancelled, workerCount: 1, framesRendered: 0 }),
    ).toBeUndefined();
  });
});

describe("recoverPreFrameFileServer", () => {
  const server = { url: "http://localhost:49152", port: 49152 };
  const replacement = { url: "http://localhost:50001", port: 50001 };

  it("restarts the file server when the probe reports it unhealthy", async () => {
    const restart = vi.fn(async () => replacement);
    const warn = vi.fn();

    await recoverPreFrameFileServer({
      failure: loopbackLoss(),
      fileServer: server,
      health: Promise.resolve({
        healthy: false,
        durationMs: 12,
        error: "fetch failed (ECONNREFUSED)",
      }),
      restart,
      log: { warn },
    });

    expect(restart).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[Render] Pre-frame capture endpoint health",
      expect.objectContaining({
        reportedEndpoint: "::1:49152",
        endpointOwner: "file_server",
        fileServerEndpoint: server.url,
        fileServerHealthy: false,
        healthProbeError: "fetch failed (ECONNREFUSED)",
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      "[Render] Recreated unhealthy file server before bounded capture retry",
      { fileServerEndpoint: replacement.url },
    );
  });

  it("keeps a healthy file server and never calls restart", async () => {
    const restart = vi.fn(async () => replacement);

    await recoverPreFrameFileServer({
      failure: loopbackLoss(),
      fileServer: server,
      health: Promise.resolve({ healthy: true, status: 200, durationMs: 3 }),
      restart,
      log: { warn: vi.fn() },
    });

    expect(restart).not.toHaveBeenCalled();
  });

  it("reports a foreign port as browser_or_unknown while still restarting on an unhealthy probe", async () => {
    const failure = lossFrom("net::ERR_CONNECTION_TIMED_OUT at http://localhost:9222/json/version");
    const restart = vi.fn(async () => replacement);
    const warn = vi.fn();

    await recoverPreFrameFileServer({
      failure,
      fileServer: server,
      health: Promise.resolve({
        healthy: false,
        durationMs: 1_008,
        error: "This operation was aborted",
      }),
      restart,
      log: { warn },
    });

    expect(warn).toHaveBeenCalledWith(
      "[Render] Pre-frame capture endpoint health",
      expect.objectContaining({ endpointOwner: "browser_or_unknown" }),
    );
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed restart instead of retrying against a dead server", async () => {
    await expect(
      recoverPreFrameFileServer({
        failure: loopbackLoss(),
        fileServer: server,
        health: Promise.resolve({ healthy: false, durationMs: 1 }),
        restart: async () => {
          throw new Error("EADDRINUSE");
        },
        log: { warn: vi.fn() },
      }),
    ).rejects.toThrow("EADDRINUSE");
  });
});
