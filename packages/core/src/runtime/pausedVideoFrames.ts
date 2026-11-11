import { MEDIA_ELEMENT_LEAD_SECONDS } from "./mediaClock";
import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "../colorGrading";
import {
  installPausedVideoCallbacks,
  stagePausedVideoCallbacks,
  flushPausedVideoCallbacks,
  releasePausedVideoCallbacks,
  observeNativeVideoFrames,
} from "./pausedVideoCallbacks";
import {
  PREVIEW_VIDEO_FRAME_ATTR as FRAME_ATTR,
  PREVIEW_VIDEO_SOURCE_ATTR,
  PREVIEW_VIDEO_CANVAS_ATTR,
} from "../studioPreviewMark";

export interface PausedVideoFrameRequest {
  video: HTMLVideoElement;
  source: string;
  time: number;
  settled?: boolean;
}

export interface PausedVideoFrame {
  source: CanvasImageSource;
  timestamp: number;
  duration: number;
  width: number;
  height: number;
  release(): void;
}

/** Decoding lives in the host; core owns composition timing and presentation. */
export interface PausedVideoFrameProvider {
  decode(requests: PausedVideoFrameRequest[], signal: AbortSignal): Promise<PausedVideoFrame[]>;
  suspend?(): Promise<void>;
  dispose(): void;
}

export interface PreparedPausedVideoFrames {
  valid(): boolean;
  present(): boolean;
  refresh(): void;
  release(): void;
}

const SURFACE_BUDGET = 128 * 1024 * 1024;
type Presented = {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  time: number;
  driving: boolean;
  restoreTime: () => void;
  gpuFrame?: VideoFrame;
  stopWaiting?: () => void;
  // Paused frame replacement does not retry a source native playback already skipped.
  nativeSkipped?: boolean;
};
const presented = new Map<HTMLMediaElement, Presented>();
const authoredSeeks = new WeakSet<HTMLVideoElement>();

export function getPausedVideoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  return presented.get(video)?.canvas ?? null;
}

export function ownsPausedVideoTime(video: HTMLMediaElement): boolean {
  return presented.get(video)?.driving === true;
}

export function getPausedExternalVideoFrame(video: HTMLVideoElement): VideoFrame | null {
  const entry = presented.get(video);
  if (!entry || typeof VideoFrame === "undefined") return null;
  entry.gpuFrame ??= new VideoFrame(entry.canvas, { timestamp: Math.round(entry.time * 1e6) });
  return entry.gpuFrame;
}

export function captureNativeVideoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(video, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

export function nativeSnapshotStyle(video: HTMLVideoElement): CSSStyleDeclaration | null {
  if (getPausedVideoFrame(video)) return null;
  // Its grading canvas already holds the picture; hiding the source would retire that canvas on refresh.
  if (video.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR)) return null;
  const css = getComputedStyle(video);
  if (css.display === "none" || css.visibility === "hidden" || video.readyState < 2) return null;
  if (!video.videoWidth || !video.videoHeight) return null;
  return css;
}

function virtualTime(entry: Presented): void {
  let proto = Object.getPrototypeOf(entry.video);
  let descriptor: PropertyDescriptor | undefined;
  while (proto && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "currentTime");
    proto = Object.getPrototypeOf(proto);
  }
  const nativeSet = descriptor?.set;
  Object.defineProperty(entry.video, "currentTime", {
    configurable: true,
    get: () => entry.time,
    set: (value: number) => {
      if (Math.abs(value - entry.time) <= MEDIA_ELEMENT_LEAD_SECONDS * 2) return;
      authoredSeeks.add(entry.video);
      remove(entry);
      nativeSet?.call(entry.video, value);
    },
  });
  entry.restoreTime = () => {
    Reflect.deleteProperty(entry.video, "currentTime");
  };
}

function remove(entry: Presented): void {
  entry.stopWaiting?.();
  entry.restoreTime();
  releasePausedVideoCallbacks(entry.video);
  entry.gpuFrame?.close();
  entry.video.removeAttribute(FRAME_ATTR);
  entry.video.removeAttribute(PREVIEW_VIDEO_SOURCE_ATTR);
  entry.canvas.remove();
  entry.canvas.width = entry.canvas.height = 0;
  presented.delete(entry.video);
}

export function releasePausedVideoFrame(video: HTMLVideoElement): void {
  const entry = presented.get(video);
  if (entry) remove(entry);
}

