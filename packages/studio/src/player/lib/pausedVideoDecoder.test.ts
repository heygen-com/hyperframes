// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPausedVideoDecoder } from "./pausedVideoDecoder";

const inputs: { source: string; dispose: ReturnType<typeof vi.fn> }[] = [];
const getTrack = vi.fn();
const getSample = vi.fn();
const cancelReads = vi.fn();
const iterateSamples = vi.fn();
const canvasContext = vi.fn();
const createBitmap = vi.fn();
const previewSource = vi.fn((source: string, _box: { width: number; height: number }) => source);
let qualityChosenBy = "person";
let previewQuality = 1;
let displayScale = 1;

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  UrlSource: class {
    constructor(readonly url: string) {}
  },
  Input: class {
    dispose = vi.fn();
    constructor(readonly options: { source: { url: string } }) {
      inputs.push({ source: options.source.url, dispose: this.dispose });
    }
    getPrimaryVideoTrack() {
      return getTrack(this.options.source.url);
    }
  },
  VideoSampleSink: class {
    constructor(readonly track: { source: string }) {}
    getSample(time: number) {
      return getSample(this.track.source, time);
    }
    samples(start: number, end: number) {
      return iterateSamples(this.track.source, start, end);
    }
  },
}));
vi.mock("./mediaFetch", () => ({ mediaUrlSourceOptions: () => ({ cancelReads }) }));
vi.mock("./seekPreviewSource", () => ({
  createSeekPreviewSources: () => ({
    get: (source: string, box: { width: number; height: number }) => previewSource(source, box),
    prepare: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock("../store/playerStore", () => ({
  usePlayerStore: {
    getState: () => ({ previewQuality, previewQualityChosenBy: qualityChosenBy }),
  },
}));
vi.mock("@hyperframes/core/runtime/protocol", () => ({ frameDisplayScale: () => displayScale }));

const providers: ReturnType<typeof createPausedVideoDecoder>[] = [];
function provider(
  facts?: Record<
    string,
    { width: number; height: number; frameRate?: number; variableFrameRate?: boolean }
  >,
  rootSize?: { width: number; height: number },
) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  if (facts) Object.assign(iframe.contentWindow, { __HF_MEDIA_SOURCE_FACTS__: facts });
  if (rootSize)
    Object.defineProperties(iframe.contentDocument!.documentElement, {
      clientWidth: { value: rootSize.width, configurable: true },
      clientHeight: { value: rootSize.height, configurable: true },
    });
  const result = createPausedVideoDecoder(iframe);
  providers.push(result);
  return result;
}
const request = (source: string) => ({
  source: `http://localhost/${source}.webm`,
  time: 0,
  video: document.createElement("video"),
});
const signal = () => new AbortController().signal;
const sample = (timestamp = 0) => ({
  timestamp,
  duration: 1 / 30,
  close: vi.fn(),
  drawWithFit: vi.fn(),
});
const bitmap = (bytes = 4) => ({ width: bytes / 4, height: 1, close: vi.fn() });
const track = (source: string) => ({
  source,
  getDisplayWidth: async () => 100,
  getDisplayHeight: async () => 100,
  getFirstTimestamp: async () => 0,
  getTimeResolution: async () => 1000,
  async getSquarePixelWidth() {
    return this.getDisplayWidth();
  },
  async getSquarePixelHeight() {
    return this.getDisplayHeight();
  },
  getRotation: async () => 0,
  getFlip: async () => false,
});

beforeEach(() => {
  inputs.length = 0;
  getTrack.mockReset().mockImplementation(async (source: string) => track(source));
  getSample.mockReset().mockImplementation(async () => sample());
  iterateSamples.mockReset();
  canvasContext.mockReset().mockReturnValue({ clearRect: vi.fn(), imageSmoothingQuality: "low" });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(canvasContext);
  createBitmap.mockReset().mockImplementation(async () => bitmap());
  cancelReads.mockClear();
  previewSource.mockReset().mockImplementation((source: string) => source);
  qualityChosenBy = "person";
  previewQuality = 1;
  displayScale = 1;
  vi.stubGlobal("createImageBitmap", createBitmap);
});
afterEach(async () => {
  for (const owner of providers.splice(0)) owner.dispose();
  await Promise.resolve();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("rejects a two-source frame set that cannot fit without closing a leased bitmap", async () => {
  const first = bitmap(40 * 1024 * 1024),
    second = bitmap(40 * 1024 * 1024);
  createBitmap.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  await expect(provider().decode([request("a"), request("b")], signal())).rejects.toThrow(
    "Preview frame budget reached",
  );
  expect(first.close).not.toHaveBeenCalled();
  expect(second.close).toHaveBeenCalledOnce();
});

it("reserves the reader budget before opening and keeps concurrent same-source leases alive", async () => {
  let finishOpen: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    finishOpen = resolve;
  });
  getTrack.mockImplementation(async (source: string) => {
    await opened;
    return track(source);
  });
  const owner = provider();
  const first = owner.decode([request("a"), request("b"), request("c"), request("d")], signal());
  const shared = owner.decode([request("a")], signal());
  await expect(owner.decode([request("e")], signal())).rejects.toThrow(
    "Preview decoder budget reached",
  );
  expect(inputs).toHaveLength(4);
  expect(inputs.every((input) => input.dispose.mock.calls.length === 0)).toBe(true);
  finishOpen?.();
  const frames = await first,
    other = await shared;
  expect(frames).toHaveLength(4);
  expect(other).toHaveLength(1);
  expect(inputs.every((input) => input.dispose.mock.calls.length === 0)).toBe(true);
  for (const frame of [...frames, ...other]) frame.release();
});

it("releases successful source leases when another source fails", async () => {
  const first = bitmap(40 * 1024 * 1024),
    next = bitmap(40 * 1024 * 1024);
  createBitmap.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  getSample.mockImplementation(async (source: string) => {
    if (source.endsWith("/b.webm")) throw new Error("decoder failed");
    return sample();
  });
  const owner = provider();
  await expect(owner.decode([request("a"), request("b")], signal())).rejects.toThrow(
    "decoder failed",
  );
  const [frame] = await owner.decode([request("c")], signal());
  expect(first.close).toHaveBeenCalledOnce();
  expect(next.close).not.toHaveBeenCalled();
  frame!.release();
});

it("retires idle readers even when decoding fails before a frame is returned", async () => {
  vi.useFakeTimers();
  getSample.mockRejectedValueOnce(new Error("decoder failed"));
  await expect(provider().decode([request("a")], signal())).rejects.toThrow("decoder failed");
  expect(inputs[0]!.dispose).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(inputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(cancelReads).toHaveBeenCalledOnce();
});

it("closes a bitmap completed after provider disposal and rejects later requests without opening", async () => {
  let finish: ((image: ReturnType<typeof bitmap>) => void) | undefined;
  createBitmap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const owner = provider(),
    pending = owner.decode([request("a")], signal());
  await vi.waitFor(() => expect(createBitmap).toHaveBeenCalledOnce());
  owner.dispose();
  const image = bitmap();
  finish?.(image);
  await expect(pending).rejects.toThrow("Preview disposed");
  expect(image.close).toHaveBeenCalledOnce();
  await expect(owner.decode([request("b")], signal())).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(inputs).toHaveLength(1);
});

it("shares full-resolution readers when animation changes only an oversized display box", async () => {
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 1000,
    getDisplayHeight: async () => 500,
  }));
  const owner = provider({ "a.webm": { width: 1000, height: 500 } }),
    item = request("a");
  const rect = vi.spyOn(item.video, "getBoundingClientRect");
  rect.mockReturnValue(new DOMRect(0, 0, 2600, 1800));
  const first = await owner.decode([item], signal());
  first[0]!.release();
  rect.mockReturnValue(new DOMRect(0, 0, 1900, 1300));
  const second = await owner.decode([item], signal());
  second[0]!.release();
  expect(inputs).toHaveLength(1);
});

it("keeps the learned box across visible and hidden cuts of the same original source", async () => {
  qualityChosenBy = "auto";
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 2100,
    getDisplayHeight: async () => 1800,
  }));
  const owner = provider(
    { "a.webm": { width: 2100, height: 1800 } },
    { width: 1920, height: 1080 },
  );
  for (const size of [
    [2300, 1900],
    [0, 0],
    [2300, 1900],
  ]) {
    const item = request("a");
    vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, size[0], size[1]),
    );
    const frames = await owner.decode([item], signal());
    frames[0]!.release();
  }
  expect(inputs).toHaveLength(1);
  expect(previewSource.mock.calls.map(([, box]) => box)).toEqual(
    Array.from({ length: 3 }, () => ({ width: 1218, height: 1024 })),
  );
});

