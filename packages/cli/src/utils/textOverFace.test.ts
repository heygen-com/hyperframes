import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckBbox, TextOverVideoCandidate } from "./checkTypes.js";
import {
  FACE_COVER_REPORT,
  coveredShare,
  faceRectOnCanvas,
  findTextOverFace,
  textOverFaceIssue,
  type FaceFinder,
} from "./textOverFace.js";

const box = (x: number, y: number, width: number, height: number): CheckBbox => ({
  x,
  y,
  width,
  height,
});

// A 768x1344 take cover-fitted into a 1080x1920 canvas: the frame is 1097.14 wide and spills
// 8.57 px past each side of the box.
const COVER = {
  box: box(0, 0, 1080, 1920),
  frame: box(-8.57, 0, 1097.14, 1920),
  flipX: false,
  flipY: false,
};

function candidate(overrides: Partial<TextOverVideoCandidate> = {}): TextOverVideoCandidate {
  return {
    selector: "#title",
    dataAttributes: { "data-layer-id": "title" },
    sourceFile: "index.html",
    bbox: box(400, 760, 200, 100),
    time: 7,
    text: "15% OFF",
    rect: { left: 400, top: 760, right: 600, bottom: 860, width: 200, height: 100 },
    wordRects: [box(400, 760, 200, 100)],
    video: { selector: "#take", file: "/project/take.mp4", mediaTime: 7, ...COVER },
    ...overrides,
  };
}

// On COVER this face lands at x 430, y 768, 175.5 x 192.
const FACE = [0.4, 0.4, 0.16, 0.1];

describe("faceRectOnCanvas", () => {
  it("places a face through the frame object-fit painted, not through the element's box", () => {
    const rect = faceRectOnCanvas(FACE, COVER);
    expect(rect?.x).toBeCloseTo(-8.57 + 0.4 * 1097.14, 2);
    expect(rect?.y).toBeCloseTo(768, 2);
    expect(rect?.width).toBeCloseTo(0.16 * 1097.14, 2);
    expect(rect?.height).toBeCloseTo(192, 2);
  });

  it("follows a letterboxed frame inside its box", () => {
    const contain = { ...COVER, frame: box(0, 656.25, 1080, 607.5) };
    expect(faceRectOnCanvas([0.5, 0.5, 0.1, 0.2], contain)).toEqual(box(540, 960, 108, 121.5));
  });

  it("mirrors the face with the video", () => {
    const fill = { ...COVER, frame: box(0, 0, 1000, 1000), box: box(0, 0, 1000, 1000) };
    expect(faceRectOnCanvas([0.125, 0.25, 0.25, 0.25], { ...fill, flipX: true })).toEqual(
      box(625, 250, 250, 250),
    );
    expect(faceRectOnCanvas([0.125, 0.25, 0.25, 0.25], { ...fill, flipY: true })).toEqual(
      box(125, 500, 250, 250),
    );
  });

  it("cuts a face to what the video's box shows", () => {
    const cropped = { ...COVER, frame: box(-100, 0, 1280, 1920) };
    // The face spans x -100..156; the box shows 0..156, more than half of it.
    expect(faceRectOnCanvas([0, 0.4, 0.2, 0.1], cropped)).toEqual(box(0, 768, 156, 192));
  });

  it("drops a face the box crops to less than half", () => {
    const cropped = { ...COVER, frame: box(-200, 0, 1480, 1920) };
    // The face spans x -200..96: only 96 of 296 px are inside the box.
    expect(faceRectOnCanvas([0, 0.4, 0.2, 0.1], cropped)).toBeNull();
  });
});

describe("coveredShare", () => {
  const face = box(100, 100, 200, 200);

  it("is the share of the face under the text, not the share of the text on the face", () => {
    // A small caption wholly inside a large face hides little of it.
    expect(coveredShare([box(150, 150, 100, 40)], face)).toBeCloseTo(0.1, 6);
    // A large title that only clips the face hides a lot of it.
    expect(coveredShare([box(0, 0, 2000, 200)], face)).toBeCloseTo(0.5, 6);
  });

  it("counts overlapping word boxes once", () => {
    const words = [box(100, 100, 150, 100), box(200, 100, 100, 100), box(200, 150, 100, 100)];
    // Their union inside the face is 200x100 plus the 100x50 below its right half.
    expect(coveredShare(words, face)).toBeCloseTo((200 * 100 + 100 * 50) / (200 * 200), 6);
  });

  it("is 0 for text clear of the face and 1 for text over all of it", () => {
    expect(coveredShare([box(400, 100, 200, 200)], face)).toBe(0);
    expect(coveredShare([box(0, 0, 150, 500), box(150, 0, 500, 500)], face)).toBe(1);
  });
});

