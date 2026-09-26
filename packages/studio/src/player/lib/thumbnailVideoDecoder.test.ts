// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeVideoThumbnail, videoThumbnailTimestamps } from "./thumbnailVideoDecoder";

const dispose = vi.fn();
const canvasesAtTimestamps = vi.fn();
const getKeyPacket = vi.fn(async (_time: number) => null as { timestamp: number } | null);
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
  EncodedPacketSink: class {
    getKeyPacket = getKeyPacket;
  },
}));

function recordDecodes(decoded: number[][]): void {
  canvasesAtTimestamps.mockImplementation(async function* (timestamps: AsyncIterable<number>) {
    const run: number[] = [];
    decoded.push(run);
    for await (const time of timestamps) {
      run.push(time);
      yield { canvas: document.createElement("canvas") };
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getKeyPacket.mockImplementation(async () => null);
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
    const decoded: number[][] = [];
    recordDecodes(decoded);
    const result = await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 2, sourceRangeDuration: 6, frameCount: 2 },
      new AbortController().signal,
    );

    expect(decoded).toEqual([[2, 8]]);
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

  it("decodes each strip frame at its keyframe unless that keyframe is before the clip's range", async () => {
    getKeyPacket.mockImplementation(async (time) => ({ timestamp: Math.floor(time / 4) * 4 }));
    const decoded: number[][] = [];
    recordDecodes(decoded);
    await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 2, sourceRangeDuration: 8, frameCount: 3 },
      new AbortController().signal,
    );
    expect(decoded).toEqual([[2, 4, 8]]);
  });

  it("keeps a slot's own time when its keyframe is more than half a slot earlier", async () => {
    getKeyPacket.mockImplementation(async () => ({ timestamp: 0 }));
    const decoded: number[][] = [];
    recordDecodes(decoded);
    await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 0, sourceRangeDuration: 10, frameCount: 3 },
      new AbortController().signal,
    );
    await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 0, sourceRangeDuration: 10, frameCount: 1 },
      new AbortController().signal,
    );
    expect(decoded).toEqual([[0, 5, 10], [5]]);
  });

  it("looks up each keyframe just before decoding it", async () => {
    const events: string[] = [];
    getKeyPacket.mockImplementation(async (time) => {
      events.push(`key ${time}`);
      return { timestamp: time };
    });
    canvasesAtTimestamps.mockImplementation(async function* (timestamps: AsyncIterable<number>) {
      for await (const time of timestamps) {
        events.push(`frame ${time}`);
        yield { canvas: document.createElement("canvas") };
      }
    });
    await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 0, sourceRangeDuration: 10, frameCount: 3 },
      new AbortController().signal,
    );
    expect(events).toEqual(["key 0", "frame 0", "key 5", "frame 5", "key 10", "frame 10"]);
  });

  it("ends the decode times without throwing when cancelled during a keyframe lookup", async () => {
    const controller = new AbortController();
    getKeyPacket.mockImplementation(async () => (controller.abort(), null));
    const decoded: number[] = [];
    let timesEnded = false;
    canvasesAtTimestamps.mockImplementation(async function* (timestamps: AsyncIterable<number>) {
      for await (const time of timestamps) {
        decoded.push(time);
        yield { canvas: document.createElement("canvas") };
      }
      timesEnded = true;
    });
    await expect(
      decodeVideoThumbnail(
        { source: "/clip.mp4", sourceStart: 0, sourceRangeDuration: 10, frameCount: 3 },
        controller.signal,
      ),
    ).rejects.toThrow("Aborted");
    expect(getKeyPacket).toHaveBeenCalledTimes(1);
    expect(decoded).toEqual([]);
    expect(timesEnded).toBe(true);
  });

  it("spreads a trimmed strip across its range when the file reports no duration", async () => {
    input.getPrimaryVideoTrack.mockResolvedValue({
      getDisplayWidth: vi.fn(async () => 1080),
      getDisplayHeight: vi.fn(async () => 1920),
      getDurationFromMetadata: vi.fn(async () => null),
    });
    const decoded: number[][] = [];
    recordDecodes(decoded);
    await decodeVideoThumbnail(
      { source: "/clip.mp4", sourceStart: 5, sourceRangeDuration: 5, frameCount: 3 },
      new AbortController().signal,
    );
    expect(decoded).toEqual([[5, 7.5, 10]]);
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
    expect(canvasesAtTimestamps).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
