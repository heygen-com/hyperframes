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

const endOf = (start: number, duration: number) => start + Math.max(0, duration - 0.001);

// Decoded frames are shared per source for the module's life, so each test decodes its own file.
let sources = 0;
let source = "";

beforeEach(() => {
  source = `/clip-${++sources}.mp4`;
  vi.clearAllMocks();
  getKeyPacket.mockImplementation(async () => null);
  vi.spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:one")
    .mockReturnValueOnce("blob:two")
    .mockReturnValueOnce("blob:end");
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
  it("uses the midpoint for a poster, and each slice's left edge then the end for a strip", () => {
    expect(videoThumbnailTimestamps(2, 6, 1)).toEqual([5]);
    expect(videoThumbnailTimestamps(2, 6, 4)).toEqual([2, 3.5, 5, 6.5, endOf(2, 6)]);
  });

  it("nests each strip in the strip twice as long, and the poster in every strip", () => {
    const strip = videoThumbnailTimestamps(0, 8, 4);
    expect(videoThumbnailTimestamps(0, 8, 8).filter((_, i) => i % 2 === 0)).toEqual(strip);
    expect(strip).toContain(videoThumbnailTimestamps(0, 8, 1)[0]);
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
      { source, sourceStart: 2, sourceRangeDuration: 6, frameCount: 2 },
      new AbortController().signal,
    );

    expect(decoded).toEqual([[2, 5, endOf(2, 6)]]);
    expect(result.value).toEqual({
      kind: "filmstrip",
      urls: ["blob:one", "blob:two", "blob:end"],
      aspect: 9 / 16,
    });
    result.dispose?.();
    result.dispose?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("decodes each strip frame at its keyframe unless that keyframe is before the clip's range", async () => {
    getKeyPacket.mockImplementation(async (time) => ({ timestamp: time - 0.5 }));
    const decoded: number[][] = [];
    recordDecodes(decoded);
    await decodeVideoThumbnail(
      { source, sourceStart: 2, sourceRangeDuration: 8, frameCount: 4 },
      new AbortController().signal,
    );
    expect(decoded).toEqual([[2, 3.5, 5.5, 7.5, endOf(2, 8)]]);
  });

  it("keeps a slot's own time when its keyframe is more than half a slot earlier", async () => {
    getKeyPacket.mockImplementation(async () => ({ timestamp: 0 }));
    const decoded: number[][] = [];
    recordDecodes(decoded);
    await decodeVideoThumbnail(
      { source, sourceStart: 0, sourceRangeDuration: 10, frameCount: 4 },
      new AbortController().signal,
    );
    expect(decoded).toEqual([[0, 2.5, 5, 7.5, endOf(0, 10)]]);
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
      { source, sourceStart: 0, sourceRangeDuration: 10, frameCount: 2 },
      new AbortController().signal,
    );
    const end = endOf(0, 10);
    expect(events).toEqual(["key 0", "frame 0", "key 5", "frame 5", `key ${end}`, `frame ${end}`]);
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
        { source, sourceStart: 0, sourceRangeDuration: 10, frameCount: 3 },
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
      { source, sourceStart: 5, sourceRangeDuration: 5, frameCount: 2 },
      new AbortController().signal,
    );
    expect(decoded).toEqual([[5, 7.5, endOf(5, 5)]]);
  });

  it("reuses the frames a strip of the same source shows, so a zoom decodes only new times", async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:${Math.random()}`);
    const decoded: number[][] = [];
    recordDecodes(decoded);
    const range = { source, sourceStart: 0, sourceRangeDuration: 8 };
    const signal = new AbortController().signal;
    const four = await decodeVideoThumbnail({ ...range, frameCount: 4 }, signal);
    // Twice the frames decodes only the new half; half the frames decodes nothing. All share the end.
    const eight = await decodeVideoThumbnail({ ...range, frameCount: 8 }, signal);
    const two = await decodeVideoThumbnail({ ...range, frameCount: 2 }, signal);
    expect(decoded).toEqual([
      [0, 2, 4, 6, endOf(0, 8)],
      [1, 3, 5, 7],
    ]);
    const urls = (result: typeof four) =>
      result.value.kind === "filmstrip" ? result.value.urls : [];
    expect(urls(eight).filter((_, i) => i % 2 === 0)).toEqual(urls(four));
    expect(urls(two)).toEqual([urls(four)[0], urls(four)[2], urls(four)[4]]);
    for (const result of [four, eight, two]) result.dispose?.();
  });

  it("decodes a frame again when the one shared for its time sits too far before it", async () => {
    // Every keyframe is 2 s before the time asked: a 2-frame strip of 8 s accepts that (its
    // frames stand for 4 s each), a 4-frame strip does not, or its frames would run backwards.
    getKeyPacket.mockImplementation(async (time) => ({ timestamp: time - 2 }));
    const decoded: number[][] = [];
    recordDecodes(decoded);
    const range = { source, sourceStart: 0, sourceRangeDuration: 8 };
    const signal = new AbortController().signal;
    const two = await decodeVideoThumbnail({ ...range, frameCount: 2 }, signal);
    const four = await decodeVideoThumbnail({ ...range, frameCount: 4 }, signal);
    expect(decoded).toEqual([
      [0, 2, endOf(0, 8)],
      [2, 4, 6],
    ]);
    two.dispose?.();
    four.dispose?.();
  });

  it("returns a strip whose frames are all shared without opening the file again", async () => {
    recordDecodes([]);
    const range = { source, sourceStart: 0, sourceRangeDuration: 8 };
    const signal = new AbortController().signal;
    const four = await decodeVideoThumbnail({ ...range, frameCount: 4 }, signal);
    const two = await decodeVideoThumbnail({ ...range, frameCount: 2 }, signal);
    expect(input.getPrimaryVideoTrack).toHaveBeenCalledTimes(1);
    four.dispose?.();
    two.dispose?.();
  });

  it("keeps one copy of a frame two strips decode at once, and revokes the other", async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:${Math.random()}`);
    // The first strip holds its first frame until the second is decoding too.
    let release!: () => void;
    const bothDecoding = new Promise<void>((resolve) => (release = resolve));
    canvasesAtTimestamps.mockImplementation(async function* (timestamps: AsyncIterable<number>) {
      const first = canvasesAtTimestamps.mock.calls.length === 1;
      for await (const _time of timestamps) {
        if (first) await bothDecoding;
        else release();
        yield { canvas: document.createElement("canvas") };
      }
    });
    const range = { source, sourceStart: 0, sourceRangeDuration: 8 };
    const signal = new AbortController().signal;
    const decodingTwo = decodeVideoThumbnail({ ...range, frameCount: 2 }, signal);
    await vi.waitFor(() => expect(canvasesAtTimestamps).toHaveBeenCalledOnce());
    const [two, four] = await Promise.all([
      decodingTwo,
      decodeVideoThumbnail({ ...range, frameCount: 4 }, signal),
    ]);
    // Both decoded the frames at 0 s, 4 s and the end; the second copy of each goes at once.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    two.dispose?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    four.dispose?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
  });

  it("revokes a shared frame only once no strip shows it", async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:${Math.random()}`);
    recordDecodes([]);
    const range = { source, sourceStart: 0, sourceRangeDuration: 8 };
    const signal = new AbortController().signal;
    const four = await decodeVideoThumbnail({ ...range, frameCount: 4 }, signal);
    const two = await decodeVideoThumbnail({ ...range, frameCount: 2 }, signal);
    four.dispose?.();
    // The three frames the 2-slice strip still shows stay; the other two go.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    two.dispose?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5);
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
    canvasesAtTimestamps.mockImplementation(async function* (timestamps: AsyncIterable<number>) {
      let frames = 0;
      for await (const timestamp of timestamps) {
        if (frames++ === 1) controller.abort();
        yield { canvas, timestamp, duration: 1 };
      }
    });
    await expect(
      decodeVideoThumbnail({ source, frameCount: 2 }, controller.signal),
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

    const decoding = decodeVideoThumbnail({ source, frameCount: 1 }, controller.signal);
    await vi.waitFor(() => expect(getDisplayWidth).toHaveBeenCalledOnce());
    controller.abort();
    resolveWidth(1080);

    await expect(decoding).rejects.toMatchObject({ name: "AbortError" });
    expect(getDurationFromMetadata).not.toHaveBeenCalled();
    expect(canvasesAtTimestamps).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
