// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeVideoThumbnail, videoThumbnailTimestamps } from "./thumbnailVideoDecoder";

const dispose = vi.fn();
const canvasesAtTimestamps = vi.fn();
const input = {
  getPrimaryVideoTrack: vi.fn(),
  dispose,
};

vi.mock("mediabunny", () => ({
  ALL_FORMATS: {},
  UrlSource: class {
    constructor(readonly url: string) {}
  },
  Input: class {
    getPrimaryVideoTrack = input.getPrimaryVideoTrack;
    dispose = input.dispose;
  },
  CanvasSink: class {
    canvasesAtTimestamps = canvasesAtTimestamps;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:one").mockReturnValueOnce("blob:two");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new Blob(["frame"], { type: "image/jpeg" }));
  };
  input.getPrimaryVideoTrack.mockResolvedValue({
    getDisplayWidth: vi.fn(async () => 1080),
    getDisplayHeight: vi.fn(async () => 1920),
    getDurationFromMetadata: vi.fn(async () => 10),
  });
});

describe("videoThumbnailTimestamps", () => {
  it("uses the midpoint for a poster and sorted sparse points for a strip", () => {
    expect(videoThumbnailTimestamps(2, 6, 1)).toEqual([5]);
    expect(videoThumbnailTimestamps(2, 6, 4)).toEqual([2, 4, 6, 8]);
  });

  it("clamps invalid source ranges", () => {
    expect(videoThumbnailTimestamps(-2, Number.NaN, 0)).toEqual([0]);
    expect(videoThumbnailTimestamps(2, 8, Number.NaN)).toEqual([6]);
  });
});

describe("decodeVideoThumbnail", () => {
  it("extracts sparse frames, returns object URLs, and disposes once", async () => {
    const canvas = document.createElement("canvas");
    canvasesAtTimestamps.mockImplementation(async function* (timestamps: number[]) {
      expect(timestamps).toEqual([2, 8]);
      yield { canvas, timestamp: 2, duration: 1 };
      yield { canvas, timestamp: 8, duration: 1 };
    });
    const result = await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 2, sourceRangeDuration: 6, frameCount: 2 },
      new AbortController().signal,
    );

    expect(result.value).toEqual({
      kind: "filmstrip",
      urls: ["blob:one", "blob:two"],
      aspect: 9 / 16,
    });
    result.dispose?.();
    result.dispose?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases input and degrades when the source has no video track", async () => {
    input.getPrimaryVideoTrack.mockResolvedValue(null);
    await expect(
      decodeVideoThumbnail({ source: "/audio.mp3", frameCount: 1 }, new AbortController().signal),
    ).rejects.toThrow("no decodable video track");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("revokes partial results when cancellation lands during extraction", async () => {
    const controller = new AbortController();
    const canvas = document.createElement("canvas");
    canvasesAtTimestamps.mockImplementation(async function* () {
      yield { canvas, timestamp: 1, duration: 1 };
      controller.abort();
      yield { canvas, timestamp: 2, duration: 1 };
    });
    await expect(
      decodeVideoThumbnail({ source: "/clip.mp4", frameCount: 2 }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