function refresh(entry: Presented): void {
  const { video, canvas } = entry;
  video.removeAttribute(FRAME_ATTR);
  if (video.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR)) {
    canvas.remove();
    return;
  }
  const css = getComputedStyle(video);
  for (const key of Array.from(css)) {
    const value = css.getPropertyValue(key);
    if (canvas.style.getPropertyValue(key) !== value) canvas.style.setProperty(key, value);
  }
  if (css.position !== "absolute" && css.position !== "fixed") {
    canvas.style.position = "absolute";
    canvas.style.inset = "auto";
    canvas.style.left = `${video.offsetLeft}px`;
    canvas.style.top = `${video.offsetTop}px`;
    canvas.style.margin = "0";
  }
  canvas.style.setProperty("pointer-events", "none", "important");
  canvas.style.setProperty("animation", "none", "important");
  canvas.style.setProperty("transition", "none", "important");
  if (video.previousElementSibling !== canvas) video.before(canvas);
  video.setAttribute(FRAME_ATTR, "");
}

type ReusablePresentation = { entry: Presented; context: CanvasRenderingContext2D };

function markFrameCanvas(canvas: HTMLCanvasElement): void {
  canvas.setAttribute(PREVIEW_VIDEO_CANVAS_ATTR, "");
  canvas.setAttribute("data-layout-ignore", "");
  canvas.setAttribute("data-hyperframes-ignore", "");
  canvas.setAttribute("data-hyperframes-picker-ignore", "");
  canvas.setAttribute("data-hf-ignore", "");
  canvas.setAttribute("aria-hidden", "true");
}

function adoptStagedFrame(next: Presented, existing?: ReusablePresentation): void {
  if (existing) {
    const { entry, context } = existing;
    entry.stopWaiting?.();
    entry.stopWaiting = undefined;
    entry.gpuFrame?.close();
    entry.gpuFrame = undefined;
    context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    context.drawImage(next.canvas, 0, 0);
    next.canvas.width = next.canvas.height = 0;
    entry.time = next.time;
    if (!entry.driving) virtualTime(entry);
    entry.driving = true;
    return;
  }
  const { video, canvas } = next;
  releasePausedVideoFrame(video);
  markFrameCanvas(canvas);
  presented.set(video, next);
  video.setAttribute(PREVIEW_VIDEO_SOURCE_ATTR, "");
  virtualTime(next);
}

