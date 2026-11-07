import { PREVIEW_SEEK_HOLD_ATTR } from "../studioPreviewMark";
import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "../colorGrading";
import { isUnplayable, mediaSourceTimeAt } from "./media";
import type { RuntimeMediaClip } from "./types";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";
import { getPausedVideoFrame, type PreparedPausedVideoFrames } from "./pausedVideoFrames";

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

function heldVideoStyle(video: HTMLVideoElement): CSSStyleDeclaration | null {
  if (getPausedVideoFrame(video)) return null;
  // Its grading canvas already holds the picture; hiding the source would retire that canvas on refresh.
  if (video.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR)) return null;
  const css = getComputedStyle(video);
  if (css.display === "none" || css.visibility === "hidden" || video.readyState < 2) return null;
  if (!video.videoWidth || !video.videoHeight) return null;
  return css;
}

/** Keep a displayed video in its layout slot while its decoder moves independently of the page. */
function holdVideoFrame(video: HTMLVideoElement): (() => void) | undefined {
  const css = heldVideoStyle(video);
  if (!css) return;
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
  if (restore.some(Boolean)) document.head.appendChild(style);
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
  frames?: {
    available(): boolean;
    active?(): boolean;
    prepare(
      clips: RuntimeMediaClip[],
      time: number,
      signal: AbortSignal,
      settled?: boolean,
    ): Promise<PreparedPausedVideoFrames | null>;
    suspend?(): Promise<void> | undefined;
    prepareNative(): void;
    clear(): void;
  };
};

/** One preparation at a time; publish coherent progress and coalesce newer destinations. */
export function createPreviewSeek(host: SeekHost) {
  let pending: {
    time: number;
    native: boolean;
    settled: boolean;
    done: Promise<void>;
    resolve: () => void;
  } | null = null;
  let releasePicture = () => {};
  let stopWaiting = () => {};
  let runningClips: RuntimeMediaClip[] = [];
  let cancelWork = () => {};
  let committing = false;
  let committingSettled = false;
  let runId = 0;

  const ready = (clips: RuntimeMediaClip[], time: number) =>
    host.scenesReadyAt(time) &&
    clips.every(
      ({ el, ...clip }) =>
        !el.isConnected ||
        isUnplayable(el) ||
        (el.readyState >= 2 &&
          !el.seeking &&
          Math.abs(el.currentTime - mediaSourceTimeAt({ el, ...clip }, time)) < 0.02),
    );

  const cancel = () => {
    const request = pending;
    pending = null;
    runId++;
    stopWaiting();
    stopWaiting = () => {};
    cancelWork();
    cancelWork = () => {};
    releasePicture();
    releasePicture = () => {};
    request?.resolve();
  };

  const run = () => {
    const request = pending;
    if (!request) return;
    cancelWork();
    const id = ++runId;
    const time = request.time;
    const clips = host.clipsAt(time);
    runningClips = clips;
    const selection = clips.map((clip) => ({ el: clip.el, time: mediaSourceTimeAt(clip, time) }));
    const controller = new AbortController();
    let frame: PreparedPausedVideoFrames | null = null;
    let preparing = true;
    let nativePhase = false;
    let finished = false;
    const live = () => pending === request && runId === id && !finished;
    cancelWork = () => {
      controller.abort();
      frame?.release();
    };

    const publish = () => {
      releasePicture();
      releasePicture = () => {};
      if (!frame) host.frames?.clear();
      committing = true;
      committingSettled = request.settled;
      try {
        host.commit(time);
        frame?.refresh();
      } finally {
        committing = false;
        committingSettled = false;
      }
    };
    const selectionChanged = () => {
      const current = host.clipsAt(time);
      return (
        current.length !== selection.length ||
        current.some(
          (clip, index) =>
            clip.el !== selection[index]?.el ||
            Math.abs(mediaSourceTimeAt(clip, time) - selection[index]!.time) > 1e-8,
        )
      );
    };
    const frameReadyToPublish = () => {
      if (!frame) return true;
      if (selectionChanged()) {
        stopWaiting();
        run();
        return false;
      }
      if (!frame.valid() || !frame.present()) {
        native();
        return false;
      }
      return true;
    };
    const finish = () => {
      if (!live() || !frameReadyToPublish()) return;
      finished = true;
      stopWaiting();
      stopWaiting = () => {};
      if (request.time !== time) {
        if (frame || ready(host.clipsAt(time), time)) {
          publish();
          if (pending !== request) return;
          releasePicture = holdVideoFrames(host.videosToHold());
        }
        run();
        return;
      }
      pending = null;
      runId++;
      const cleanup = cancelWork;
      cancelWork = () => {};
      try {
        publish();
      } finally {
        cleanup();
        request.resolve();
      }
    };
    const check = () => {
      if (preparing || !live()) return;
      if (frame ? host.scenesReadyAt(time) : ready(host.clipsAt(time), time)) finish();
    };
    const native = () => {
      if (!live() || nativePhase) return;
      nativePhase = true;
      controller.abort();
      frame?.release();
      frame = null;
      host.frames?.prepareNative();
      host.prepare(host.clipsAt(time), time);
      preparing = false;
      check();
    };
    const metadata = () => {
      if (!live()) return;
      if (!nativePhase) {
        check();
        return;
      }
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
    let cap = wallSetTimeout(() => {
      if (!nativePhase && !frame) {
        native();
        if (live()) cap = wallSetTimeout(finish, SEEK_CAP_MS);
      } else if (request.native || host.frames?.active?.()) check();
      else finish();
    }, SEEK_CAP_MS);
    stopWaiting = () => {
      wallClearTimeout(cap);
      for (const remove of listeners) remove();
    };
    if (!request.native && host.frames?.available()) {
      void host.frames
        .prepare(clips, time, controller.signal, request.settled)
        .then((decoded) => {
          if (!live() || controller.signal.aborted) {
            decoded?.release();
            return;
          }
          if (!decoded) return native();
          frame = decoded;
          preparing = false;
          check();
        })
        .catch(native);
    } else native();
  };

  const retarget = (time: number) => {
    const request = pending!;
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
  };
  const seek = (time: number, native = false, settled = false): Promise<void> | void => {
    if (pending && (pending.native !== native || pending.settled !== settled)) cancel();
    if (pending) return retarget(time);
    if ((native || !host.frames?.available()) && ready(host.clipsAt(time), time)) {
      host.frames?.clear();
      host.commit(time);
      return;
    }
    let resolve = () => {};
    const done = new Promise<void>((settle) => {
      resolve = settle;
    });
    pending = { time, native, settled, done, resolve };
    releasePicture = holdVideoFrames(host.videosToHold());
    run();
    return done;
  };
  return {
    get committing() {
      return committing;
    },
    get refining() {
      return committingSettled;
    },
    get time() {
      return pending?.time;
    },
    seek,
    refine(time: number) {
      return seek(time, false, true);
    },
    refresh() {
      if (pending) {
        stopWaiting();
        run();
      }
    },
    handoff(time: number) {
      cancel();
      host.frames?.prepareNative();
      const generation = runId;
      const suspended = host.frames?.suspend?.();
      if (suspended)
        return suspended.then(() => {
          if (generation === runId) return seek(time, true);
        });
      return seek(time, true);
    },
    cancel,
  };
}
