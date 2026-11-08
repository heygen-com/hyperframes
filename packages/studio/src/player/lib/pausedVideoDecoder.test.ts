// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPausedVideoDecoder } from "./pausedVideoDecoder";

const inputs: { source: string; dispose: ReturnType<typeof vi.fn> }[] = [];
const getTrack = vi.fn();
const getSample = vi.fn();
const cancelReads = vi.fn();
const iterateSamples = vi.fn();
const finiteSamples = vi.fn();
const canvasContext = vi.fn();
const createBitmap = vi.fn();
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
    samplesAtTimestamps(times: Iterable<number>) {
      return finiteSamples(this.track.source, times);
    }
  },
}));
vi.mock("./mediaFetch", () => ({ mediaUrlSourceOptions: () => ({ cancelReads }) }));
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
  canBeTransparent: async () => false,
});

beforeEach(() => {
  inputs.length = 0;
  getTrack.mockReset().mockImplementation(async (source: string) => track(source));
  getSample.mockReset().mockImplementation(async () => sample());
  iterateSamples.mockReset();
  finiteSamples.mockReset().mockImplementation(async function* (
    source: string,
    times: Iterable<number>,
  ) {
    for (const time of times) yield await getSample(source, time);
  });
  canvasContext.mockReset().mockReturnValue({ clearRect: vi.fn(), imageSmoothingQuality: "low" });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(canvasContext);
  createBitmap.mockReset().mockImplementation(async () => bitmap());
  cancelReads.mockReset();
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

it("keeps original resolution across hidden cuts, viewport changes and automatic playback quality", async () => {
  qualityChosenBy = "app";
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 2100,
    getDisplayHeight: async () => 1800,
  }));
  const owner = provider({ "a.webm": { width: 2100, height: 1800 } });
  for (const [width, scale, quality] of [
    [2300, 1, 1],
    [0, 0.5, 0.25],
    [400, 0.25, 0.5],
  ]) {
    displayScale = scale!;
    previewQuality = quality!;
    const item = request("a");
    vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, 200));
    const frames = await owner.decode([item], signal());
    frames[0]!.release();
  }
  expect(inputs).toHaveLength(1);
  expect(inputs[0]!.source).toBe("http://localhost/a.webm");
  expect(createBitmap.mock.calls[0]![0]).toMatchObject({ width: 2100, height: 1800 });
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

it("keeps original pixels throughout automatic dragging and settling", async () => {
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
    [1000, 500],
  ]);
});

it("restores full paused resolution after automatic playback quality was lowered", async () => {
  qualityChosenBy = "app";
  previewQuality = 0.25;
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    getDisplayWidth: async () => 1000,
    getDisplayHeight: async () => 500,
  }));
  const owner = provider({ "a.webm": { width: 1000, height: 500 } });
  const item = request("a");
  vi.spyOn(item.video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 500));
  const frame = await owner.decode([{ ...item, settled: true }], signal());
  frame[0]!.release();
  expect(createBitmap.mock.calls[0]![0]).toMatchObject({ width: 1000, height: 500 });
});

it("uses original resolution even when a lower playback quality was saved", async () => {
  previewQuality = 0.25;
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

it("releases sequential decoders before native playback and lazily recreates them", async () => {
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
  for (const time of [0, 0.1]) {
    const [frame] = await owner.decode([{ ...item, time }], signal());
    frame!.release();
  }
  expect(returned).not.toHaveBeenCalled();
  await owner.suspend!();
  expect(returned).toHaveBeenCalledOnce();
  expect(inputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(cancelReads).toHaveBeenCalledOnce();
  const [next] = await owner.decode([{ ...item, time: 0.2 }], signal());
  expect(inputs).toHaveLength(2);
  expect([next!.width, next!.height]).toEqual([100, 100]);
  next!.release();
});

it("closes a bitmap copied after native-play suspension without retaining its decoder", async () => {
  let finish: ((image: ReturnType<typeof bitmap>) => void) | undefined;
  createBitmap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const owner = provider();
  const pending = owner.decode([request("a")], signal());
  await vi.waitFor(() => expect(createBitmap).toHaveBeenCalledOnce());
  await owner.suspend!();
  const image = bitmap();
  finish!(image);
  await expect(pending).rejects.toThrow("Preview disposed");
  expect(image.close).toHaveBeenCalledOnce();
  const [next] = await owner.decode([request("a")], signal());
  expect(inputs).toHaveLength(2);
  next!.release();
});

it("does not poison a reopened source when an older suspended input settles late", async () => {
  let rejectOpen: (error: Error) => void = () => {};
  getTrack.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOpen = reject;
      }),
  );
  const owner = provider();
  const old = owner.decode([request("a")], signal());
  await vi.waitFor(() => expect(inputs).toHaveLength(1));
  const suspended = owner.suspend!();
  expect(inputs[0]!.dispose).toHaveBeenCalled();
  const [current] = await owner.decode([request("a")], signal());
  current!.release();
  rejectOpen(new DOMException("Suspended", "AbortError"));
  await expect(old).rejects.toMatchObject({ name: "AbortError" });
  await suspended;
  const [cached] = await owner.decode([request("a")], signal());
  expect(inputs).toHaveLength(2);
  expect(inputs[1]!.dispose).not.toHaveBeenCalled();
  cached!.release();
});

