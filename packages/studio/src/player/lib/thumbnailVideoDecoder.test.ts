// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { decodeVideoThumbnail, videoThumbnailTimestamps } from "./thumbnailVideoDecoder";

const dispose = vi.fn();
const samplesAtTimestamps = vi.fn();
const contexts: Array<{ rotate: Mock; drawImage: Mock }> = [];
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
  VideoSampleSink: class {
    samplesAtTimestamps = samplesAtTimestamps;
  },
}));

function decodedSample({ copiesRgba = true, rotation = 0 } = {}) {
  return {
    visibleRect: { left: 0, top: 0, width: 1920, height: 1080 },
    squarePixelWidth: 1920,
    squarePixelHeight: 1080,
    rotation,
    timestamp: 2,
    allocationSize: vi.fn(() => 1920 * 1080 * (copiesRgba ? 4 : 1.5)),
    copyTo: vi.fn(async () => []),
    drawWithFit: vi.fn(),
    close: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  contexts.length = 0;
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (_source: unknown, options: object) => ({ ...options, close: vi.fn() })),
  );
  HTMLCanvasElement.prototype.getContext = function getContext() {
    const context = {
      canvas: this,
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
    };
    contexts.push(context);
    return context as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
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
    samplesAtTimestamps.mockImplementation(async function* (timestamps: number[]) {
      expect(timestamps).toEqual([2, 8]);
      yield decodedSample();
      yield decodedSample();
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
    const late = decodedSample();
    samplesAtTimestamps.mockImplementation(async function* () {
      yield decodedSample();
      controller.abort();
      yield late;
    });
    await expect(
      decodeVideoThumbnail({ source: "/clip.mp4", frameCount: 2 }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(late.close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("draws each frame from a copy downscaled to the thumbnail, never the decoded frame", async () => {
    input.getPrimaryVideoTrack.mockResolvedValue({
      getDisplayWidth: vi.fn(async () => 1920),
      getDisplayHeight: vi.fn(async () => 1080),
      getDurationFromMetadata: vi.fn(async () => 10),
    });
    const decoded = [decodedSample(), decodedSample({ rotation: 90 })];
    samplesAtTimestamps.mockImplementation(async function* () {
      yield* decoded;
    });
    await decodeVideoThumbnail(
      { source: "/clip.mp4", frameCount: 2 },
      new AbortController().signal,
    );

    for (const sample of decoded) {
      expect(sample.drawWithFit).not.toHaveBeenCalled();
      expect(sample.close).toHaveBeenCalledOnce();
    }
    const bitmaps = await Promise.all(
      vi.mocked(createImageBitmap).mock.results.map((r) => r.value as Promise<{ close: Mock }>),
    );
    expect(vi.mocked(createImageBitmap).mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ resizeWidth: 240, resizeHeight: 135 }),
      expect.objectContaining({ resizeWidth: 427, resizeHeight: 240 }),
    ]);
    const [context] = contexts;
    expect(context?.rotate.mock.calls).toEqual([[0], [Math.PI / 2]]);
    expect(context?.drawImage.mock.calls.map((c) => c[0])).toEqual(bitmaps);
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("draws the decoded frame when the browser cannot copy it as RGBA", async () => {
    const sample = decodedSample({ copiesRgba: false });
    samplesAtTimestamps.mockImplementation(async function* () {
      yield sample;
    });
    await decodeVideoThumbnail(
      { source: "/clip.mp4", frameCount: 1 },
      new AbortController().signal,
    );
    expect(sample.drawWithFit).toHaveBeenCalledWith(expect.anything(), { fit: "cover" });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(sample.close).toHaveBeenCalledOnce();
  });

  it("stops after metadata cancellation before occupying the decoder", async () => {
    const controller = new AbortController();
    let resolveWidth!: (width: number) => void;
    const width = new Promise<number>((resolve) => {
      resolveWidth = resolve;
    });
    const getDisplayWidth = vi.fn(() => width);
    const getDurationFromMetadata = vi.fn(async () => 10);
    input.getPrimaryVideoTrack.mockResolvedValue({
      getDisplayWidth,
      getDisplayHeight: vi.fn(async () => 1920),
      getDurationFromMetadata,
    });

    const decoding = decodeVideoThumbnail(
      { source: "/clip.mp4", frameCount: 1 },
      controller.signal,
    );
    await vi.waitFor(() => expect(getDisplayWidth).toHaveBeenCalledOnce());
    controller.abort();
    resolveWidth(1080);

    await expect(decoding).rejects.toMatchObject({ name: "AbortError" });
    expect(getDurationFromMetadata).not.toHaveBeenCalled();
    expect(samplesAtTimestamps).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
