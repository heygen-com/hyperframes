import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { compositeHdrFrame } from "../../hdrCompositor.js";
import { captureSceneIntoBuffer, seekInjectAndQueryStacking } from "./captureHdrFrameShared.js";
import {
  type SequentialLoopInput,
  runSequentialLayeredFrameLoop,
} from "./captureHdrSequentialLoop.js";

vi.mock("./captureHdrFrameShared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./captureHdrFrameShared.js")>()),
  captureSceneIntoBuffer: vi.fn(async () => {}),
  seekInjectAndQueryStacking: vi.fn(async () => []),
}));
vi.mock("../../hdrCompositor.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hdrCompositor.js")>()),
  compositeHdrFrame: vi.fn(async () => {}),
}));

function windowInput(written: number[]): SequentialLoopInput {
  return {
    job: {
      config: { fps: { num: 30, den: 1 } },
      totalFrames: 10,
      framesRendered: 0,
      frameWindow: { startFrame: 100, endFrame: 110 },
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    width: 1,
    height: 1,
    totalFrames: 10,
    nativeHdrIds: new Set<string>(),
    nativeHdrImageIds: new Set<string>(),
    hdrCompositeCtx: {},
    hdrPerf: undefined,
    hdrEncoder: { writeFrame: async () => written.push(written.length) > 0 },
    domSession: { page: {} },
    transitionRanges: [
      { time: 0, duration: 0, shader: "crossfade", ease: "", fromScene: "a", toScene: "b" },
    ].map((t) => ({ ...t, startFrame: 104, endFrame: 106 })),
    sceneElements: { a: ["a"], b: ["b"] },
    compositeTransfer: "srgb",
    hdrTargetTransfer: undefined,
    hdrVideoEndTimes: new Map(),
    cleanedUpVideos: new Set(),
    hdrVideoFrameSources: new Map(),
    debugDumpEnabled: false,
    debugDumpDir: null,
    assertNotAborted: () => {},
    // The loop only touches the fields above.
  } as unknown as SequentialLoopInput;
}

it("seeks film frames and finds the film's transition inside a window", async () => {
  const written: number[] = [];
  await runSequentialLayeredFrameLoop(windowInput(written));

  const seeked = vi
    .mocked(seekInjectAndQueryStacking)
    .mock.calls.map((call) => Math.round(Number(call[1]) * 30));
  expect(seeked).toEqual(Array.from({ length: 10 }, (_, k) => 100 + k));
  // Two scenes per transition frame, film frames 104-106.
  const transitionFrames = vi
    .mocked(captureSceneIntoBuffer)
    .mock.calls.map(([args]) => args.frameIdx);
  expect(transitionFrames).toEqual([104, 104, 105, 105, 106, 106]);
  expect(written).toHaveLength(10);
});

it("starts a window without the HDR videos a whole render has already passed the end of", async () => {
  const input = windowInput([]);
  const close = vi.fn();
  input.hdrVideoEndTimes.set("ended", 1);
  input.hdrVideoEndTimes.set("playing", 5);
  // Ends between frames 99 and 100: a whole render still draws it at frame 100, then frees it.
  input.hdrVideoEndTimes.set("endsAtFirstFrame", 3.31);
  for (const id of ["ended", "playing", "endsAtFirstFrame"]) {
    const dir = mkdtempSync(join(tmpdir(), `hf-hdr-${id}-`));
    input.hdrVideoFrameSources.set(id, { dir, windows: { close } } as never);
  }
  let shownAtFirstFrame: string[] = [];
  vi.mocked(compositeHdrFrame).mockImplementationOnce(async () => {
    shownAtFirstFrame = [...input.hdrVideoFrameSources.keys()];
  });

  await runSequentialLayeredFrameLoop(input);

  expect(shownAtFirstFrame).toEqual(["playing", "endsAtFirstFrame"]);
});
