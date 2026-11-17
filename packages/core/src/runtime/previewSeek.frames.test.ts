import { afterEach, expect, it, vi } from "vitest";
import { createPreviewSeek } from "./previewSeek";
import type { PreparedPausedVideoFrames } from "./pausedVideoFrames";
import { isUnplayable, syncRuntimeMedia } from "./media";
import type { RuntimeMediaClip } from "./types";

const jobs: ReturnType<typeof createPreviewSeek>[] = [];
afterEach(() => {
  for (const job of jobs.splice(0)) job.cancel();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const batch = (): PreparedPausedVideoFrames => ({
  valid: () => true,
  present: vi.fn(() => true),
  refresh: vi.fn(),
  release: vi.fn(),
});
function fixture() {
  const video = document.createElement("video");
  document.body.append(video);
  const clip: RuntimeMediaClip = {
    el: video,
    start: 0,
    duration: 10,
    end: 10,
    mediaStart: 0,
    playbackRate: 1,
    volume: null,
    loop: false,
    sourceDuration: 10,
  };
  const pending: Array<{
    signal: AbortSignal;
    resolve: (result: PreparedPausedVideoFrames | null) => void;
  }> = [];
  const commit = vi.fn();
  const native = vi.fn();
  const prepare = vi.fn(
    (_clips: RuntimeMediaClip[], _time: number, signal: AbortSignal) =>
      new Promise<PreparedPausedVideoFrames | null>((resolve) => pending.push({ signal, resolve })),
  );
  const host = {
    clipsAt: () => [clip],
    videosToHold: (): HTMLVideoElement[] => [],
    scenesReadyAt: () => true,
    prepare: native,
    commit,
    frames: {
      active: () => false,
      available: () => true,
      prepare,
      prepareNative: vi.fn(),
      clear: vi.fn(),
    },
  };
  const job = createPreviewSeek(host);
  jobs.push(job);
  return { job, commit, native, prepare, pending, video, clip, host };
}

it("presents coherent intermediate work while retaining the latest requested destination", async () => {
  const { job, commit, pending } = fixture();
  const done = job.seek(1);
  expect(job.seek(2)).toBe(done);
  const first = batch();
  pending[0]!.resolve(first);
  await Promise.resolve();
  expect(commit).toHaveBeenCalledWith(1);
  expect(job.time).toBe(2);
  expect(first.present).toHaveBeenCalledTimes(1);
  const last = batch();
  pending[1]!.resolve(last);
  await done;
  expect(commit.mock.calls.map(([time]) => time)).toEqual([1, 2]);
  expect(job.time).toBeUndefined();
});

it("does not rebuild document structure when no native snapshots need hiding", async () => {
  const { job, pending } = fixture();
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(document.head, { childList: true });
  const done = job.seek(1);
  job.seek(2);
  pending[0]!.resolve(batch());
  await Promise.resolve();
  pending[1]!.resolve(batch());
  await done;
  expect([...mutations, ...observer.takeRecords()]).toEqual([]);
  observer.disconnect();
});

it("resumes provider decoding when a scrub interrupts a native play handoff", async () => {
  const { job, commit, prepare, native, pending } = fixture();
  const initial = job.seek(1);
  pending[0]!.resolve(batch());
  await initial;
  const play = job.handoff(2);
  expect(native).toHaveBeenCalledTimes(1);
  const scrub = job.seek(3);
  await play;
  expect(prepare).toHaveBeenLastCalledWith(expect.any(Array), 3, expect.any(AbortSignal), false);
  pending[1]!.resolve(batch());
  await scrub;
  expect(commit.mock.calls.map(([time]) => time)).toEqual([1, 3]);
});

it("releases a decode that arrives after cancellation without presenting it", async () => {
  const { job, commit, pending } = fixture();
  const done = job.seek(1);
  job.cancel();
  expect(pending[0]!.signal.aborted).toBe(true);
  const late = batch();
  pending[0]!.resolve(late);
  await Promise.resolve();
  await done;
  expect(late.release).toHaveBeenCalledTimes(1);
  expect(late.present).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("lets a new gesture supersede a full-quality refinement without changing its destination", async () => {
  const { job, prepare, pending, commit } = fixture();
  const refining = job.refine(1);
  expect(prepare).toHaveBeenLastCalledWith(expect.any(Array), 1, expect.any(AbortSignal), true);
  const next = job.seek(2);
  expect(pending[0]!.signal.aborted).toBe(true);
  pending[0]!.resolve(batch());
  pending[1]!.resolve(batch());
  await Promise.all([refining, next]);
  expect(commit.mock.calls.map(([time]) => time)).toEqual([2]);
});

it("does not erase a seek requested synchronously while publishing the previous one", async () => {
  const { job, commit, pending } = fixture();
  commit.mockImplementationOnce(() => {
    job.seek(4);
  });
  const first = job.seek(1);
  pending[0]!.resolve(batch());
  await first;
  expect(job.time).toBe(4);
  pending[1]!.resolve(batch());
  await Promise.resolve();
  expect(commit.mock.calls.map(([time]) => time)).toEqual([1, 4]);
});

it("keeps a request-wide hard deadline through refresh and same-clip retarget", async () => {
  vi.useFakeTimers();
  const { job, commit } = fixture();
  const done = job.handoff(3);
  await vi.advanceTimersByTimeAsync(4900);
  job.refresh();
  await vi.advanceTimersByTimeAsync(4100);
  job.seek(4, true);
  expect(commit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  await done;
  expect(commit.mock.calls.map(([time]) => time)).toEqual([4]);
  expect(job.time).toBeUndefined();
});

it("does not reset a source already known to be unplayable on another Play", async () => {
  vi.useFakeTimers();
  const { job, commit, video, clip } = fixture();
  video.src = "/stopped.mp4";
  Object.defineProperties(video, {
    readyState: { value: 1, configurable: true },
    networkState: { value: 1, configurable: true },
  });
  video.play = vi.fn(async () => {});
  video.pause = vi.fn();
  syncRuntimeMedia({
    clips: [clip],
    timeSeconds: 0,
    playing: true,
    playbackRate: 1,
    getCompositionDuration: () => 10,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(isUnplayable(video)).toBe(true);
  const done = job.handoff(3);
  await Promise.resolve();
  await done;
  expect(commit).toHaveBeenLastCalledWith(3);
  expect(job.time).toBeUndefined();
});

it("preserves the held native picture when a new gesture cancels expired background work", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const { job, video, native, pending, prepare, host } = fixture();
  let ready = 4;
  let time = 0;
  Object.defineProperties(video, {
    readyState: { get: () => ready },
    networkState: { value: 2 },
    videoWidth: { value: 64 },
    videoHeight: { value: 36 },
    currentTime: { get: () => time },
  });
  host.videosToHold = () => [video];
  host.frames.active = () => true;
  native.mockImplementation((_clips, target) => {
    ready = 1;
    time = target;
  });
  prepare.mockResolvedValueOnce(null);
  const expired = job.seek(3);
  await vi.advanceTimersByTimeAsync(5000);
  await expired;
  expect(job.time).toBeUndefined();
  expect(job.targetTime).toBe(3);
  const picture = document.querySelector("canvas");
  expect(picture).not.toBeNull();
  const next = job.seek(4);
  expect(document.querySelector("canvas")).toBe(picture);
  pending[0]!.resolve(batch());
  await next;
  expect(document.querySelector("canvas")).toBeNull();
});

it("retires the hard Play timer after native readiness publishes", async () => {
  vi.useFakeTimers();
  const { job, video, commit } = fixture();
  Object.defineProperties(video, {
    readyState: { value: 4 },
    seeking: { value: false },
    currentTime: { value: 3 },
  });
  await job.handoff(3);
  expect(commit).toHaveBeenCalledWith(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("gives the native-only held picture the look of its video layer", async () => {
  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  window.__HF_MEDIA_SOURCE_FACTS__ = {
    "/clip.mp4": { width: 64, height: 36, bitDepth: 8, bitrate: 1 },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const { job, video, host, native } = fixture();
  video.setAttribute("src", "/clip.mp4");
  let ready = 4;
  Object.defineProperties(video, {
    readyState: { get: () => ready },
    videoWidth: { value: 64 },
    videoHeight: { value: 36 },
  });
  host.videosToHold = () => [video];
  host.frames.available = () => false;
  native.mockImplementation(() => {
    ready = 1;
  });
  const settled = job.handoff(3);
  expect(document.querySelector("canvas")?.style.filter).toMatch(/__hf_native_video_look/);
  job.cancel();
  await settled;
  delete window.__HF_MEDIA_SOURCE_FACTS__;
  vi.unstubAllGlobals();
});
