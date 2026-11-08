import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  flushPausedVideoCallbacks,
  installPausedVideoCallbacks,
  observeNativeVideoFrames,
  releasePausedVideoCallbacks,
  stagePausedVideoCallbacks,
} from "./pausedVideoCallbacks";

const proto = HTMLVideoElement.prototype;
const originalRequest = Object.getOwnPropertyDescriptor(proto, "requestVideoFrameCallback");
const originalCancel = Object.getOwnPropertyDescriptor(proto, "cancelVideoFrameCallback");
const pending = new Map<number, { video: HTMLVideoElement; callback: VideoFrameRequestCallback }>();
let nextHandle = 100;
const nativeRequest = vi.fn(function (this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
  const handle = ++nextHandle;
  pending.set(handle, { video: this, callback });
  return handle;
});
const nativeCancel = vi.fn(function (this: HTMLVideoElement, handle: number) {
  if (pending.get(handle)?.video === this) pending.delete(handle);
});

beforeEach(() => {
  pending.clear();
  nextHandle = 100;
  nativeRequest.mockClear();
  nativeCancel.mockClear();
  Object.defineProperty(proto, "requestVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: nativeRequest,
  });
  Object.defineProperty(proto, "cancelVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: nativeCancel,
  });
  installPausedVideoCallbacks();
});
afterEach(() => {
  if (originalRequest) Object.defineProperty(proto, "requestVideoFrameCallback", originalRequest);
  else Reflect.deleteProperty(proto, "requestVideoFrameCallback");
  if (originalCancel) Object.defineProperty(proto, "cancelVideoFrameCallback", originalCancel);
  else Reflect.deleteProperty(proto, "cancelVideoFrameCallback");
  pending.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function metadata(mediaTime: number, presentedFrames: number): VideoFrameCallbackMetadata {
  return {
    mediaTime,
    presentedFrames,
    width: 1920,
    height: 1080,
    presentationTime: 123,
    expectedDisplayTime: 125,
    processingDuration: 0.003,
  };
}
function deliverNative(handle: number, frame: VideoFrameCallbackMetadata) {
  const request = pending.get(handle);
  expect(request).toBeDefined();
  pending.delete(handle);
  request!.callback(120, frame);
}
const frame = (mediaTime: number) => ({ mediaTime, width: 1920, height: 1080 });

it("forwards native timing and cancellation when no paused frame owns the video", () => {
  const video = document.createElement("video");
  const callback = vi.fn();
  const id = video.requestVideoFrameCallback(callback);
  expect(nativeRequest.mock.contexts[0]).toBe(video);
  expect(id).toBe(101);
  const nativeFrame = metadata(0.5, 15);
  deliverNative(id, nativeFrame);
  expect(callback).toHaveBeenCalledExactlyOnceWith(120, nativeFrame);
  expect(callback.mock.lastCall?.[1]).toBe(nativeFrame);
  const cancelled = video.requestVideoFrameCallback(callback);
  video.cancelVideoFrameCallback(cancelled);
  expect(nativeCancel).toHaveBeenLastCalledWith(cancelled);
  expect(nativeCancel.mock.contexts.at(-1)).toBe(video);
  expect(pending.has(cancelled)).toBe(false);
  video.cancelVideoFrameCallback(999);
  expect(nativeCancel).toHaveBeenLastCalledWith(999);
});

it("reports one presented frame to multiple native observers without counting each callback as a frame", () => {
  const video = document.createElement("video");
  const first = vi.fn();
  const second = vi.fn();
  const firstId = video.requestVideoFrameCallback(first);
  const secondId = video.requestVideoFrameCallback(second);
  deliverNative(firstId, metadata(0.2, 6));
  deliverNative(secondId, metadata(0.2, 6));
  expect(first.mock.lastCall?.[1].presentedFrames).toBe(6);
  expect(second.mock.lastCall?.[1].presentedFrames).toBe(6);
  const afterReload = vi.fn();
  const next = video.requestVideoFrameCallback(afterReload);
  deliverNative(next, metadata(0, 1));
  expect(afterReload.mock.lastCall?.[1].presentedFrames).toBe(1);
});

it("preserves native callback receiver and reports authored failures without skipping other observers", () => {
  const video = document.createElement("video");
  const callback = vi.fn();
  const id = video.requestVideoFrameCallback(callback);
  const receiver = {};
  const native = pending.get(id)!;
  native.callback.call(receiver, 120, metadata(0.2, 6));
  expect(callback.mock.contexts[0]).toBe(receiver);
  const report = vi.fn();
  vi.stubGlobal("reportError", report);
  const failure = new Error("authored effect failed");
  video.requestVideoFrameCallback(() => {
    throw failure;
  });
  const later = vi.fn();
  video.requestVideoFrameCallback(later);
  stagePausedVideoCallbacks(video, frame(1));
  flushPausedVideoCallbacks(video);
  expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  expect(later).toHaveBeenCalledTimes(1);
});

it("publishes one-shot synthetic callbacks with the staged dimensions and source clock", () => {
  vi.spyOn(performance, "now").mockReturnValue(300);
  const video = document.createElement("video");
  const callback = vi.fn();
  const id = video.requestVideoFrameCallback(callback);
  stagePausedVideoCallbacks(video, frame(3.5));
  expect(callback).not.toHaveBeenCalled();
  flushPausedVideoCallbacks(video);
  expect(callback).toHaveBeenCalledExactlyOnceWith(300, {
    ...frame(3.5),
    presentedFrames: 1,
    presentationTime: 300,
    expectedDisplayTime: 300,
    processingDuration: 0,
  });
  expect(nativeCancel).toHaveBeenCalledWith(id);
  expect(pending.has(id)).toBe(false);
  flushPausedVideoCallbacks(video);
  stagePausedVideoCallbacks(video, frame(4));
  flushPausedVideoCallbacks(video);
  expect(callback).toHaveBeenCalledTimes(1);
});

it("defers a callback registered by a callback until the next published frame", () => {
  const video = document.createElement("video");
  const observed: number[] = [];
  const callback: VideoFrameRequestCallback = (_now, info) => {
    observed.push(info.mediaTime);
    video.requestVideoFrameCallback(callback);
  };
  video.requestVideoFrameCallback(callback);
  stagePausedVideoCallbacks(video, frame(1));
  flushPausedVideoCallbacks(video);
  flushPausedVideoCallbacks(video);
  expect(observed).toEqual([1]);
  stagePausedVideoCallbacks(video, frame(2));
  flushPausedVideoCallbacks(video);
  expect(observed).toEqual([1, 2]);
  expect(pending.size).toBe(1);
});

it("honors cancellation of a later observer while a synthetic notification batch is running", () => {
  const video = document.createElement("video");
  const cancelled = vi.fn();
  video.requestVideoFrameCallback(() => video.cancelVideoFrameCallback(later));
  const later = video.requestVideoFrameCallback(cancelled);
  stagePausedVideoCallbacks(video, frame(1));
  flushPausedVideoCallbacks(video);
  expect(cancelled).not.toHaveBeenCalled();
  expect(nativeCancel).toHaveBeenCalledWith(later);
  expect(pending.size).toBe(0);
});

it("suppresses native metadata while a paused frame owns the pixels and publishes the staged frame instead", () => {
  const video = document.createElement("video");
  const callback = vi.fn();
  const id = video.requestVideoFrameCallback(callback);
  stagePausedVideoCallbacks(video, frame(4));
  deliverNative(id, metadata(0.5, 15));
  expect(callback).not.toHaveBeenCalled();
  flushPausedVideoCallbacks(video);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.lastCall?.[1]).toMatchObject({ mediaTime: 4, presentedFrames: 1 });
  expect(nativeCancel).not.toHaveBeenCalled();
});

it("rearms a native callback consumed during pause and still cancels it using the original public handle", () => {
  const video = document.createElement("video");
  const callback = vi.fn();
  const publicId = video.requestVideoFrameCallback(callback);
  stagePausedVideoCallbacks(video, frame(3));
  deliverNative(publicId, metadata(1, 30));
  releasePausedVideoCallbacks(video);
  expect(callback).not.toHaveBeenCalled();
  expect(nativeRequest).toHaveBeenCalledTimes(2);
  const rearmedId = nativeRequest.mock.results.at(-1)!.value;
  expect(rearmedId).not.toBe(publicId);
  expect(pending.has(rearmedId)).toBe(true);
  releasePausedVideoCallbacks(video);
  expect(nativeRequest).toHaveBeenCalledTimes(2);
  video.cancelVideoFrameCallback(publicId);
  expect(nativeCancel).toHaveBeenLastCalledWith(rearmedId);
  expect(pending.size).toBe(0);
});

it("resumes the pending observer on native frames after handoff", () => {
  const video = document.createElement("video");
  const callback = vi.fn();
  const publicId = video.requestVideoFrameCallback(callback);
  stagePausedVideoCallbacks(video, frame(3));
  deliverNative(publicId, metadata(1, 30));
  releasePausedVideoCallbacks(video);
  const rearmedId = nativeRequest.mock.results.at(-1)!.value;
  deliverNative(rearmedId, metadata(3.033, 31));
  expect(callback).toHaveBeenCalledExactlyOnceWith(120, metadata(3.033, 31));
  expect(pending.size).toBe(0);
});

it("installs once without double-wrapping request or cancellation", () => {
  const request = proto.requestVideoFrameCallback;
  const cancel = proto.cancelVideoFrameCallback;
  installPausedVideoCallbacks();
  expect(proto.requestVideoFrameCallback).toBe(request);
  expect(proto.cancelVideoFrameCallback).toBe(cancel);
  const callback = vi.fn();
  const video = document.createElement("video");
  video.requestVideoFrameCallback(callback);
  stagePausedVideoCallbacks(video, frame(1));
  flushPausedVideoCallbacks(video);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(nativeRequest).toHaveBeenCalledTimes(1);
});

it("invalidates the actual vendored Three VideoTexture before redraw and continues natively after release", async () => {
  const { VideoTexture } =
    await import("../../../../registry/examples/path-traced-3d/assets/vendor/three-path-tracer.min.js");
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: 4 });
  const texture = new VideoTexture(video);
  texture.update();
  expect(texture.version).toBe(0);
  stagePausedVideoCallbacks(video, frame(3));
  flushPausedVideoCallbacks(video);
  expect(texture.version).toBe(1);
  texture.update();
  expect(texture.version).toBe(1);
  stagePausedVideoCallbacks(video, frame(4));
  flushPausedVideoCallbacks(video);
  expect(texture.version).toBe(2);
  // The native decoder can finish a warm seek while provider pixels remain displayed.
  const waitingId = [...pending.keys()][0]!;
  deliverNative(waitingId, metadata(4, 120));
  expect(texture.version).toBe(2);
  releasePausedVideoCallbacks(video);
  const resumedId = [...pending.keys()][0]!;
  deliverNative(resumedId, metadata(4.033, 121));
  expect(texture.version).toBe(3);
  texture.dispose();
  expect(pending.size).toBe(0);
});