/** Keeps original nodes, URLs, intrinsic sizes and the displayed source clock intact. */
export function createPausedVideoFrames() {
  installPausedVideoCallbacks();
  let provider: PausedVideoFrameProvider | null = null;
  const style = document.createElement("style");
  style.textContent = `[${FRAME_ATTR}] { opacity: 0 !important; }`;
  const observer = new MutationObserver((records) => {
    for (const entry of [...presented.values()]) {
      if (
        !entry.video.isConnected ||
        records.some(
          (record) =>
            (record.type === "childList" && record.target === entry.video) ||
            (record.type === "attributes" &&
              record.attributeName === "src" &&
              (record.target === entry.video || record.target.parentElement === entry.video)),
        )
      )
        remove(entry);
      else if (records.some((record) => record.target.contains(entry.video))) refresh(entry);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "style", "class", "hidden", "data-hidden"],
  });

  const clear = (
    keep?: Set<HTMLVideoElement>,
    current?: (video: HTMLVideoElement, presented: boolean) => boolean,
  ) => {
    for (const entry of [...presented.values()]) {
      if (!keep?.has(entry.video)) {
        remove(entry);
        continue;
      }
      entry.nativeSkipped = true;
      const reveal = (nativeFrame: boolean) => {
        if (presented.get(entry.video) !== entry) return true;
        if (
          entry.video.readyState < 2 ||
          entry.video.seeking ||
          (current && !current(entry.video, nativeFrame))
        )
          return false;
        remove(entry);
        return true;
      };
      const ready = () => {
        reveal(false);
      };
      const events = ["loadeddata", "canplay", "seeked"];
      entry.stopWaiting?.();
      for (const event of events) entry.video.addEventListener(event, ready);
      const stopFrames = observeNativeVideoFrames(entry.video, () => reveal(true));
      entry.stopWaiting = () => {
        for (const event of events) entry.video.removeEventListener(event, ready);
        stopFrames();
      };
    }
    if (presented.size === 0) style.remove();
  };
  return {
    get active() {
      // A skipped native clip may keep a fallback picture without owning paused playback.
      return [...presented.values()].some((entry) => !entry.stopWaiting);
    },
    holdNative(videos: HTMLVideoElement[]) {
      const held: Presented[] = [];
      for (const video of videos) {
        if (!nativeSnapshotStyle(video)) continue;
        const canvas = captureNativeVideoFrame(video);
        if (!canvas) continue;
        const entry: Presented = {
          video,
          canvas,
          time: video.currentTime,
          driving: false,
          restoreTime: () => {},
        };
        held.push(entry);
        markFrameCanvas(canvas);
        presented.set(video, entry);
        video.setAttribute(PREVIEW_VIDEO_SOURCE_ATTR, "");
        if (!style.isConnected) document.head.append(style);
        refresh(entry);
      }
      return () => {
        for (const entry of held)
          if (presented.get(entry.video) === entry && !entry.driving) remove(entry);
      };
    },
    skipped: (el: HTMLMediaElement) => presented.get(el)?.nativeSkipped === true,
    retained: (el: HTMLMediaElement) => presented.get(el)?.stopWaiting !== undefined,
    available: () => provider !== null,
    setProvider(next: PausedVideoFrameProvider | null) {
      if (provider === next) return;
      provider?.dispose();
      provider = next;
    },
    async prepare(requests: PausedVideoFrameRequest[], signal: AbortSignal) {
      if (
        !provider ||
        requests.length === 0 ||
        requests.some(
          ({ video }) =>
            authoredSeeks.has(video) ||
            (!presented.has(video) && Object.hasOwn(video, "currentTime")),
        )
      )
        return null;
      const owner = provider;
      const identity = (video: HTMLVideoElement) =>
        JSON.stringify([
          video.src,
          ...Array.from(video.querySelectorAll("source"), (source) => source.src),
        ]);
      const sources = requests.map(({ video }) => identity(video));
      const frames = await owner.decode(requests, signal);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        for (const frame of frames) frame.release();
      };
      const current = () =>
        !signal.aborted &&
        provider === owner &&
        requests.every(
          ({ video }, index) => video.isConnected && identity(video) === sources[index],
        );
      if (!current()) {
        release();
        return null;
      }
      const valid =
        frames.reduce((sum, frame) => sum + frame.width * frame.height * 4, 0) <= SURFACE_BUDGET &&
        frames.length === requests.length &&
        frames.every((frame, index) => {
          const time = requests[index]!.time;
          return (
            frame.width > 0 &&
            frame.height > 0 &&
            frame.timestamp <= time + 1e-5 &&
            time < frame.timestamp + frame.duration + 1e-5
          );
        });
      if (!valid) {
        release();
        return null;
      }
      return {
        valid: current,
        present() {
          if (!current()) {
            release();
            return false;
          }
          const staged: Presented[] = [];
          const reusable = new Map<Presented, ReusablePresentation>();
          try {
            frames.forEach((frame, index) => {
              const { video, time } = requests[index]!;
              const canvas = document.createElement("canvas");
              canvas.width = frame.width;
              canvas.height = frame.height;
              staged.push({ video, canvas, time, driving: true, restoreTime: () => {} });
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Preview canvas unavailable");
              context.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
              const prior = presented.get(video);
              if (
                prior &&
                prior.canvas.width === frame.width &&
                prior.canvas.height === frame.height
              ) {
                const destination = prior.canvas.getContext("2d");
                if (!destination) throw new Error("Preview canvas unavailable");
                reusable.set(staged[staged.length - 1]!, { entry: prior, context: destination });
              }
            });
          } catch {
            for (const { canvas } of staged) canvas.width = canvas.height = 0;
            return false;
          } finally {
            release();
          }
          const wanted = new Set(requests.map(({ video }) => video));
          for (const entry of [...presented.values()]) if (!wanted.has(entry.video)) remove(entry);
          if (!style.isConnected) document.head.append(style);
          for (const [index, next] of staged.entries()) {
            adoptStagedFrame(next, reusable.get(next));
            const { timestamp, width, height } = frames[index]!;
            stagePausedVideoCallbacks(next.video, { mediaTime: timestamp, width, height });
          }
          return true;
        },
        refresh() {
          for (const entry of presented.values()) refresh(entry);
        },
        release,
      };
    },
    suspendProvider: () => provider?.suspend?.(),
    prepareNative() {
      for (const entry of presented.values()) {
        entry.driving = false;
        entry.restoreTime();
      }
    },
    notify() {
      for (const { video } of presented.values()) flushPausedVideoCallbacks(video);
    },
    clear,
    destroy() {
      observer.disconnect();
      clear();
      provider?.dispose();
      provider = null;
    },
  };
}