describe("textOverFaceIssue", () => {
  it("builds the finding the contract names", () => {
    // The face is 430..605.5 x 768..960; the title covers its top 92 px across 170 px of it.
    const [issue] = textOverFaceIssue(candidate(), [FACE]);
    expect(issue).toEqual({
      code: "text_over_face",
      severity: "info",
      time: 7,
      selector: "#title",
      containerSelector: "#take",
      text: "15% OFF",
      message: '"15% OFF" covers 46% of a face in the video beneath it.',
      rect: { left: 400, top: 760, right: 600, bottom: 860, width: 200, height: 100 },
      coveredFraction: 0.46,
      faceRect: { x: 430.29, y: 768, width: 175.54, height: 192 },
      fixHint:
        "Move the text off the face, or mark an intended overlap with data-layout-allow-on-face.",
      dataAttributes: { "data-layer-id": "title" },
      sourceFile: "index.html",
      bbox: box(400, 760, 200, 100),
    });
  });

  it("is info however much of the face is covered, so a face found in texture never fails --strict", () => {
    const grazing = candidate({ wordRects: [box(400, 760, 200, 40)] });
    expect(textOverFaceIssue(grazing, [FACE])[0]).toMatchObject({
      severity: "info",
      coveredFraction: 0.16,
    });
    const whole = candidate({ wordRects: [box(0, 0, 1080, 1920)] });
    expect(textOverFaceIssue(whole, [FACE])[0]).toMatchObject({
      severity: "info",
      coveredFraction: 1,
    });
  });

  it("reports nothing under 5% of the face", () => {
    expect(FACE_COVER_REPORT).toBe(0.05);
    const touching = candidate({ wordRects: [box(400, 760, 200, 15)] });
    expect(textOverFaceIssue(touching, [FACE])).toEqual([]);
  });

  it("reports the face the text covers most", () => {
    const clear = [0.8, 0.1, 0.1, 0.05];
    const [issue] = textOverFaceIssue(candidate(), [clear, FACE]);
    expect(issue?.faceRect?.x).toBeCloseTo(430.29, 2);
  });

  it("reports nothing without a face", () => {
    expect(textOverFaceIssue(candidate(), [])).toEqual([]);
  });

  it("shortens a long line in the message only", () => {
    const text = "A very long caption line that runs well past forty characters";
    const [issue] = textOverFaceIssue(candidate({ text }), [FACE]);
    expect(issue?.message).toBe(
      '"A very long caption line that runs we..." covers 46% of a face in the video beneath it.',
    );
    expect(issue?.text).toBe(text);
  });
});

describe("findTextOverFace", () => {
  afterEach(() => vi.restoreAllMocks());

  const at = (time: number, file = "/project/take.mp4") =>
    candidate({ time, video: { ...candidate().video, file, mediaTime: time } });
  const finder = (faceTimes: number[]) =>
    vi.fn<FaceFinder>(
      async (_file, times) =>
        new Map(
          times.map((time) => [
            time,
            { frame: Math.round(time * 24), boxes: faceTimes.includes(time) ? [FACE] : [] },
          ]),
        ),
    );

  it("reads each video once for its distinct times and reports only where a face is", async () => {
    const facesIn = finder([1, 7]);
    const { issues, faceCheck } = await findTextOverFace(
      [at(1), at(4), at(7), at(7), at(7, "/project/other.mp4")],
      facesIn,
    );
    expect(facesIn.mock.calls.map(([file, times]) => [file, times])).toEqual([
      ["/project/take.mp4", [1, 4, 7]],
      ["/project/other.mp4", [7]],
    ]);
    expect(issues.map((issue) => issue.time)).toEqual([1, 7, 7, 7]);
    expect(faceCheck).toEqual({ ran: true, candidates: 5, faces: 3 });
  });

  it("puts the most covered sample first, so a collapsed finding carries the worst numbers", async () => {
    const grazing = { ...at(1), wordRects: [box(400, 760, 200, 40)] };
    const { issues } = await findTextOverFace([grazing, at(7)], finder([1, 7]));
    expect(issues.map((issue) => [issue.time, issue.coveredFraction])).toEqual([
      [7, 0.46],
      [1, 0.16],
    ]);
  });

  it("says the pass ran when it looked and found no face", async () => {
    const { issues, faceCheck } = await findTextOverFace([at(4)], finder([]));
    expect(issues).toEqual([]);
    expect(faceCheck).toEqual({ ran: true, candidates: 1, faces: 0 });
  });

  it("survives a detector that cannot load: no finding, one stderr line, the reason kept", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const facesIn = vi.fn<FaceFinder>(async () => {
      throw new Error("could not download opencv.js (fetch failed)");
    });
    const result = await findTextOverFace([at(1), at(7, "/project/other.mp4")], facesIn);
    expect(result).toEqual({
      issues: [],
      faceCheck: { ran: false, reason: "could not download opencv.js (fetch failed)" },
    });
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]?.[0]).toBe(
      "[hyperframes] check: text over a face was not looked for in 2 of 2 video(s): could not download opencv.js (fetch failed)",
    );
  });

  // A detector whose first-use download never answers: it settles only when its signal ends.
  const neverReady = () =>
    vi.fn<FaceFinder>(
      (_file, _times, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );

  it("gives up on a detector that is not ready within 30 s and says how to get it", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const facesIn = neverReady();
      const pending = findTextOverFace([at(1)], facesIn);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(facesIn.mock.calls[0]?.[2]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({
        issues: [],
        faceCheck: {
          ran: false,
          reason:
            "no answer within 30 s; `hyperframes measure face <video>` downloads it with no time limit",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the detector when the check stops", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stop = new AbortController();
    const pending = findTextOverFace([at(1)], neverReady(), undefined, stop.signal);
    stop.abort(new Error("Check stopped before finishing (SIGINT)."));
    expect((await pending).faceCheck).toEqual({
      ran: false,
      reason: "Check stopped before finishing (SIGINT).",
    });
  });

  it("leaves no timer running once the faces are read", async () => {
    vi.useFakeTimers();
    try {
      await findTextOverFace([at(7)], finder([7]));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the findings of the videos it could read and counts the ones it could not", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const readable = finder([7]);
    const facesIn = vi.fn<FaceFinder>(async (file, times) => {
      if (file === "/project/other.mp4") throw new Error("ffprobe cannot read it");
      return readable(file, times);
    });
    const { issues, faceCheck } = await findTextOverFace(
      [at(7), at(7, "/project/other.mp4")],
      facesIn,
    );
    expect(issues).toHaveLength(1);
    expect(faceCheck).toEqual({ ran: true, candidates: 2, faces: 1, unreadVideos: 1 });
  });
});
