import {
  ALL_FORMATS,
  Input,
  UrlSource,
  VideoSampleSink,
  type Rotation,
  type VideoSample,
} from "mediabunny";
import {
  PREVIEW_PROXY_SEEK_PARAM,
  quantizePreviewProxyBox,
  type PreviewProxyBox,
} from "@hyperframes/core/preview-quality";
import type {
  PausedVideoFrame,
  PausedVideoFrameProvider,
  PausedVideoFrameRequest,
} from "@hyperframes/core";
import { frameDisplayScale } from "@hyperframes/core/runtime/protocol";
import { mediaUrlSourceOptions } from "./mediaFetch";
import { createSeekPreviewSources } from "./seekPreviewSource";
import { usePlayerStore } from "../store/playerStore";
import type { IframeWindow } from "./playbackTypes";
import {
  previewDecodeTime,
  previewPresentationTime,
  type PreviewVideoTiming,
} from "./previewVideoTime";

const FRAME_BUDGET = 64 * 1024 * 1024;
const MAX_READERS = 4;
const NEARBY_FORWARD_SECONDS = 0.5;

type Cached = {
  image: ImageBitmap;
  timestamp: number;
  duration: number;
  bytes: number;
  pins: number;
};
type Reader = {
  key: string;
  input: Input;
  cancelReads(): void;
  sink: VideoSampleSink;
  seekCopy: boolean;
  canvas: HTMLCanvasElement;
  rotation: Rotation;
  flip: boolean;
  width: number;
  height: number;
  lead: number;
  ticks: number;
  tail: Promise<void>;
  iterator: AsyncGenerator<VideoSample, void, unknown> | null;
  iteratorEnd: number;
  lastTime: number;
  cache: Map<number, Cached>;
  users: number;
  disposed: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
};

function normalizedBox(
  box: PreviewProxyBox,
  natural?: { width: number; height: number },
): PreviewProxyBox {
  if (!natural || Math.max(box.width / natural.width, box.height / natural.height) < 1) return box;
  return quantizePreviewProxyBox(natural.width, natural.height) ?? box;
}

function qualityBox(
  box: PreviewProxyBox,
  settled: boolean | undefined,
  automatic: boolean,
): PreviewProxyBox {
  if (settled || !automatic) return box;
  return quantizePreviewProxyBox(box.width / 2, box.height / 2) ?? box;
}

