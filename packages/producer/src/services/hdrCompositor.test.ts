import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureSession, ElementStackingInfo } from "@hyperframes/engine";
import { applyDomLayerMask, blitRgb48leRegion, captureAlphaPng } from "@hyperframes/engine";
import {
  blitHdrVideoLayer,
  compositeHdrFrame,
  type HdrCompositeContext,
  selectDomLayerShowIds,
} from "./hdrCompositor.js";
import { createHdrImageTransferCache } from "./hdrImageTransferCache.js";
import { createHdrPerfCollector } from "./render/hdrPerf.js";

const state = vi.hoisted(() => {
  const showIds: string[] = [];
  return {
    showIds,
    transparentLower: false,
    read: vi.fn<
      (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number
    >(),
  };
});

vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  readSync: state.read,
}));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...actual,
    applyDomLayerMask: vi.fn(async (_page: unknown, showIds: string[]) => {
      state.showIds = showIds;
    }),
    removeDomLayerMask: vi.fn(async () => undefined),
    captureAlphaPng: vi.fn(async () => Buffer.from(state.showIds.join(","))),
    decodePng: vi.fn((png: Buffer) => ({
      width: 2,
      height: 2,
      data:
        png.toString() === "upper"
          ? Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
          : state.transparentLower
            ? Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            : Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
    })),
    blitRgb48leRegion: vi.fn(actual.blitRgb48leRegion),
  };
});