it("allows a smaller learned box after viewport scale or quality is lowered", async () => {
  qualityChosenBy = "auto";
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 2100,
    getDisplayHeight: async () => 1800,
  }));
  const owner = provider(
      { "a.webm": { width: 2100, height: 1800 } },
      { width: 1920, height: 1080 },
    ),
    item = request("a");
  vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 2300, 1900));
  for (const [scale, quality] of [
    [1, 1],
    [0.5, 1],
    [0.5, 0.5],
  ]) {
    displayScale = scale!;
    previewQuality = quality!;
    const frames = await owner.decode([item], signal());
    frames[0]!.release();
  }
  expect(previewSource.mock.calls.map(([, box]) => box)).toEqual([
    { width: 1218, height: 1024 },
    { width: 724, height: 512 },
    { width: 304, height: 256 },
  ]);
  expect(inputs).toHaveLength(3);
});

it("resets the learned box when device pixel ratio is lowered", async () => {
  qualityChosenBy = "auto";
  vi.stubGlobal("devicePixelRatio", 2);
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 2100,
    getDisplayHeight: async () => 1800,
  }));
  const owner = provider({ "a.webm": { width: 2100, height: 1800 } }, { width: 960, height: 540 }),
    item = request("a");
  vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1150, 950));
  const first = await owner.decode([item], signal());
  first[0]!.release();
  vi.stubGlobal("devicePixelRatio", 1);
  const second = await owner.decode([item], signal());
  second[0]!.release();
  expect(previewSource.mock.calls.map(([, box]) => box)).toEqual([
    { width: 1218, height: 1024 },
    { width: 724, height: 512 },
  ]);
  expect(inputs).toHaveLength(2);
});

