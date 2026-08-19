import { afterEach, describe, expect, it } from "bun:test";
import {
  type CaptureSession,
  createFrameLookupTable,
  readWebGlVendorInfoFromCanvas,
  resolveConfig,
} from "@hyperframes/engine";
import {
  beginFrameSessionNeedsScreenshotFallback,
  createChunkVideoFrameInjectorFactory,
  createVerifiedDistributedCaptureSession,
  type ChunkResult,
  runCaptureWithScreenshotFallback,
  shouldRetryChunkCaptureWithScreenshot,
} from "./renderChunk.js";

const originalProbeTimeout = process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS;

afterEach(() => {
  if (originalProbeTimeout === undefined) {
    delete process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS;
  } else {
    process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS = originalProbeTimeout;
  }
});

describe("ChunkResult compatibility", () => {
  it("accepts a legacy or injected result that cannot report capture mode", () => {
    const result: ChunkResult = {
      outputPath: "/tmp/chunk.mp4",
      outputKind: "file",
      framesEncoded: 30,
      sha256: "abc",
      durationMs: 100,
      planHashMs: 1,
      sessionBootMs: 2,
      captureStageMs: 3,
      encodeStageMs: 4,
      workers: 1,
      perfPath: "/tmp/chunk.mp4.perf.json",
    };

    expect(result.captureMode).toBeUndefined();
  });
});

describe("distributed session isolation", () => {
  const captureOptions = {
    width: 320,
    height: 180,
    fps: { num: 30, den: 1 },
    format: "jpeg" as const,
  };

  function fakeSession(): CaptureSession {
    return {
      page: undefined as never,
      launchCaptureMode: "screenshot",
    } as CaptureSession;
  }

  it("verifies SwiftShader before initializing every distributed session", async () => {
    const calls: string[] = [];
    const session = fakeSession();
    const result = await createVerifiedDistributedCaptureSession(
      "http://127.0.0.1:1234",
      "/tmp/frames",
      captureOptions,
      resolveConfig(),
      {
        createCaptureSession: async () => {
          calls.push("create");
          return session;
        },
        assertSwiftShader: async () => {
          calls.push("assert");
        },
        initializeSession: async () => {
          calls.push("initialize");
        },
        closeCaptureSession: async () => {
          calls.push("close");
        },
        readWebGlVendorInfo: readWebGlVendorInfoFromCanvas,
      },
    );

    expect(result).toBe(session);
    expect(calls).toEqual(["create", "assert", "initialize"]);
  });

  it("closes a replacement session when verification fails", async () => {
    const calls: string[] = [];
    await expect(
      createVerifiedDistributedCaptureSession(
        "http://127.0.0.1:1234",
        "/tmp/frames",
        captureOptions,
        resolveConfig(),
        {
          createCaptureSession: async () => fakeSession(),
          assertSwiftShader: async () => {
            throw new Error("not SwiftShader");
          },
          initializeSession: async () => {
            throw new Error("must not initialize");
          },
          closeCaptureSession: async () => {
            calls.push("close");
          },
          readWebGlVendorInfo: readWebGlVendorInfoFromCanvas,
        },
      ),
    ).rejects.toThrow("not SwiftShader");
    expect(calls).toEqual(["close"]);
  });

  it("creates fresh stateful video injectors for separate workers and retries", () => {
    const factory = createChunkVideoFrameInjectorFactory(createFrameLookupTable([], []));
    const firstAttempt = factory();
    const screenshotRetry = factory();

    expect(firstAttempt).not.toBeNull();
    expect(screenshotRetry).not.toBeNull();
    expect(screenshotRetry).not.toBe(firstAttempt);
  });
});