function makeEl(id: string, overrides?: Partial<ElementStackingInfo>): ElementStackingInfo {
  return {
    id,
    zIndex: 0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    layoutWidth: 1920,
    layoutHeight: 1080,
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

describe("selectDomLayerShowIds", () => {
  it("does not re-show hidden DOM elements while preserving visible injected video frames", () => {
    expect(
      selectDomLayerShowIds(
        ["visible-overlay", "hidden-later-scene", "hidden-sdr-video"],
        [
          makeEl("visible-overlay"),
          makeEl("hidden-later-scene", { visible: false }),
          makeEl("hidden-sdr-video", {
            visible: false,
            renderFrameVisible: true,
          }),
        ],
      ),
    ).toEqual(["visible-overlay", "hidden-sdr-video"]);
  });

  it("does not re-show opacity-zero scene members or their injected frames", () => {
    expect(
      selectDomLayerShowIds(
        ["active-overlay", "inactive-scene-video", "inactive-scene-label"],
        [
          makeEl("active-overlay"),
          makeEl("inactive-scene-video", {
            opacity: 0,
            visible: false,
            renderFrameVisible: true,
          }),
          makeEl("inactive-scene-label", {
            opacity: 0,
            visible: true,
          }),
        ],
      ),
    ).toEqual(["active-overlay"]);
  });
});

function makeCompositeContext(): HdrCompositeContext {
  // Browser methods are replaced at this test boundary; no Chrome session is opened.
  const domSession = {
    page: { evaluate: vi.fn(async () => undefined) },
  } as unknown as CaptureSession;
  return {
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    domSession,
    beforeCaptureHook: null,
    width: 2,
    height: 2,
    fps: 30,
    compositeTransfer: "pq",
    nativeHdrImageIds: new Set(),
    hdrImageBuffers: new Map(),
    hdrImageTransferCache: createHdrImageTransferCache(),
    hdrVideoFrameSources: new Map([
      [
        "hdr",
        {
          dir: "",
          rawPath: "",
          fd: 1,
          width: 2,
          height: 2,
          frameSize: 24,
          frameCount: 3,
          scratch: Buffer.alloc(24),
        },
      ],
    ]),
    hdrVideoStartTimes: new Map([["hdr", 0]]),
    imageTransfers: new Map(),
    videoTransfers: new Map([["hdr", "pq"]]),
    debugDumpEnabled: false,
    debugDumpDir: null,
    hdrPerf: createHdrPerfCollector(),
  };
}

function makeStacking(overrides?: Partial<ElementStackingInfo>): ElementStackingInfo[] {
  const bounds = { width: 2, height: 2, layoutWidth: 2, layoutHeight: 2 };
  return [
    makeEl("lower", bounds),
    makeEl("hdr", { ...bounds, isHdr: true, zIndex: 1, ...overrides }),
    makeEl("upper", { ...bounds, zIndex: 2 }),
  ];
}

function legacyFilter(stacking: ElementStackingInfo[]): Set<string> {
  return new Set(stacking.map((el) => el.id));
}

describe("compositeHdrFrame occluded leading DOM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.showIds = [];
    state.transparentLower = false;
    state.read.mockReset();
    state.read.mockImplementation((_fd, buffer, offset, length) => {
      buffer.fill(32, offset, offset + length);
      return length;
    });
  });

  it.each([
    ["no clip", {}],
    ["full clip", { clipRect: { x: 0, y: 0, width: 2, height: 2 } }],
    ["opaque threshold", { opacity: 0.999 }],
    ["2D identity", { transform: "matrix(1, 0, 0, 1, 0, 0)" }],
    ["3D identity", { transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)" }],
    ["injected native video", { visible: false, renderFrameVisible: true }],
  ])(
    "drops only the lower screenshot with %s and preserves legacy pixels",
    async (_name, overrides) => {
      const ctx = makeCompositeContext();
      const stacking = makeStacking(overrides);
      const legacy = Buffer.alloc(24);
      await compositeHdrFrame(ctx, legacy, 0, stacking, legacyFilter(stacking));
      vi.clearAllMocks();
      ctx.hdrPerf = createHdrPerfCollector();
      const canvas = Buffer.alloc(24);
      await compositeHdrFrame(ctx, canvas, 0, stacking);
      expect(captureAlphaPng).toHaveBeenCalledTimes(1);
      expect(state.read).toHaveBeenCalledTimes(1);
      expect(ctx.hdrPerf.domLayerCaptures).toBe(1);
      expect(ctx.hdrPerf.hdrVideoLayerBlits).toBe(1);
      expect(applyDomLayerMask).toHaveBeenCalledWith(
        ctx.domSession.page,
        ["upper"],
        ["lower", "hdr"],
      );
      expect(canvas).toEqual(legacy);
      expect(canvas.subarray(0, 6)).not.toEqual(canvas.subarray(6, 12));
    },
  );

  const ineligible: [string, Partial<ElementStackingInfo>][] = [
    ["out-of-window video", { visible: false, renderFrameVisible: false }],
    ["partial opacity", { opacity: 0.998 }],
    ["invalid opacity", { opacity: NaN }],
    ["infinite opacity", { opacity: Infinity }],
    ["invalid paint width", { width: NaN }],
    ["invalid position", { x: NaN }],
    ["x offset", { x: 1 }],
    ["y offset", { y: 1 }],
    ["smaller paint width", { width: 1 }],
    ["smaller paint height", { height: 1 }],
    ["smaller layout width", { layoutWidth: 1 }],
    ["smaller layout height", { layoutHeight: 1 }],
    ["radius", { borderRadius: [1, 0, 0, 0] }],
    ["partial clip", { clipRect: { x: 0, y: 0, width: 1, height: 2 } }],
    ["offset clip", { clipRect: { x: 1, y: 0, width: 2, height: 2 } }],
    ["translated transform", { transform: "matrix(1, 0, 0, 1, 1, 0)" }],
    ["scaled transform", { transform: "matrix(0.99, 0, 0, 1, 0, 0)" }],
    ["malformed transform", { transform: "matrix(invalid)" }],
    ["incomplete 2D identity", { transform: "matrix(1, , 0, 1, 0, 0)" }],
    [
      "3D perspective",
      { transform: "matrix3d(1, 0, 0, 0.01, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)" },
    ],
    ["3D depth", { transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1)" }],
    [
      "incomplete 3D identity",
      { transform: "matrix3d(1, , 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)" },
    ],
  ];
  it.each(ineligible)("keeps the legacy path for %s", async (_name, overrides) => {
    const ctx = makeCompositeContext();
    const stacking = makeStacking(overrides);
    const legacy = Buffer.alloc(24);
    await compositeHdrFrame(ctx, legacy, 0, stacking, legacyFilter(stacking));
    vi.clearAllMocks();
    const canvas = Buffer.alloc(24);
    await compositeHdrFrame(ctx, canvas, 0, stacking);
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(canvas).toEqual(legacy);
  });

  it.each([
    "image",
    "srgb",
    "filter",
    "missing source",
    "inactive",
    "missing start",
    "no frames",
    "source dimensions",
    "raw size",
    "scratch size",
  ])("does not optimize %s captures", async (reason) => {
    const ctx = makeCompositeContext();
    const stacking = makeStacking();
    const source = ctx.hdrVideoFrameSources.get("hdr");
    if (!source) throw new Error("Missing fixture source");
    if (reason === "image") ctx.nativeHdrImageIds.add("hdr");
    if (reason === "srgb") ctx.compositeTransfer = "srgb";
    if (reason === "missing source") ctx.hdrVideoFrameSources.clear();
    if (reason === "inactive") ctx.hdrVideoStartTimes.set("hdr", 1);
    if (reason === "missing start") ctx.hdrVideoStartTimes.clear();
    if (reason === "no frames") source.frameCount = 0;
    if (reason === "source dimensions") source.width = 1;
    if (reason === "raw size") source.frameSize = 12;
    if (reason === "scratch size") source.scratch = Buffer.alloc(30);
    await compositeHdrFrame(
      ctx,
      Buffer.alloc(24),
      0,
      stacking,
      reason === "filter" ? legacyFilter(stacking) : undefined,
    );
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
  });

  it("requires the first paintable layer above DOM to be the occluding video", async () => {
    const stacking = makeStacking();
    stacking.splice(1, 0, makeEl("partial-hdr", { width: 1, height: 1, isHdr: true, zIndex: 0.5 }));
    await compositeHdrFrame(makeCompositeContext(), Buffer.alloc(24), 0, stacking);
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
  });

  it("can ignore a zero-opacity HDR layer without reviving it", async () => {
    const stacking = makeStacking();
    stacking.splice(1, 0, makeEl("inactive-hdr", { isHdr: true, zIndex: 0.5, opacity: 0 }));
    await compositeHdrFrame(makeCompositeContext(), Buffer.alloc(24), 0, stacking);
    expect(captureAlphaPng).toHaveBeenCalledTimes(1);
    expect(state.read).toHaveBeenCalledTimes(1);
  });

  it("replays the legacy frame once when the first read is incomplete", async () => {
    const ctx = makeCompositeContext();
    const stacking = makeStacking();
    const legacy = Buffer.alloc(24);
    await compositeHdrFrame(ctx, legacy, 0, stacking, legacyFilter(stacking));
    vi.clearAllMocks();
    ctx.hdrPerf = createHdrPerfCollector();
    state.read.mockImplementationOnce(() => 0);
    const canvas = Buffer.alloc(24);
    await compositeHdrFrame(ctx, canvas, 0, stacking);
    expect(state.read).toHaveBeenCalledTimes(2);
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
    expect(ctx.hdrPerf.domLayerCaptures).toBe(2);
    expect(ctx.hdrPerf.hdrVideoLayerBlits).toBe(2);
    expect(canvas).toEqual(legacy);
  });

  it("clears a partially written canvas and replays once after a blit exception", async () => {
    const ctx = makeCompositeContext();
    const stacking = makeStacking();
    const legacy = Buffer.alloc(24);
    await compositeHdrFrame(ctx, legacy, 0, stacking, legacyFilter(stacking));
    vi.clearAllMocks();
    vi.mocked(blitRgb48leRegion).mockImplementationOnce((canvas) => {
      canvas.fill(255);
      throw new Error("Partial blit");
    });
    const canvas = Buffer.alloc(24);
    await compositeHdrFrame(ctx, canvas, 0, stacking);
    expect(state.read).toHaveBeenCalledTimes(2);
    expect(blitRgb48leRegion).toHaveBeenCalledTimes(2);
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
    expect(canvas).toEqual(legacy);
  });

  it("clears partial candidate pixels before replay when the replay read fails", async () => {
    const stacking = makeStacking();
    state.transparentLower = true;

    const expectedContext = makeCompositeContext();
    expectedContext.hdrVideoFrameSources.clear();
    const expected = Buffer.alloc(24);
    await compositeHdrFrame(expectedContext, expected, 0, stacking);

    vi.clearAllMocks();
    state.read
      .mockImplementationOnce((_fd, buffer, offset, length) => {
        buffer.fill(32, offset, offset + length);
        return length;
      })
      .mockImplementationOnce(() => 0);
    vi.mocked(blitRgb48leRegion).mockImplementationOnce((canvas) => {
      canvas.fill(255);
      throw new Error("Partial blit");
    });

    const canvas = Buffer.alloc(24);
    await compositeHdrFrame(makeCompositeContext(), canvas, 0, stacking);

    expect(state.read).toHaveBeenCalledTimes(2);
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
    expect(canvas).toEqual(expected);
  });

  it("preserves lower and upper DOM when both video attempts fail", async () => {
    const ctx = makeCompositeContext();
    const stacking = makeStacking();
    state.read.mockImplementation(() => {
      throw new Error("Read failure");
    });
    const legacy = Buffer.alloc(24);
    await compositeHdrFrame(ctx, legacy, 0, stacking, legacyFilter(stacking));
    vi.clearAllMocks();
    const canvas = Buffer.alloc(24);
    await compositeHdrFrame(ctx, canvas, 0, stacking);
    expect(state.read).toHaveBeenCalledTimes(2);
    expect(captureAlphaPng).toHaveBeenCalledTimes(2);
    expect(canvas).toEqual(legacy);
  });

  it("reports skipped, failed and successful native video reads", () => {
    const ctx = makeCompositeContext();
    const el = makeStacking()[1];
    if (!el) throw new Error("Missing fixture video");
    const blit = () =>
      blitHdrVideoLayer(
        Buffer.alloc(24),
        el,
        0,
        30,
        ctx.hdrVideoFrameSources,
        ctx.hdrVideoStartTimes,
        2,
        2,
      );
    expect(blit()).toBe("blitted");
    state.read.mockImplementationOnce(() => 0);
    expect(blit()).toBe("failed");
    ctx.hdrVideoStartTimes.clear();
    expect(blit()).toBe("skipped");
  });
});