it("keeps genuinely different reduced-resolution boxes separate", async () => {
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 1000,
    getDisplayHeight: async () => 500,
  }));
  const owner = provider({ "a.webm": { width: 1000, height: 500 } }),
    item = request("a");
  const rect = vi.spyOn(item.video, "getBoundingClientRect");
  rect.mockReturnValue(new DOMRect(0, 0, 300, 200));
  const first = await owner.decode([item], signal());
  first[0]!.release();
  rect.mockReturnValue(new DOMRect(0, 0, 600, 300));
  const second = await owner.decode([item], signal());
  second[0]!.release();
  expect(inputs).toHaveLength(2);
});

it("maps prepared timestamps back to the original source lead and dimensions", async () => {
  qualityChosenBy = "auto";
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => (source.includes("prepared") ? 50 : 100),
    getFirstTimestamp: async () => (source.includes("prepared") ? 0 : 5),
  }));
  getSample.mockImplementation(async (source: string) =>
    sample(source.includes("prepared") ? 0.067 : 5),
  );
  const owner = provider({
      "a.webm": { width: 100, height: 100, frameRate: 30, variableFrameRate: false },
    }),
    item = { ...request("a"), time: 5 };
  const first = await owner.decode([item], signal());
  first[0]!.release();
  previewSource.mockReturnValue("http://localhost/prepared.webm");
  const [frame] = await owner.decode([{ ...item, time: 5 + 2 / 30 }], signal());
  expect(getSample).toHaveBeenLastCalledWith(
    "http://localhost/prepared.webm",
    expect.closeTo(0.06701, 8),
  );
  expect(frame).toMatchObject({
    width: 100,
    height: 100,
    timestamp: expect.closeTo(5 + 2 / 30, 8),
  });
  frame!.release();
});

const cfrFacts = { "a.webm": { width: 100, height: 100, frameRate: 30, variableFrameRate: false } };

