import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderChunk } from "./renderChunk.js";

// Entry: renderChunk on a BeginFrame chunk with 4 workers. The capture stage is a stand-in that calls the
// check worker 0 would run on its own session; the BeginFrame liveness verdict is a fake the test sets.
const probe = vi.hoisted(() => ({ liveness: undefined as undefined | (() => Promise<boolean>) }));
const stage = vi.hoisted(() => ({
  calls: [] as {
    screenshot: boolean;
    verify: ((session: unknown) => Promise<void>) | undefined;
  }[],
  run: undefined as
    | undefined
    | ((call: number, input: { dedupPerfs: { captureMode: string }[] }) => Promise<never>),
}));

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  probeBeginFrameLiveness: () => probe.liveness?.(),
}));
vi.mock("../render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../render/stages/captureStage.js")>()),
  runCaptureStage: (input: {
    plan: { forceScreenshot: boolean };
    dedupPerfs: { captureMode: string }[];
    verifyFirstSession?: (session: unknown) => Promise<void>;
  }) => {
    stage.calls.push({ screenshot: input.plan.forceScreenshot, verify: input.verifyFirstSession });
    return stage.run?.(stage.calls.length, input) ?? Promise.reject(new Error("no stage"));
  },
}));
vi.mock("../render/stages/encodeStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../render/stages/encodeStage.js")>()),
  canEncodeWhileCapturing: () => false,
}));
vi.mock("../fileServer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fileServer.js")>()),
  createFileServer: async () => ({ url: "http://127.0.0.1:1", port: 1, close: () => {} }),
}));
vi.mock("../render/stages/freezePlan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../render/stages/freezePlan.js")>()),
  recomputePlanHashFromPlanDir: () => "plan-hash",
}));
vi.mock("./shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared.js")>()),
  readFfmpegVersion: async () => "ffmpeg-test",
}));

const STOP = new Error("stop after capture");
let planDir = "";

const firstWorkerSession = {
  page: {},
  launchCaptureMode: "beginframe",
  beginFrameTimeTicks: 0,
  beginFrameIntervalMs: 33,
};
const render = () => renderChunk(planDir, 0, join(planDir, "chunk.mp4"), { maxCaptureWorkers: 4 });

beforeEach(() => {
  stage.calls = [];
  stage.run = undefined;
  planDir = mkdtempSync(join(tmpdir(), "hf-chunk-overlap-"));
  const write = (path: string, value: unknown) =>
    writeFileSync(join(planDir, path), typeof value === "string" ? value : JSON.stringify(value));
  mkdirSync(join(planDir, "meta"));
  mkdirSync(join(planDir, "compiled"));
  write("plan.json", {
    planHash: "plan-hash",
    producerVersion: "test",
    ffmpegVersion: "ffmpeg-test",
    dimensions: { fpsNum: 30, fpsDen: 1, width: 16, height: 16, format: "mp4" },
  });
  write("meta/encoder.json", {
    browserGpuMode: "software",
    forceScreenshot: false,
    deviceScaleFactor: 1,
    encoder: "libx264-software",
    quality: "standard",
    runtimeEnv: {},
  });
  write("meta/chunks.json", [{ index: 0, startFrame: 0, endFrame: 240 }]);
  write("compiled/index.html", "<div></div>");
});
afterEach(() => {
  rmSync(planDir, { recursive: true, force: true });
});

it("a parallel BeginFrame chunk is checked on worker 0's own session, with no separate probe browser", async () => {
  probe.liveness = async () => true;
  stage.run = async () => {
    await stage.calls[0]?.verify?.(firstWorkerSession);
    throw STOP;
  };
  expect(await render().catch((error: unknown) => error)).toBe(STOP);
  expect(stage.calls).toHaveLength(1);
  expect(stage.calls[0]?.verify).toBeTypeOf("function");
});

it("a probe that finds BeginFrame stalled sends the whole chunk to screenshot capture", async () => {
  probe.liveness = async () => false;
  stage.run = async (call) => {
    if (call === 1) {
      await stage.calls[0]?.verify?.(firstWorkerSession).catch((error: Error) => {
        throw new Error(`[Parallel] Capture failed: worker 0: ${error.message}`);
      });
    }
    throw STOP;
  };
  expect(await render().catch((error: unknown) => error)).toBe(STOP);
  expect(stage.calls.map((call) => call.screenshot)).toEqual([false, true]);
  expect(stage.calls[1]?.verify).toBeUndefined();
});

it("a check that itself fails surfaces its own error, even one that looks like a BeginFrame failure, and is not retried", async () => {
  const failure = new Error("HeadlessExperimental.beginFrame: boom");
  probe.liveness = async () => {
    throw failure;
  };
  stage.run = async () => {
    await stage.calls[0]?.verify?.(firstWorkerSession).catch((error: Error) => {
      throw new Error(`[Parallel] Capture failed: worker 0: ${error.message}`);
    });
    throw STOP;
  };
  expect(await render().catch((error: unknown) => error)).toBe(failure);
  expect(stage.calls).toHaveLength(1);
});

it("a chunk whose first worker dies before its check still settles, failing with that error", async () => {
  const failure = new Error("Protocol error: Target closed");
  stage.run = async () => {
    throw failure;
  };
  expect(await render().catch((error: unknown) => error)).toBe(failure);
  expect(stage.calls).toHaveLength(1);
});

it("a BeginFrame failure before the check retries the chunk in screenshot mode and carries on instead of hanging", async () => {
  stage.run = async (call, input) => {
    if (call === 1) {
      throw new Error("[Parallel] Capture failed: worker 0: HeadlessExperimental.beginFrame boom");
    }
    input.dedupPerfs.push({ captureMode: "screenshot" });
    return undefined as never;
  };
  const outcome = await render().catch((error: unknown) => error);
  expect(stage.calls.map((call) => call.screenshot)).toEqual([false, true]);
  expect(outcome).toBeInstanceOf(Error);
  expect(outcome).not.toBe(STOP);
});
