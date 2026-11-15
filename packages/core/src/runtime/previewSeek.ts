import { PREVIEW_SEEK_HOLD_ATTR } from "../studioPreviewMark";
import { isUnplayable, mediaSourceTimeAt } from "./media";
import type { RuntimeMediaClip } from "./types";
import { isVideoElement } from "./domRealm";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";
import { applyNativeVideoLook } from "./nativeVideoLook";
import {
  nativeSnapshotStyle,
  captureNativeVideoFrame,
  type PreparedPausedVideoFrames,
} from "./pausedVideoFrames";

const HELD_VIDEO_ATTR = "data-hf-seek-video";
const SEEK_CAP_MS = 5000;
const EVENTS = ["loadedmetadata", "loadeddata", "canplay", "seeked", "error"] as const;

/** Keep a displayed video in its layout slot while its decoder moves independently of the page. */
function holdVideoFrame(video: HTMLVideoElement): (() => void) | undefined {
  const css = nativeSnapshotStyle(video);
  if (!css) return;
  const canvas = captureNativeVideoFrame(video);
  if (!canvas) return;
  for (const name of Array.from(css)) canvas.style.setProperty(name, css.getPropertyValue(name));
  applyNativeVideoLook(canvas, video, css.filter || "none");
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
    skipped?(el: HTMLMediaElement): boolean;
    hold?(videos: HTMLVideoElement[]): (() => void) | undefined;
    prepare(
      clips: RuntimeMediaClip[],
      time: number,
      signal: AbortSignal,
      settled?: boolean,
    ): Promise<PreparedPausedVideoFrames | null>;
    suspend?(): Promise<void> | undefined;
    prepareNative(): void;
    clear(keep?: Set<HTMLVideoElement>): void;
  };
};

/** One preparation at a time; publish coherent progress and coalesce newer destinations. */
export function createPreviewSeek(host: SeekHost) {
  type SeekRequest = {
    time: number;
    native: boolean;
    settled: boolean;
    deadline?: ReturnType<typeof wallSetTimeout>;
    decoderRelease?: Promise<void> | null;
    force: () => void;
    done: Promise<void>;
    resolve: () => void;
  };
  let pending: SeekRequest | null = null;
  // Recovery keeps its listeners without blocking paused transport work.
  let recovery: SeekRequest | null = null;
  let releasePicture: (() => void) | null = null;
  const frameHolds: Array<() => void> = [];
  let stopWaiting = () => {};
  let runningClips: RuntimeMediaClip[] = [];
  let cancelWork = () => {};
  let committing = false;
  let committingSettled = false;
  let runId = 0;

  const needsPreparation = (native: boolean) => native || host.frames?.available();

  const nativeReady = ({ el, ...clip }: RuntimeMediaClip, time: number) =>
    !el.isConnected ||
    (el.readyState >= 2 &&
      !el.seeking &&
      Math.abs(el.currentTime - mediaSourceTimeAt({ el, ...clip }, time)) < 0.02);
  const ready = (clips: RuntimeMediaClip[], time: number) =>
    host.scenesReadyAt(time) &&
    clips.every(
      (clip) => isUnplayable(clip.el) || host.frames?.skipped?.(clip.el) || nativeReady(clip, time),
    );

  const releaseHeldPicture = () => {
    releasePicture?.();
    releasePicture = null;
  };
  const clearFrames = (clips: RuntimeMediaClip[], native: boolean, time: number) =>
    host.frames?.clear(
      native
        ? new Set(
            clips.flatMap((clip) =>
              isVideoElement(clip.el) && !nativeReady(clip, time) ? [clip.el] : [],
            ),
          )
        : undefined,
    );

  const retireRequest = (request: SeekRequest | null) => {
    if (pending === request) pending = null;
    if (recovery === request) recovery = null;
    wallClearTimeout(request?.deadline);
  };
  const holdPicture = () => {
    const videos = host.videosToHold();
    const release = host.frames?.hold?.(videos);
    if (release) frameHolds.push(release);
    releasePicture ??= holdVideoFrames(videos);
  };
  const cancel = (keepPicture = false) => {
    const request = pending ?? recovery;
    retireRequest(request);
    runId++;
    stopWaiting();
    stopWaiting = () => {};
    cancelWork();
    cancelWork = () => {};
    if (!keepPicture) {
      releaseHeldPicture();
      for (const release of frameHolds.splice(0)) release();
    }
    request?.resolve();
  };

  const afterDecoderRelease = (request: SeekRequest, start: () => void) => {
    if (request.decoderRelease === undefined) {
      try {
        request.decoderRelease = host.frames?.suspend?.() ?? null;
      } catch {
        request.decoderRelease = null;
      }
    }
    if (request.decoderRelease) void request.decoderRelease.then(start, start);
    else start();
  };

  const run = () => {
    const request = pending ?? recovery;
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
    const live = () => (pending === request || recovery === request) && runId === id && !finished;
    cancelWork = () => {
      controller.abort();
      frame?.release();
    };

    const publish = () => {
      frameHolds.length = 0;
      releaseHeldPicture();
      if (!frame) clearFrames(host.clipsAt(time), request.native, time);
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
          if (pending !== request && recovery !== request) return;
          holdPicture();
        }
        run();
        return;
      }
      retireRequest(request);
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
    request.force = () => {
      if (!live()) return;
      if (request.time === time) finish();
      else {
        stopWaiting();
        run();
        request.force();
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
    const expire = () => {
      if (!live()) return;
      if (request.native) check();
      else if (!nativePhase && !frame) {
        native();
        if (live()) cap = wallSetTimeout(expire, SEEK_CAP_MS);
      } else if (host.frames?.active?.()) {
        pending = null;
        recovery = request;
        request.resolve();
      } else finish();
    };
    let cap = wallSetTimeout(expire, SEEK_CAP_MS);
    stopWaiting = () => {
      wallClearTimeout(cap);
      for (const remove of listeners) remove();
    };
    if (request.native) afterDecoderRelease(request, native);
    else if (recovery !== request && host.frames && needsPreparation(request.native)) {
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
    if (recovery) cancel(true);
    if (pending && (pending.native !== native || pending.settled !== settled)) cancel(true);
    if (pending) return retarget(time);
    if (!needsPreparation(native) && ready(host.clipsAt(time), time)) {
      releaseHeldPicture();
      clearFrames(host.clipsAt(time), native, time);
      host.commit(time);
      return;
    }
    let resolve = () => {};
    const done = new Promise<void>((settle) => {
      resolve = settle;
    });
    const request = { time, native, settled, done, resolve, force: () => {} };
    pending = request;
    // Refreshing a run must not restart the wall-clock budget for Play.
    if (native) pending.deadline = wallSetTimeout(() => request.force(), SEEK_CAP_MS * 2);
    holdPicture();
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
    get targetTime() {
      return (pending ?? recovery)?.time;
    },
    ownsRecovery(el: HTMLMediaElement) {
      return recovery !== null && runningClips.some((clip) => clip.el === el);
    },
    seek,
    refine(time: number) {
      return seek(time, false, true);
    },
    refresh() {
      if (pending || recovery) {
        stopWaiting();
        run();
      }
    },
    handoff(time: number) {
      cancel(true);
      host.frames?.prepareNative();
      return seek(time, true);
    },
    cancel,
  };
}