export function createPausedVideoDecoder(iframe: HTMLIFrameElement): PausedVideoFrameProvider {
  const readers = new Map<string, Promise<Reader>>();
  const opened = new Map<string, Reader>();
  const failed = new Map<string, number>();
  const dimensions = new Map<string, { width: number; height: number; lead: number }>();
  const fullBoxes = new Map<string, { context: string; box: PreviewProxyBox }>();
  const cacheOrder = new Map<Cached, Reader>();
  const copies = createSeekPreviewSources();
  let bytes = 0;
  let disposed = false;

  const sourceFacts = (source: string) => {
    let path = new URL(source, location.href).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {}
    return Object.entries(
      (iframe.contentWindow as IframeWindow | null)?.__HF_MEDIA_SOURCE_FACTS__ ?? {},
    )
      .filter(([suffix]) => path.endsWith(suffix))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1];
  };
  const naturalSize = ({ source, video }: PausedVideoFrameRequest) => {
    const known = dimensions.get(source) ?? sourceFacts(source);
    if (known?.width && known.height) return known;
    if (video.videoWidth > 0 && video.videoHeight > 0)
      return { width: video.videoWidth, height: video.videoHeight };
    return undefined;
  };

  const trim = (budget = FRAME_BUDGET) => {
    for (const [entry, reader] of cacheOrder) {
      if (bytes <= budget) break;
      if (entry.pins > 0) continue;
      cacheOrder.delete(entry);
      reader.cache.delete(entry.timestamp);
      bytes -= entry.bytes;
      entry.image.close();
    }
  };
  const disposeReader = async (reader: Reader) => {
    if (reader.disposed) return;
    reader.disposed = true;
    clearTimeout(reader.idleTimer);
    if (opened.get(reader.key) === reader) opened.delete(reader.key);
    reader.cancelReads();
    reader.input.dispose();
    await closeIterator(reader).catch(() => {});
    for (const entry of reader.cache.values()) {
      cacheOrder.delete(entry);
      bytes -= entry.bytes;
      entry.image.close();
    }
    reader.cache.clear();
    reader.canvas.width = reader.canvas.height = 0;
  };
  const scheduleIdle = (reader: Reader) => {
    clearTimeout(reader.idleTimer);
    if (
      reader.disposed ||
      reader.users > 0 ||
      [...reader.cache.values()].some((entry) => entry.pins > 0)
    )
      return;
    reader.idleTimer = setTimeout(() => {
      if (reader.users > 0 || [...reader.cache.values()].some((entry) => entry.pins > 0)) return;
      if (opened.get(reader.key) !== reader) return;
      readers.delete(reader.key);
      void disposeReader(reader);
    }, 10000);
  };
  const viewport = () => {
    const root = iframe.contentDocument?.documentElement;
    return {
      width: root?.clientWidth ?? 0,
      height: root?.clientHeight ?? 0,
      scale: frameDisplayScale(iframe) ?? 1,
      dpr: window.devicePixelRatio || 1,
    };
  };
  const learnedBox = (source: string, context: string, measured: PreviewProxyBox) => {
    const previous = fullBoxes.get(source);
    const box =
      previous?.context === context
        ? {
            width: Math.max(previous.box.width, measured.width),
            height: Math.max(previous.box.height, measured.height),
          }
        : measured;
    fullBoxes.set(source, { context, box });
    return box;
  };
  const boxOf = (request: PausedVideoFrameRequest): PreviewProxyBox => {
    const { video } = request;
    const rect = video.getBoundingClientRect();
    const view = viewport();
    const scale = view.scale * view.dpr;
    const { previewQuality: level, previewQualityChosenBy } = usePlayerStore.getState();
    const box = quantizePreviewProxyBox(
      Math.max(rect.width, view.width) * scale * level,
      Math.max(rect.height, view.height) * scale * level,
    ) ?? { width: 1024, height: 724 };
    const context = `${view.width}:${view.height}:${view.scale}:${view.dpr}:${level}`;
    const full = learnedBox(request.source, context, normalizedBox(box, naturalSize(request)));
    return qualityBox(full, request.settled, previewQualityChosenBy !== "person");
  };
  const open = async (source: string, box: PreviewProxyBox): Promise<Reader> => {
    const options = mediaUrlSourceOptions("thumbnail");
    const input = new Input({ source: new UrlSource(source, options), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || disposed) throw new Error("Preview video unavailable");
      const [width, height, lead, ticks, squareWidth, squareHeight, rotation, flip] =
        await Promise.all([
          track.getDisplayWidth(),
          track.getDisplayHeight(),
          track.getFirstTimestamp(),
          track.getTimeResolution(),
          track.getSquarePixelWidth(),
          track.getSquarePixelHeight(),
          track.getRotation(),
          track.getFlip(),
        ]);
      const ratio = Math.min(1, Math.max(box.width / width, box.height / height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(width * ratio));
      const aspect = rotation % 180 === 0 ? squareWidth / squareHeight : squareHeight / squareWidth;
      canvas.height = Math.max(1, Math.round(canvas.width / aspect));
      return {
        key: `${source}|${box.width}x${box.height}`,
        input,
        cancelReads: options.cancelReads,
        sink: new VideoSampleSink(track),
        seekCopy: new URL(source, location.href).searchParams.get(PREVIEW_PROXY_SEEK_PARAM) === "1",
        canvas,
        rotation,
        flip,
        width,
        height,
        lead,
        ticks,
        tail: Promise.resolve(),
        iterator: null,
        iteratorEnd: 0,
        lastTime: -Infinity,
        cache: new Map(),
        users: 0,
        disposed: false,
      };
    } catch (error) {
      input.dispose();
      options.cancelReads();
      throw error;
    }
  };
  const reserveReader = () => {
    for (const [oldKey] of readers) {
      if (readers.size < MAX_READERS) break;
      const old = opened.get(oldKey);
      if (old && old.users === 0 && ![...old.cache.values()].some((entry) => entry.pins > 0)) {
        readers.delete(oldKey);
        void disposeReader(old);
      }
    }
    if (readers.size >= MAX_READERS) throw new Error("Preview decoder budget reached");
  };
  const readerFor = async (source: string, box: PreviewProxyBox): Promise<Reader> => {
    const key = `${source}|${box.width}x${box.height}`;
    if ((failed.get(key) ?? 0) > performance.now()) throw new Error("Preview decoder cooling down");
    let promise = readers.get(key);
    if (!promise) {
      reserveReader();
      promise = open(source, box);
      readers.set(key, promise);
    }
    readers.delete(key);
    readers.set(key, promise);
    let reader: Reader;
    try {
      reader = await promise;
    } catch (error) {
      if (readers.get(key) === promise) readers.delete(key);
      failed.set(key, performance.now() + 5000);
      throw error;
    }
    if (disposed || reader.disposed) throw new DOMException("Preview disposed", "AbortError");
    opened.set(key, reader);
    reader.users++;
    clearTimeout(reader.idleTimer);
    return reader;
  };
  const closeIterator = async (reader: Reader) => {
    const iterator = reader.iterator;
    reader.iterator = null;
    await iterator?.return();
  };
  const checkActive = (reader: Reader, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (disposed || reader.disposed) throw new Error("Preview disposed");
  };
  const readForward = async (reader: Reader, query: number, signal: AbortSignal) => {
    if (!reader.iterator) {
      reader.iteratorEnd = query + 8;
      reader.iterator = reader.sink.samples(query, reader.iteratorEnd);
    }
    for (;;) {
      checkActive(reader, signal);
      const next = await reader.iterator.next();
      if (next.done) return null;
      const sample = next.value;
      let selected = false;
      try {
        checkActive(reader, signal);
        if (sample.timestamp > query + 1e-6) return null;
        selected = sample.timestamp + sample.duration > query + 1e-6;
        if (selected) return sample;
      } finally {
        if (!selected) sample.close();
      }
    }
  };
  const pin = (reader: Reader, entry: Cached) => {
    entry.pins++;
    cacheOrder.delete(entry);
    cacheOrder.set(entry, reader);
    return entry;
  };
  const cacheFrame = async (
    reader: Reader,
    sample: VideoSample,
    time: number,
    timing: PreviewVideoTiming,
    signal: AbortSignal,
  ): Promise<Cached> => {
    const context = reader.canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Preview canvas unavailable");
    context.clearRect(0, 0, reader.canvas.width, reader.canvas.height);
    context.imageSmoothingQuality = "high";
    sample.drawWithFit(context, { fit: "fill", rotation: reader.rotation, flip: reader.flip });
    const image = await createImageBitmap(reader.canvas);
    if (signal.aborted || disposed) {
      image.close();
      signal.throwIfAborted();
      throw new Error("Preview disposed");
    }
    const entry = {
      image,
      ...previewPresentationTime(sample.timestamp, time, timing),
      bytes: image.width * image.height * 4,
      pins: 1,
    };
    const previous = reader.cache.get(entry.timestamp);
    if (previous) {
      previous.duration = Math.max(previous.duration, entry.duration);
      image.close();
      return pin(reader, previous);
    }
    trim(FRAME_BUDGET - entry.bytes);
    if (bytes + entry.bytes > FRAME_BUDGET) {
      image.close();
      throw new Error("Preview frame budget reached");
    }
    reader.cache.set(entry.timestamp, entry);
    cacheOrder.set(entry, reader);
    bytes += entry.bytes;
    return entry;
  };
  const nearbyForward = (reader: Reader, time: number, timing: PreviewVideoTiming) =>
    !reader.seekCopy &&
    !timing.variableFrameRate &&
    (timing.frameRate ?? 0) > 0 &&
    time > reader.lastTime + 1e-6 &&
    time - reader.lastTime <= NEARBY_FORWARD_SECONDS;
  const readFrame = async (
    reader: Reader,
    time: number,
    timing: PreviewVideoTiming,
    signal: AbortSignal,
  ): Promise<Cached> => {
    checkActive(reader, signal);
    const cached = [...reader.cache.values()].find(
      (entry) => time >= entry.timestamp - 1e-6 && time < entry.timestamp + entry.duration - 1e-6,
    );
    if (cached) return pin(reader, cached);
    const query = previewDecodeTime(time, timing),
      forward = nearbyForward(reader, time, timing);
    let sample: VideoSample | null = null;
    try {
      if (!forward || query >= reader.iteratorEnd) await closeIterator(reader);
      sample = forward ? await readForward(reader, query, signal) : null;
      if (!sample) {
        await closeIterator(reader);
        sample = await reader.sink.getSample(query);
      }
      if (!sample) throw new Error("No preview frame at requested time");
      checkActive(reader, signal);
      reader.lastTime = time;
      return await cacheFrame(reader, sample, time, timing, signal);
    } finally {
      sample?.close();
      if (signal.aborted || disposed) await closeIterator(reader).catch(() => {});
    }
  };
  const sourceTiming = (request: PausedVideoFrameRequest, source: string, reader: Reader) => {
    if (source === request.source)
      dimensions.set(request.source, {
        width: reader.width,
        height: reader.height,
        lead: reader.lead,
      });
    const facts = sourceFacts(request.source);
    const natural = dimensions.get(request.source) ?? {
      width: reader.width,
      height: reader.height,
      lead: reader.lead,
    };
    return {
      natural,
      timing: {
        frameRate: facts?.frameRate,
        variableFrameRate: facts?.variableFrameRate,
        sourceLead: natural.lead,
        inputLead: reader.lead,
        timeResolution: reader.ticks,
      },
    };
  };
  const decodeOne = async (
    request: PausedVideoFrameRequest,
    signal: AbortSignal,
  ): Promise<PausedVideoFrame> => {
    signal.throwIfAborted();
    const box = boxOf(request);
    const automatic = usePlayerStore.getState().previewQualityChosenBy !== "person";
    const source = automatic ? copies.get(request.source, box) : request.source;
    const reader = await readerFor(source, box);
    try {
      const { natural, timing } = sourceTiming(request, source, reader);
      const at = performance.now();
      const job = reader.tail.then(() => readFrame(reader, request.time, timing, signal));
      reader.tail = job.then(
        () => {},
        () => {},
      );
      const entry = await job;
      const { previewQualityChosenBy } = usePlayerStore.getState();
      if (performance.now() - at > 100 && previewQualityChosenBy !== "person")
        copies.prepare(request.source, box);
      let released = false;
      trim();
      return {
        source: entry.image,
        timestamp: entry.timestamp,
        duration: entry.duration,
        width: natural.width,
        height: natural.height,
        release() {
          if (released) return;
          released = true;
          entry.pins--;
          trim();
          scheduleIdle(reader);
        },
      };
    } finally {
      reader.users--;
      scheduleIdle(reader);
    }
  };
  return {
    async decode(requests, signal) {
      if (disposed) throw new DOMException("Preview disposed", "AbortError");
      if (new Set(requests.map(({ source }) => source)).size > MAX_READERS)
        throw new Error("Preview decoder budget reached");
      const results = await Promise.allSettled(
        requests.map((request) => decodeOne(request, signal)),
      );
      const failure = results.find((result) => result.status === "rejected");
      const frames = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (failure || disposed || signal.aborted) {
        for (const frame of frames) frame.release();
        if (failure) throw failure.reason;
        throw new DOMException("Preview cancelled", "AbortError");
      }
      return frames;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      copies.dispose();
      for (const promise of readers.values()) void promise.then(disposeReader).catch(() => {});
      readers.clear();
      dimensions.clear();
      fullBoxes.clear();
      failed.clear();
    },
  };
}
