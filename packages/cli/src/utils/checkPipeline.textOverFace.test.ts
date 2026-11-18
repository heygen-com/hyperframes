import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPageDriver } from "./checkBrowser.js";
import { DEFAULT_CHECK_OPTIONS, runAuditGrid } from "./checkPipeline.js";
import type { CheckAuditDriver, TextOverVideoCandidate } from "./checkTypes.js";
import type { VideoInfo } from "../measure/media.js";

const mocks = vi.hoisted(() => ({
  faceBoxesAt: vi.fn(),
  probeVideo: vi.fn(),
}));

vi.mock("../measure/face.js", () => ({ faceBoxesAt: mocks.faceBoxesAt }));
vi.mock("../measure/media.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../measure/media.js")>()),
  probeVideo: mocks.probeVideo,
}));

const SAMPLES = [1, 4, 7];
const OPTIONS = { ...DEFAULT_CHECK_OPTIONS, at: SAMPLES, contrast: false, craft: false };

function driver(overrides: Partial<CheckAuditDriver> = {}): CheckAuditDriver {
  let state = 0;
  return {
    initialize: async () => undefined,
    getDuration: async () => 9,
    hasNoTimelineDeclaration: async () => false,
    getTransitionBoundaries: async () => [],
    getClipEdges: async () => [],
    getCanvas: async () => ({ width: 1080, height: 1920 }),
    findAmbiguousSelectors: async () => [],
    seek: async () => undefined,
    seekGeometry: async () => undefined,
    collectLayout: async () => [],
    collectOverlap: async () => [],
    collectOverlapGrid: async (times) => times.map(() => []),
    collectLayoutGeometry: async () => `state-${state++}`,
    captureFrame: async () => "frame",
    framesDiffer: async () => true,
    collectSeekClock: async () => [{ id: 1, time: 0, done: false }],
    collectRotationSample: async () => [],
    collectOffPivotRotationSample: async (time) => ({ time, samples: [] }),
    collectGeometryCandidates: async () => [],
    collectMotionFrame: async (time) => ({ time, data: {}, liveness: {} }),
    anchorMotionIssues: async () => [],
    collectContrast: async () => ({ entries: [] }),
    ...overrides,
  };
}

// A title over the middle of a full-canvas video; the video's clock runs half a second behind.
function title(time: number): TextOverVideoCandidate {
  return {
    selector: "#title",
    dataAttributes: {},
    sourceFile: "index.html",
    bbox: { x: 340, y: 860, width: 400, height: 200 },
    time,
    text: "HELLO",
    rect: { left: 340, top: 860, right: 740, bottom: 1060, width: 400, height: 200 },
    wordRects: [{ x: 340, y: 860, width: 400, height: 200 }],
    video: {
      selector: "#take",
      file: "/project/takes/take.mp4",
      mediaTime: time - 0.5,
      box: { x: 0, y: 0, width: 1080, height: 1920 },
      frame: { x: 0, y: 0, width: 1080, height: 1920 },
      flipX: false,
      flipY: false,
    },
  };
}

const INFO = { path: "/project/takes/take.mp4", fps: 24, frames: 216 } as VideoInfo;
// Centred, 216 px square: the title covers its whole width and 196 of its 216 px.
const CENTRE_FACE = [0.4, 0.45, 0.2, 0.1125];