describe("shouldRetryChunkCaptureWithScreenshot", () => {
  it("recognizes BeginFrame protocol and pending-frame failures", () => {
    for (const message of [
      "HeadlessExperimental.beginFrame timed out",
      "Protocol error (HeadlessExperimental.beginFrame): method wasn't found",
      "[BeginFrame] Frame still pending after 5 retries",
      "Another frame is pending",
    ]) {
      expect(shouldRetryChunkCaptureWithScreenshot(new Error(message))).toBe(true);
    }
  });

  it("does not hide cancellation, memory pressure, or unrelated failures", () => {
    expect(
      shouldRetryChunkCaptureWithScreenshot(
        new Error("render_cancelled during HeadlessExperimental.beginFrame"),
      ),
    ).toBe(false);
    expect(shouldRetryChunkCaptureWithScreenshot(new Error("JavaScript heap out of memory"))).toBe(
      false,
    );
    expect(shouldRetryChunkCaptureWithScreenshot(new Error("ffmpeg exited with code 1"))).toBe(
      false,
    );
  });
});

describe("runCaptureWithScreenshotFallback", () => {
  it("discards partial state and retries the whole chunk once in screenshot mode", async () => {
    const calls: string[] = [];
    const result = await runCaptureWithScreenshotFallback({
      forceScreenshot: false,
      run: async (forceScreenshot) => {
        calls.push(`run:${forceScreenshot ? "screenshot" : "beginframe"}`);
        if (!forceScreenshot) throw new Error("HeadlessExperimental.beginFrame timed out");
        return "captured";
      },
      resetForScreenshotRetry: () => {
        calls.push("reset");
      },
    });

    expect(result).toBe("captured");
    expect(calls).toEqual(["run:beginframe", "reset", "run:screenshot"]);
  });

  it("does not retry a screenshot attempt or retry the fallback twice", async () => {
    let screenshotCalls = 0;
    await expect(
      runCaptureWithScreenshotFallback({
        forceScreenshot: true,
        run: async () => {
          screenshotCalls++;
          throw new Error("HeadlessExperimental.beginFrame timed out");
        },
        resetForScreenshotRetry: () => {
          throw new Error("reset must not run");
        },
      }),
    ).rejects.toThrow("HeadlessExperimental.beginFrame timed out");
    expect(screenshotCalls).toBe(1);

    const modes: boolean[] = [];
    await expect(
      runCaptureWithScreenshotFallback({
        forceScreenshot: false,
        run: async (forceScreenshot) => {
          modes.push(forceScreenshot);
          throw new Error("HeadlessExperimental.beginFrame timed out");
        },
        resetForScreenshotRetry: () => {},
      }),
    ).rejects.toThrow("HeadlessExperimental.beginFrame timed out");
    expect(modes).toEqual([false, true]);
  });
});

describe("beginFrameSessionNeedsScreenshotFallback", () => {
  function session(
    launchCaptureMode: "beginframe" | "screenshot",
  ): Pick<
    CaptureSession,
    "page" | "launchCaptureMode" | "beginFrameTimeTicks" | "beginFrameIntervalMs"
  > {
    return {
      page: undefined as never,
      launchCaptureMode,
      beginFrameTimeTicks: 100,
      beginFrameIntervalMs: 10,
    };
  }

  it("uses the configured bounded timeout and a monotonic pre-frame tick", async () => {
    process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS = "1234";
    const args: unknown[][] = [];
    const fallback = await beginFrameSessionNeedsScreenshotFallback(
      session("beginframe"),
      async (...probeArgs) => {
        args.push(probeArgs);
        return false;
      },
    );

    expect(fallback).toBe(true);
    expect(args).toHaveLength(1);
    expect(args[0]?.slice(1)).toEqual([1234, 50, 10]);
  });

  it("keeps healthy BeginFrame and skips probing an existing screenshot session", async () => {
    let probes = 0;
    expect(
      await beginFrameSessionNeedsScreenshotFallback(session("beginframe"), async () => {
        probes++;
        return true;
      }),
    ).toBe(false);
    expect(
      await beginFrameSessionNeedsScreenshotFallback(session("screenshot"), async () => {
        probes++;
        return false;
      }),
    ).toBe(false);
    expect(probes).toBe(1);
  });
});