it("uses finite queries for alpha tracks while preserving original dimensions and closing samples", async () => {
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    canBeTransparent: async () => true,
  }));
  const samples = [sample(0), sample(0.1), sample(0.2)];
  getSample.mockImplementation(async () => samples[getSample.mock.calls.length - 1]);
  iterateSamples.mockImplementation(async function* () {
    yield sample(0.1);
    yield sample(0.2);
  });
  const owner = provider(cfrFacts),
    item = request("a");
  for (const time of [0, 0.1, 0.2]) {
    const [frame] = await owner.decode([{ ...item, time }], signal());
    expect([frame!.width, frame!.height]).toEqual([100, 100]);
    frame!.release();
  }
  expect(iterateSamples).not.toHaveBeenCalled();
  expect(getSample).toHaveBeenCalledTimes(3);
  for (const frame of samples) expect(frame.close).toHaveBeenCalledOnce();
  await owner.suspend!();
});

it.each(["suspend", "dispose"] as const)(
  "drains an in-flight alpha query before %s",
  async (action) => {
    getTrack.mockImplementation(async (source: string) => ({
      ...track(source),
      canBeTransparent: async () => true,
    }));
    let finish: (value: ReturnType<typeof sample>) => void = () => {};
    getSample.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const owner = provider();
    const pending = owner.decode([request("a")], signal());
    await vi.waitFor(() => expect(getSample).toHaveBeenCalledOnce());
    const rejected = expect(pending).rejects.toThrow("Preview disposed");
    const suspended = action === "suspend" ? owner.suspend!() : owner.dispose();
    await Promise.resolve();
    expect(inputs[0]!.dispose).not.toHaveBeenCalled();
    expect(cancelReads).not.toHaveBeenCalled();
    if (action === "suspend") {
      const [next] = await owner.decode([request("a")], signal());
      expect(inputs).toHaveLength(2);
      next!.release();
    }
    const final = sample();
    finish(final);
    await rejected;
    await suspended;
    expect(final.close).toHaveBeenCalledOnce();
    expect(inputs[0]!.dispose).toHaveBeenCalledOnce();
    if (action === "suspend") expect(inputs[1]!.dispose).not.toHaveBeenCalled();
  },
);

it("finishes the alpha timestamp iterator before publishing its selected sample", async () => {
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    canBeTransparent: async () => true,
  }));
  let drain: () => void = () => {};
  const drained = new Promise<void>((resolve) => {
    drain = resolve;
  });
  const selected = sample();
  finiteSamples.mockImplementation(async function* () {
    yield selected;
    await drained;
  });
  const owner = provider();
  let published = false;
  const decoding = owner.decode([request("a")], signal()).then((frames) => {
    published = true;
    return frames;
  });
  await vi.waitFor(() => expect(finiteSamples).toHaveBeenCalledOnce());
  await Promise.resolve();
  expect(published).toBe(false);
  expect(createBitmap).not.toHaveBeenCalled();
  drain();
  const [frame] = await decoding;
  expect(selected.close).toHaveBeenCalledOnce();
  frame!.release();
});

it("closes the selected alpha sample when the finite iterator fails while draining", async () => {
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    canBeTransparent: async () => true,
  }));
  const selected = sample();
  finiteSamples.mockImplementation(async function* () {
    yield selected;
    throw new Error("Alpha drain failed");
  });
  const owner = provider();
  await expect(owner.decode([request("a")], signal())).rejects.toThrow("Alpha drain failed");
  expect(selected.close).toHaveBeenCalledOnce();
});

it("bounds alpha suspension without disposing an unfinished merger", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    canBeTransparent: async () => true,
  }));
  let drain: () => void = () => {};
  const drained = new Promise<void>((resolve) => {
    drain = resolve;
  });
  const selected = sample();
  finiteSamples.mockImplementationOnce(async function* () {
    yield selected;
    await drained;
  });
  const owner = provider();
  const pending = owner.decode([request("a")], signal()).catch((error: unknown) => error);
  await vi.waitFor(() => expect(finiteSamples).toHaveBeenCalledOnce());
  let released = false;
  const suspended = owner.suspend!().then(() => {
    released = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(2000);
    expect(released).toBe(true);
    expect(cancelReads).toHaveBeenCalledOnce();
    expect(inputs[0]!.dispose).not.toHaveBeenCalled();
    expect(selected.close).not.toHaveBeenCalled();
    const [next] = await owner.decode([request("a")], signal());
    expect(inputs).toHaveLength(2);
    next!.release();
  } finally {
    drain();
    await pending;
    await suspended;
  }
  expect(selected.close).toHaveBeenCalledOnce();
  expect(inputs[0]!.dispose).toHaveBeenCalledOnce();
  expect(inputs[1]!.dispose).not.toHaveBeenCalled();
});

it("closes the selected alpha sample when suspension cancels an in-flight read", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  getTrack.mockImplementation(async (source: string) => ({
    ...track(source),
    canBeTransparent: async () => true,
  }));
  const selected = sample();
  let rejectRead: (error: Error) => void = () => {};
  const reading = new Promise<void>((_resolve, reject) => {
    rejectRead = reject;
  });
  finiteSamples.mockImplementationOnce(async function* () {
    yield selected;
    await reading;
  });
  cancelReads.mockImplementation(() =>
    rejectRead(new DOMException("Network read cancelled", "AbortError")),
  );
  const owner = provider();
  const decoding = owner.decode([request("a")], signal()).catch((error: unknown) => error);
  await vi.waitFor(() => expect(finiteSamples).toHaveBeenCalledOnce());
  const suspended = owner.suspend!();
  await vi.advanceTimersByTimeAsync(1999);
  expect(cancelReads).not.toHaveBeenCalled();
  expect(inputs[0]!.dispose).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await suspended;
  expect(await decoding).toMatchObject({ name: "AbortError" });
  expect(selected.close).toHaveBeenCalledOnce();
  expect(inputs[0]!.dispose).toHaveBeenCalledOnce();
});