it("closes skipped raw samples and rasterizes only selected frames across a 0.3 second forward gap", async () => {
  const one = sample(0.1),
    skipA = sample(0.2),
    skipB = sample(0.3),
    last = sample(0.4);
  iterateSamples.mockImplementation(async function* () {
    yield one;
    yield skipA;
    yield skipB;
    yield last;
  });
  const owner = provider(cfrFacts),
    item = request("a");
  for (const time of [0, 0.1, 0.4]) {
    const frames = await owner.decode([{ ...item, time }], signal());
    frames[0]!.release();
  }
  expect(iterateSamples).toHaveBeenCalledOnce();
  for (const skipped of [skipA, skipB]) {
    expect(skipped.close).toHaveBeenCalledOnce();
    expect(skipped.drawWithFit).not.toHaveBeenCalled();
  }
  for (const selected of [one, last]) {
    expect(selected.close).toHaveBeenCalledOnce();
    expect(selected.drawWithFit).toHaveBeenCalledWith(expect.anything(), {
      fit: "fill",
      rotation: 0,
      flip: false,
    });
  }
  expect(createBitmap).toHaveBeenCalledTimes(3);
  expect(canvasContext).toHaveBeenCalledWith("2d", { alpha: true });
});

it("demand-decodes only requested samples from an intra-coded prepared seek copy", async () => {
  qualityChosenBy = "auto";
  const prepared = "http://localhost/prepared.webm?hf-proxy=auto&hf-proxy-seek=1";
  previewSource.mockReturnValue(prepared);
  const decoded: ReturnType<typeof sample>[] = [];
  getSample.mockImplementation(async (_source: string, time: number) => {
    const value = sample(Math.floor(time * 30) / 30);
    decoded.push(value);
    return value;
  });
  const owner = provider(cfrFacts),
    item = request("a");
  for (const time of [0, 0.1, 0.4]) {
    const frames = await owner.decode([{ ...item, time }], signal());
    frames[0]!.release();
  }
  expect(iterateSamples).not.toHaveBeenCalled();
  expect(getSample).toHaveBeenCalledTimes(3);
  expect(getSample).toHaveBeenLastCalledWith(prepared, expect.closeTo(0.40001, 8));
  expect(createBitmap).toHaveBeenCalledTimes(3);
  for (const value of decoded) {
    expect(value.close).toHaveBeenCalledOnce();
    expect(value.drawWithFit).toHaveBeenCalledOnce();
  }
});

it("does not treat a marker inside another query value as a prepared seek copy", async () => {
  qualityChosenBy = "auto";
  previewSource.mockReturnValue("http://localhost/prepared.webm?label=hf-proxy-seek=1");
  iterateSamples.mockImplementation(async function* () {
    yield sample(0.1);
  });
  const owner = provider(cfrFacts),
    item = request("a");
  for (const time of [0, 0.1]) {
    const frames = await owner.decode([{ ...item, time }], signal());
    frames[0]!.release();
  }
  expect(iterateSamples).toHaveBeenCalledOnce();
  expect(getSample).toHaveBeenCalledOnce();
});

it("closes the sequential reader and uses demand decoding beyond the bounded forward gap", async () => {
  const returned = vi.fn();
  iterateSamples.mockImplementation(async function* () {
    try {
      yield sample(0.1);
      yield sample(0.2);
    } finally {
      returned();
    }
  });
  getSample.mockImplementation(async (_source: string, time: number) =>
    sample(Math.floor(time * 30) / 30),
  );
  const owner = provider(cfrFacts),
    item = request("a");
  for (const time of [0, 0.1, 1]) {
    const frames = await owner.decode([{ ...item, time }], signal());
    frames[0]!.release();
  }
  expect(returned).toHaveBeenCalledOnce();
  expect(getSample).toHaveBeenCalledTimes(2);
  expect(getSample).toHaveBeenLastCalledWith(item.source, expect.closeTo(1.00001, 8));
});