it("observes native frames independently of staged authored callbacks", () => {
  const video = document.createElement("video");
  const authored = vi.fn();
  video.requestVideoFrameCallback(authored);
  stagePausedVideoCallbacks(video, frame(3));
  const recovered = vi.fn(() => true);
  const stop = observeNativeVideoFrames(video, recovered);
  deliverNative(102, metadata(3.05, 2));
  expect(recovered).toHaveBeenCalledOnce();
  expect(authored).not.toHaveBeenCalled();
  flushPausedVideoCallbacks(video);
  expect(authored).toHaveBeenCalledOnce();
  expect(authored.mock.lastCall?.[1].mediaTime).toBe(3);
  stop();
});

it("cancels a re-armed native observer and ignores an already queued callback", () => {
  const video = document.createElement("video");
  const recovered = vi.fn(() => false);
  const stop = observeNativeVideoFrames(video, recovered);
  deliverNative(101, metadata(3, 1));
  const queued = pending.get(102)!;
  stop();
  expect(pending.has(102)).toBe(false);
  queued.callback(130, metadata(3.05, 2));
  expect(recovered).toHaveBeenCalledOnce();
  expect(pending.size).toBe(0);
});

it("uses playing and progressing time when opacity defers a native callback", () => {
  const video = document.createElement("video");
  let paused = true;
  let time = 3;
  Object.defineProperties(video, {
    paused: { get: () => paused },
    currentTime: { get: () => time },
  });
  const recovered = vi.fn(() => true);
  const stop = observeNativeVideoFrames(video, recovered);
  video.dispatchEvent(new Event("timeupdate"));
  expect(recovered).not.toHaveBeenCalled();
  paused = false;
  video.dispatchEvent(new Event("playing"));
  video.dispatchEvent(new Event("timeupdate"));
  expect(recovered).not.toHaveBeenCalled();
  time += 1 / 30;
  video.dispatchEvent(new Event("timeupdate"));
  expect(recovered).toHaveBeenCalledOnce();
  expect(pending.size).toBe(0);
  stop();
});

it("keeps waiting when no native frame or playback progress arrives", () => {
  const video = document.createElement("video");
  const recovered = vi.fn(() => true);
  const stop = observeNativeVideoFrames(video, recovered);
  for (let i = 0; i < 3; i++) video.dispatchEvent(new Event("timeupdate"));
  expect(recovered).not.toHaveBeenCalled();
  expect(pending.size).toBe(1);
  stop();
  expect(pending.size).toBe(0);
});

it("does not reveal a paused seek from timeupdate after playback had started", () => {
  const video = document.createElement("video");
  let paused = false;
  let time = 3;
  Object.defineProperties(video, {
    paused: { get: () => paused },
    currentTime: { get: () => time },
  });
  const recovered = vi.fn(() => true);
  const stop = observeNativeVideoFrames(video, recovered);
  paused = true;
  time = 4;
  video.dispatchEvent(new Event("timeupdate"));
  expect(recovered).not.toHaveBeenCalled();
  paused = false;
  video.dispatchEvent(new Event("playing"));
  time += 1 / 30;
  video.dispatchEvent(new Event("timeupdate"));
  expect(recovered).toHaveBeenCalledOnce();
  stop();
});