describe("text_over_face in the check grid", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.faceBoxesAt.mockReset();
    mocks.probeVideo.mockReset();
  });

  it("looks for faces once per video at the frames its samples showed, and reports the cover", async () => {
    mocks.probeVideo.mockReturnValue(INFO);
    // She faces the camera at the media times 0.5 s and 6.5 s (frames 12 and 156), not at 3.5 s.
    mocks.faceBoxesAt.mockImplementation(async (_info: VideoInfo, frames: number[]) =>
      frames.map((frame) => ({ frame, t: frame / 24, boxes: frame === 84 ? [] : [CENTRE_FACE] })),
    );
    const result = await runAuditGrid(
      driver({ collectTextOverVideo: async (time) => [title(time)] }),
      OPTIONS,
      { kind: "none" },
    );

    expect(mocks.probeVideo).toHaveBeenCalledTimes(1);
    expect(mocks.faceBoxesAt).toHaveBeenCalledTimes(1);
    expect(mocks.faceBoxesAt.mock.calls[0]?.[1]).toEqual([12, 84, 156]);
    const found = result.layoutIssues.filter((issue) => issue.code === "text_over_face");
    expect(found.map((issue) => issue.time).sort()).toEqual([1, 7]);
    expect(found[0]).toMatchObject({
      severity: "info",
      selector: "#title",
      containerSelector: "#take",
      coveredFraction: 0.91,
      faceRect: { x: 432, y: 864, width: 216, height: 216 },
      message: '"HELLO" covers 91% of a face in the video beneath it.',
    });
    expect(result.faceCheck).toEqual({ ran: true, candidates: 3, faces: 2 });
  });

  it("hands the detector the signal that ends with the check", async () => {
    mocks.probeVideo.mockReturnValue(INFO);
    mocks.faceBoxesAt.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stop = new AbortController();
    const noop = undefined;
    await runAuditGrid(
      driver({ collectTextOverVideo: async () => [title(1)] }),
      { ...OPTIONS, at: [1] },
      { kind: "none" },
      noop,
      noop,
      noop,
      noop,
      stop.signal,
    );
    const given: AbortSignal | undefined = mocks.faceBoxesAt.mock.calls[0]?.[2]?.signal;
    expect(given?.aborted).toBe(false);
    stop.abort();
    expect(given?.aborted).toBe(true);
  });

  it("does not load the detector when no text is in front of a video", async () => {
    const result = await runAuditGrid(driver({ collectTextOverVideo: async () => [] }), OPTIONS, {
      kind: "none",
    });
    expect(mocks.probeVideo).not.toHaveBeenCalled();
    expect(mocks.faceBoxesAt).not.toHaveBeenCalled();
    expect(result.layoutIssues).toEqual([]);
    expect(result.faceCheck).toEqual({ ran: true, candidates: 0, faces: 0 });
  });

  it("finishes without the finding when OpenCV cannot load, and says so once", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.probeVideo.mockReturnValue(INFO);
    mocks.faceBoxesAt.mockRejectedValue(new Error("could not download opencv.js (fetch failed)"));
    const result = await runAuditGrid(
      driver({ collectTextOverVideo: async (time) => [title(time)] }),
      OPTIONS,
      { kind: "none" },
    );
    expect(result.layoutIssues).toEqual([]);
    expect(result.faceCheck).toEqual({
      ran: false,
      reason: "could not download opencv.js (fetch failed)",
    });
    const said = stderr.mock.calls.filter(([line]) => String(line).includes("face"));
    expect(said).toEqual([
      [
        "[hyperframes] check: text over a face was not looked for in 1 of 1 video(s): could not download opencv.js (fetch failed)",
      ],
    ]);
  });

  it("probes no file for text over a video whose source is a private project file", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-face-private-"));
    try {
      mkdirSync(join(projectDir, "takes"));
      // An MP4's first bytes, so the file reads as media.
      for (const name of [".env", "takes/take.mp4"])
        writeFileSync(join(projectDir, name), Buffer.from("000000186674797069736f6d", "hex"));
      const origin = "http://127.0.0.1:4000/";
      const record = (src: string) => ({
        selector: "#title",
        sourceFile: "index.html",
        dataAttributes: {},
        text: "HELLO",
        rect: { left: 340, top: 860, right: 740, bottom: 1060, width: 400, height: 200 },
        wordRects: [{ x: 340, y: 860, width: 400, height: 200 }],
        video: { ...title(1).video, src: `${origin}${src}` },
      });
      const page = (src: string) =>
        ({
          on: () => undefined,
          url: () => `${origin}index.html`,
          evaluate: async () => [record(src)],
        }) as unknown as Page;
      const sampled = (src: string) => {
        const { collectTextOverVideo } = createPageDriver(
          page(src),
          undefined,
          undefined,
          projectDir,
        );
        return driver({ collectTextOverVideo });
      };
      mocks.probeVideo.mockReturnValue(INFO);
      mocks.faceBoxesAt.mockResolvedValue([]);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const hidden = await runAuditGrid(sampled(".env"), { ...OPTIONS, at: [1] }, { kind: "none" });
      expect(mocks.probeVideo).not.toHaveBeenCalled();
      expect(hidden.faceCheck).toEqual({ ran: true, candidates: 0, faces: 0 });

      await runAuditGrid(sampled("takes/take.mp4"), { ...OPTIONS, at: [1] }, { kind: "none" });
      expect(mocks.probeVideo).toHaveBeenCalledWith(join(projectDir, "takes", "take.mp4"), {
        guarded: true,
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("says the pass did not run on a driver that cannot report text over video", async () => {
    const result = await runAuditGrid(driver(), OPTIONS, { kind: "none" });
    expect(result.faceCheck).toEqual({
      ran: false,
      reason: "this check driver does not report text over video",
    });
  });
});