it("closes a raw sample arriving after cancellation without drawing it", async () => {
  let finish: ((result: { done: false; value: ReturnType<typeof sample> }) => void) | undefined;
  const next = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
    returned = vi.fn().mockResolvedValue({ done: true });
  iterateSamples.mockReturnValue({ next, return: returned });
  const owner = provider(cfrFacts),
    item = request("a");
  const initial = await owner.decode([item], signal());
  initial[0]!.release();
  const controller = new AbortController(),
    pending = owner.decode([{ ...item, time: 0.1 }], controller.signal);
  await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
  controller.abort();
  const late = sample(0.1);
  finish?.({ done: false, value: late });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(late.close).toHaveBeenCalledOnce();
  expect(late.drawWithFit).not.toHaveBeenCalled();
  expect(returned).toHaveBeenCalledOnce();
});

it("closes selected samples when rasterization or bitmap copying fails", async () => {
  const drawing = sample();
  drawing.drawWithFit.mockImplementationOnce(() => {
    throw new Error("drawing failed");
  });
  getSample.mockResolvedValueOnce(drawing);
  const owner = provider();
  await expect(owner.decode([request("a")], signal())).rejects.toThrow("drawing failed");
  expect(drawing.close).toHaveBeenCalledOnce();
  const copying = sample();
  getSample.mockResolvedValueOnce(copying);
  createBitmap.mockRejectedValueOnce(new Error("copying failed"));
  await expect(owner.decode([request("b")], signal())).rejects.toThrow("copying failed");
  expect(copying.close).toHaveBeenCalledOnce();
});

it("closes a demand sample completed after provider disposal before rasterization", async () => {
  let finish: ((value: ReturnType<typeof sample>) => void) | undefined;
  getSample.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const owner = provider(),
    pending = owner.decode([request("a")], signal());
  await vi.waitFor(() => expect(getSample).toHaveBeenCalledOnce());
  owner.dispose();
  const late = sample();
  finish?.(late);
  await expect(pending).rejects.toThrow("Preview disposed");
  expect(late.close).toHaveBeenCalledOnce();
  expect(late.drawWithFit).not.toHaveBeenCalled();
});

it("uses a smaller automatic drag raster and restores full quality for the settled request", async () => {
  qualityChosenBy = "auto";
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 1000,
    getDisplayHeight: async () => 500,
  }));
  const owner = provider({ "a.webm": { width: 1000, height: 500 } }),
    item = request("a");
  vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 2600, 1800));
  const drag = await owner.decode([{ ...item, settled: false }], signal());
  drag[0]!.release();
  const settled = await owner.decode([{ ...item, settled: true }], signal());
  settled[0]!.release();
  expect(createBitmap.mock.calls.map(([canvas]) => [canvas.width, canvas.height])).toEqual([
    [512, 256],
    [1000, 500],
  ]);
});

it("keeps person-chosen quality unchanged between dragging and settling", async () => {
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 1000,
    getDisplayHeight: async () => 500,
  }));
  const owner = provider({ "a.webm": { width: 1000, height: 500 } }),
    item = request("a");
  vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 2600, 1800));
  const drag = await owner.decode([{ ...item, settled: false }], signal());
  drag[0]!.release();
  const settled = await owner.decode([{ ...item, settled: true }], signal());
  settled[0]!.release();
  expect(createBitmap).toHaveBeenCalledOnce();
  expect(createBitmap.mock.calls[0]![0]).toMatchObject({ width: 1000, height: 500 });
  expect(inputs).toHaveLength(1);
});

it.each([
  { rotation: 0, flip: false, width: 320, height: 200 },
  { rotation: 90, flip: true, width: 200, height: 320 },
])(
  "preserves track rotation $rotation, flip and non-square-pixel display geometry",
  async ({ rotation, flip, width, height }) => {
    getTrack.mockImplementation(async (source: string) => ({
      ...track(source),
      getDisplayWidth: async () => width,
      getDisplayHeight: async () => height,
      getSquarePixelWidth: async () => 320,
      getSquarePixelHeight: async () => 200,
      getRotation: async () => rotation,
      getFlip: async () => flip,
    }));
    const decoded = sample();
    getSample.mockResolvedValueOnce(decoded);
    const [frame] = await provider().decode([request("a")], signal());
    expect(createBitmap.mock.calls[0]![0]).toMatchObject({ width, height });
    expect(decoded.drawWithFit).toHaveBeenCalledWith(expect.anything(), {
      fit: "fill",
      rotation,
      flip,
    });
    expect(frame).toMatchObject({ width, height });
    frame!.release();
  },
);
