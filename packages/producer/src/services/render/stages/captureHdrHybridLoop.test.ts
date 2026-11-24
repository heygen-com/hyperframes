import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShaderBlendRequest } from "../../shaderTransitionWorkerPool.js";
import { type HybridLoopInput, runHybridLayeredFrameLoop } from "./captureHdrHybridLoop.js";

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  createCaptureSession: vi.fn(async () => ({ page: {} })),
  initializeSession: vi.fn(async () => {}),
  initTransparentBackground: vi.fn(async () => {}),
  closeCaptureSession: vi.fn(async () => {}),
}));
vi.mock("./captureHdrFrameShared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./captureHdrFrameShared.js")>()),
  captureTransitionFrameOnWorker: vi.fn(async () => {}),
  seekInjectAndQueryStacking: vi.fn(async () => ({})),
}));
vi.mock("../../hdrCompositor.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hdrCompositor.js")>()),
  compositeHdrFrame: vi.fn(async () => {}),
}));

let blendsInFlight = 0;
let blendsInFlightAtTerminate: number | undefined;
let failBlend = (_call: number) => false;
let blendCalls = 0;
const pool = {
  size: 2,
  run: vi.fn(async (req: ShaderBlendRequest) => {
    const call = ++blendCalls;
    blendsInFlight++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      if (failBlend(call)) throw new Error("blend failed");
      return { bufferA: req.bufferA, bufferB: req.bufferB, output: req.output };
    } finally {
      blendsInFlight--;
    }
  }),
  terminate: vi.fn(async () => {
    blendsInFlightAtTerminate = blendsInFlight;
  }),
};
vi.mock("../../shaderTransitionWorkerPool.js", () => ({
  createShaderTransitionWorkerPool: vi.fn(async () => pool),
}));

function loopInput(overrides: {
  writeFrame?: (frame: number) => boolean;
  assertNotAborted?: () => void;
}): HybridLoopInput {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  let frame = 0;
  const input = {
    job: { config: { fps: { num: 30, den: 1 } }, totalFrames: 16, framesRendered: 0 },
    cfg: {},
    log,
    framesDir: "/tmp/unused",
    width: 1,
    height: 1,
    totalFrames: 16,
    nativeHdrIds: new Set<string>(),
    nativeHdrImageIds: new Set<string>(),
    hdrCompositeCtx: {},
    hdrPerf: undefined,
    hdrEncoder: {
      writeFrame: async () => (overrides.writeFrame ?? (() => true))(frame++),
      getExitError: () => "encoder exited",
    },
    domSession: { page: {} },
    fileServer: { url: "http://127.0.0.1:0" },
    buildCaptureOptions: () => ({}),
    createRenderVideoFrameInjector: () => undefined,
    transitionRanges: [
      {
        time: 0,
        duration: 0.5,
        shader: "crossfade",
        ease: "",
        fromScene: "a",
        toScene: "b",
        startFrame: 2,
        endFrame: 13,
      },
    ],
    sceneElements: { a: ["a"], b: ["b"] },
    compositeTransfer: "srgb",
    hdrTargetTransfer: undefined,
    workerCount: 2,
    debugDumpEnabled: false,
    debugDumpDir: null,
    assertNotAborted: overrides.assertNotAborted ?? (() => {}),
  };
  // The loop only touches the fields above; the rest of each type is not needed here.
  return input as unknown as HybridLoopInput;
}

describe("runHybridLayeredFrameLoop failures with 2 workers", () => {
  const escaped: unknown[] = [];
  const onUnhandled = (reason: unknown) => escaped.push(reason);
  beforeEach(() => {
    escaped.length = 0;
    blendCalls = 0;
    blendsInFlight = 0;
    blendsInFlightAtTerminate = undefined;
    failBlend = () => false;
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it("writes every frame and settles every blend when nothing fails", async () => {
    const input = loopInput({});
    await runHybridLayeredFrameLoop(input);
    expect(input.job.framesRendered).toBe(16);
    expect(blendsInFlightAtTerminate).toBe(0);
    expect(escaped).toEqual([]);
  });

  let aborts = 0;
  it.each([
    {
      name: "a blend fails",
      setup: () => {
        failBlend = (call) => call === 2;
        return loopInput({});
      },
      error: /blend failed/,
    },
    {
      name: "the encoder exits",
      setup: () => loopInput({ writeFrame: (frame) => frame < 5 }),
      error: /Streaming encoder exited/,
    },
    {
      name: "the render is cancelled mid-transition",
      setup: () => {
        aborts = 0;
        return loopInput({
          assertNotAborted: () => {
            if (++aborts === 9) throw new Error("render cancelled");
          },
        });
      },
      error: /render cancelled/,
    },
  ])(
    "$name: the loop fails with it, settles every blend, and leaves no rejection unobserved",
    async ({ setup, error }) => {
      await expect(runHybridLayeredFrameLoop(setup())).rejects.toThrow(error);
      await new Promise((r) => setTimeout(r, 50));
      expect(escaped).toEqual([]);
      expect(blendsInFlightAtTerminate).toBe(0);
    },
  );
});
