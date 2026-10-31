import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderChunk } from "./renderChunk.js";

// Entry: renderChunk on a 4-worker screenshot chunk. The capture stage opens one attempt and hangs until it
// is aborted, then fails with a plain error, as a cancelled worker pool would.
const stage = vi.hoisted(() => ({
  input: undefined as
    | { job: { framesRendered?: number }; openAttempt?: () => AbortSignal }
    | undefined,
  attempt: undefined as AbortSignal | undefined,
}));

vi.mock("../render/stages/captureStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../render/stages/captureStage.js")>()),
  runCaptureStage: (input: NonNullable<typeof stage.input>) => {
    stage.input = input;
    const attempt = input.openAttempt?.();
    stage.attempt = attempt;
    return new Promise<never>((_, reject) =>
      attempt?.addEventListener("abort", () => reject(new Error("worker cancelled")), {
        once: true,
      }),
    );
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

const PENDING = Symbol("pending");
let planDir = "";
beforeEach(() => {
  stage.input = undefined;
  stage.attempt = undefined;
  planDir = mkdtempSync(join(tmpdir(), "hf-chunk-stall-"));
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
    forceScreenshot: true,
    deviceScaleFactor: 1,
    encoder: "libx264-software",
    quality: "standard",
    runtimeEnv: {},
  });
  write("meta/chunks.json", [{ index: 0, startFrame: 0, endFrame: 240 }]);
  write("compiled/index.html", "<div></div>");
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(planDir, { recursive: true, force: true });
});

it("a chunk whose capture stops landing frames fails typed a minute after its last frame", async () => {
  let settled: unknown = PENDING;
  void renderChunk(planDir, 0, join(planDir, "chunk.mp4"), { maxCaptureWorkers: 4 }).then(
    () => (settled = "completed"),
    (error: unknown) => (settled = error),
  );
  for (let turn = 0; turn < 500 && !stage.input; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!stage.input) throw new Error("capture stage never started");
  const { job } = stage.input;
  job.framesRendered = 1;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(settled).toBe(PENDING);
  await vi.advanceTimersByTimeAsync(10_000);
  for (let turn = 0; turn < 5_000 && settled === PENDING; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(settled).toMatchObject({ code: "RENDER_STAGE_STALLED", retryable: false });
  expect(stage.attempt?.reason).toBe(settled);
});
