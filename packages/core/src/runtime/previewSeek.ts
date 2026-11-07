import { PREVIEW_SEEK_HOLD_ATTR } from "../studioPreviewMark";
import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "../colorGrading";
import { isUnplayable, mediaSourceTimeAt } from "./media";
import type { RuntimeMediaClip } from "./types";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";

const HELD_VIDEO_ATTR = "data-hf-seek-video";
const SEEK_CAP_MS = 5000;
const EVENTS = ["loadedmetadata", "loadeddata", "canplay", "seeked", "error"] as const;

function videoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
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

/** Keep a displayed video in its layout slot while its decoder moves independently of the page. */
function holdVideoFrame(video: HTMLVideoElement): (() => void) | undefined {
  // Its grading canvas already holds the picture; hiding the source would retire that canvas on refresh.
  if (video.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR)) return;
  const css = getComputedStyle(video);
  if (css.display === "none" || css.visibility === "hidden" || video.readyState < 2) return;
  if (!video.videoWidth || !video.videoHeight) return;
  const canvas = videoFrame(video);
  if (!canvas) return;
  for (const name of Array.from(css)) canvas.style.setProperty(name, css.getPropertyValue(name));
  canvas.style.setProperty("animation", "none", "important");
  canvas.style.setProperty("transition", "none", "important");
  canvas.style.setProperty("pointer-events", "none", "important");
  canvas.setAttribute("data-layout-ignore", "");
  canvas.setAttribute("aria-hidden", "true");
  video.before(canvas);
  video.setAttribute(HELD_VIDEO_ATTR, "");
  return () => {
    video.removeAttribute(HELD_VIDEO_ATTR);
    canvas.remove();
  };
}

function holdVideoFrames(videos: HTMLVideoElement[]): () => void {
  const restore = videos.map(holdVideoFrame);
  const style = document.createElement("style");
  style.textContent = `[${HELD_VIDEO_ATTR}] { display: none !important; }`;
  document.head.appendChild(style);
  document.documentElement.setAttribute(PREVIEW_SEEK_HOLD_ATTR, "");
  return () => {
    for (const putBack of restore) putBack?.();
    style.remove();
    document.documentElement.removeAttribute(PREVIEW_SEEK_HOLD_ATTR);
  };
}

type SeekHost = {
  clipsAt: (time: number) => RuntimeMediaClip[];
  videosToHold: () => HTMLVideoElement[];
  scenesReadyAt: (time: number) => boolean;
  prepare: (clips: RuntimeMediaClip[], time: number) => void;
  commit: (time: number) => void;
};

/** One decoder job at a time; requests arriving during it replace the queued destination. */
export function createPreviewSeek(host: SeekHost) {
  let pending: { time: number; done: Promise<void>; resolve: () => void } | null = null;
  let releasePicture = () => {};
  let stopWaiting = () => {};
  let runningClips: RuntimeMediaClip[] = [];
  let runId = 0;

  const ready = (clips: RuntimeMediaClip[], time: number) =>
    host.scenesReadyAt(time) &&
    clips.every((clip) => {
      const { el } = clip;
      return (
        !el.isConnected ||
        isUnplayable(el) ||
        (el.readyState >= 2 &&
          !el.seeking &&
          Math.abs(el.currentTime - mediaSourceTimeAt(clip, time)) < 0.02)
      );
    });

  const cancel = () => {
    const request = pending;
    pending = null;
    runId++;
    stopWaiting();
    stopWaiting = () => {};
    releasePicture();
    releasePicture = () => {};
    request?.resolve();
  };

  const run = () => {
    const request = pending;
    if (!request) return;
    const id = ++runId;
    const time = request.time;
    const clips = host.clipsAt(time);
    runningClips = clips;
    let preparing = true;
    let finished = false;
    const finish = () => {
      if (finished || pending !== request || id !== runId) return;
      finished = true;
      stopWaiting();
      stopWaiting = () => {};
      if (request.time !== time) {
        if (ready(host.clipsAt(time), time)) {
          releasePicture();
          host.commit(time);
          releasePicture = holdVideoFrames(host.videosToHold());
        }
        run();
        return;
      }
      cancel();
      host.commit(time);
    };
    const check = () => {
      if (!preparing && ready(host.clipsAt(time), time)) finish();
    };
    const metadata = () => {
      if (pending !== request || finished || id !== runId) return;
      // A source/proxy change resets currentTime; the parked clock still describes the old picture.
      preparing = true;
      host.prepare(host.clipsAt(time), time);
      preparing = false;
      check();
    };
    const listeners = clips.map(({ el }) => {
      for (const type of EVENTS)
        el.addEventListener(type, type === "loadedmetadata" ? metadata : check, type === "error");
      return () => {
        for (const type of EVENTS)
          el.removeEventListener(
            type,
            type === "loadedmetadata" ? metadata : check,
            type === "error",
          );
      };
    });
    const cap = wallSetTimeout(finish, SEEK_CAP_MS);
    stopWaiting = () => {
      wallClearTimeout(cap);
      for (const remove of listeners) remove();
    };
    host.prepare(clips, time);
    preparing = false;
    check();
  };

  return {
    get time() {
      return pending?.time;
    },
    seek(time: number): Promise<void> | void {
      if (pending) {
        const request = pending;
        request.time = time;
        const clips = host.clipsAt(time);
        if (
          clips.length !== runningClips.length ||
          clips.some((clip, index) => clip.el !== runningClips[index]?.el)
        ) {
          stopWaiting();
          run();
        }
        return request.done;
      }
      if (ready(host.clipsAt(time), time)) {
        host.commit(time);
        return;
      }
      let resolve = () => {};
      const done = new Promise<void>((settle) => {
        resolve = settle;
      });
      pending = { time, done, resolve };
      releasePicture = holdVideoFrames(host.videosToHold());
      run();
      return done;
    },
    refresh() {
      if (!pending) return;
      stopWaiting();
      run();
    },
    cancel,
  };
}
