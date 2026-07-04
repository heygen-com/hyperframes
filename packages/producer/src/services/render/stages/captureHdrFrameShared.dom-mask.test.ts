import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementStackingInfo } from "@hyperframes/engine";
import {
  applyDomLayerMask,
  blitRgba8OverRgb48le,
  captureAlphaPng,
  decodePng,
  removeDomLayerMask,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../../logger.js";
import type { HdrCompositeContext } from "../../hdrCompositor.js";
import { captureSceneIntoBuffer } from "./captureHdrFrameShared.js";

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...actual,
    applyDomLayerMask: vi.fn(async () => undefined),
    captureAlphaPng: vi.fn(async () => Buffer.from("png")),
    decodePng: vi.fn(() => ({ data: Buffer.alloc(4), width: 1, height: 1 })),
    removeDomLayerMask: vi.fn(async () => undefined),
    blitRgba8OverRgb48le: vi.fn(),
  };
});

function makeEl(id: string, overrides?: Partial<ElementStackingInfo>): ElementStackingInfo {
  return {
    id,
    zIndex: 0,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    layoutWidth: 1,
    layoutHeight: 1,
    opacity: 1,
    visible: true,
    renderFrameVisible: false,
    isHdr: false,
    transform: "none",
    borderRadius: [0, 0, 0, 0],
    objectFit: "fill",
    objectPosition: "50% 50%",
    clipRect: null,
    ...overrides,
  };
}

function makeContext(): HdrCompositeContext {
  return {
    log: makeLogger(),
    domSession: { page: { evaluate: vi.fn() } } as never,
    beforeCaptureHook: null,
    width: 1,
    height: 1,
    fps: 30,
    compositeTransfer: "srgb",
    nativeHdrImageIds: new Set(),
    hdrImageBuffers: new Map(),
    hdrImageTransferCache: new Map(),
    hdrVideoFrameSources: new Map(),
    hdrVideoStartTimes: new Map(),
    imageTransfers: new Map(),
    videoTransfers: new Map(),
    debugDumpEnabled: false,
    debugDumpDir: null,
  };
}

function makeLogger(): ProducerLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ProducerLogger;
}

describe("captureSceneIntoBuffer", () => {
  beforeEach(() => {
    vi.mocked(applyDomLayerMask).mockClear();
    vi.mocked(captureAlphaPng).mockClear();
    vi.mocked(decodePng).mockClear();
    vi.mocked(removeDomLayerMask).mockClear();
    vi.mocked(blitRgba8OverRgb48le).mockClear();
  });

  it("does not re-show hidden transition-scene members in the DOM mask", async () => {
    const page = { evaluate: vi.fn(async () => undefined) };

    await captureSceneIntoBuffer({
      session: { page, onBeforeCapture: null } as never,
      sceneBuf: Buffer.alloc(6),
      sceneIds: new Set(["visible-overlay", "hidden-inner", "hidden-sdr-video"]),
      stackingInfo: [
        makeEl("visible-overlay"),
        makeEl("hidden-inner", { visible: false }),
        makeEl("hidden-sdr-video", { visible: false, renderFrameVisible: true }),
        makeEl("outside-scene"),
      ],
      time: 0.5,
      width: 1,
      height: 1,
      nativeHdrIds: new Set(),
      nativeHdrImageIds: new Set(),
      beforeCaptureHook: null,
      hdrCompositeCtx: makeContext(),
      compositeTransfer: "srgb",
      hdrTargetTransfer: undefined,
      hdrPerf: undefined,
      log: makeLogger(),
      frameIdx: 15,
    });

    expect(applyDomLayerMask).toHaveBeenCalledWith(
      page,
      ["visible-overlay", "hidden-sdr-video"],
      ["outside-scene"],
    );
  });
});
