import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createPausedVideoFrames,
  getPausedVideoFrame,
  ownsPausedVideoTime,
  type PausedVideoFrameProvider,
} from "./pausedVideoFrames";

const sessions: ReturnType<typeof createPausedVideoFrames>[] = [];
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function fixture() {
  const session = createPausedVideoFrames();
  sessions.push(session);
  const video = document.createElement("video");
  video.src = "/original.webm";
  video.style.cssText = "position:absolute;width:64px;height:36px;transform:translateX(10px)";
  document.body.append(video);
  Object.defineProperty(video, "videoWidth", { value: 64 });
  Object.defineProperty(video, "videoHeight", { value: 36 });
  const release = vi.fn();
  const provider: PausedVideoFrameProvider = {
    decode: vi.fn(async () => [
      {
        source: document.createElement("canvas"),
        timestamp: 3,
        duration: 1 / 30,
        width: 64,
        height: 36,
        release,
      },
    ]),
    dispose: vi.fn(),
  };
  session.setProvider(provider);
  const request = [{ video, source: video.src, time: 3 }];
  return { session, video, provider, request, release };
}

it("presents decoded pixels with the authored source, dimensions, layout and displayed source clock", async () => {
  const { session, video, provider, request, release } = fixture();
  const originalSrc = video.src;
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  video.style.transform = "translateX(25px)";
  batch!.refresh();
  const canvas = getPausedVideoFrame(video)!;
  expect([video.src, video.videoWidth, video.videoHeight, video.currentTime]).toEqual([
    originalSrc,
    64,
    36,
    3,
  ]);
  expect(canvas.style.transform).toBe("translateX(25px)");
  expect(canvas.nextElementSibling).toBe(video);
  expect(ownsPausedVideoTime(video)).toBe(true);
  expect(release).toHaveBeenCalledTimes(1);
  session.prepareNative();
  expect(Object.hasOwn(video, "currentTime")).toBe(false);
  expect(ownsPausedVideoTime(video)).toBe(false);
  expect(getPausedVideoFrame(video)).toBe(canvas);
  session.clear();
  expect(getPausedVideoFrame(video)).toBeNull();
  expect(canvas.width).toBe(0);
  expect(video.hasAttribute("data-hf-preview-video-frame")).toBe(false);
  session.destroy();
  expect(provider.dispose).toHaveBeenCalledTimes(1);
});

it("releases a late decode when its request is aborted or its source changes", async () => {
  const { session, video, request, release } = fixture();
  const controller = new AbortController();
  const batch = session.prepare(request, controller.signal);
  controller.abort();
  expect(await batch).toBeNull();
  expect(release).toHaveBeenCalledTimes(1);
  const changed = session.prepare(request, new AbortController().signal);
  video.src = "/replacement.webm";
  expect(await changed).toBeNull();
  expect(release).toHaveBeenCalledTimes(2);
  expect(getPausedVideoFrame(video)).toBeNull();
});

it("does not surrender decoded presentation for the runtime's native seek padding", async () => {
  const { session, video, request } = fixture();
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  batch!.refresh();
  const canvas = getPausedVideoFrame(video);
  video.currentTime = 3.00001;
  expect(ownsPausedVideoTime(video)).toBe(true);
  expect(getPausedVideoFrame(video)).toBe(canvas);
  expect(video.currentTime).toBe(3);
});

it("gives an authored seek back to native media and preserves an existing currentTime override", async () => {
  const { session, video, request } = fixture();
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  video.currentTime = 7;
  expect(video.currentTime).toBe(7);
  expect(getPausedVideoFrame(video)).toBeNull();
  expect(await session.prepare(request, new AbortController().signal)).toBeNull();
  const custom = document.createElement("video");
  Object.defineProperty(custom, "currentTime", { value: 2, configurable: true });
  expect(
    await session.prepare([{ ...request[0]!, video: custom }], new AbortController().signal),
  ).toBeNull();
  expect(custom.currentTime).toBe(2);
});

it("rejects a neighbouring frame that does not cover the requested presentation time", async () => {
  const { session, provider, request, release } = fixture();
  vi.mocked(provider.decode).mockResolvedValue([
    {
      source: document.createElement("canvas"),
      timestamp: 2,
      duration: 1 / 30,
      width: 64,
      height: 36,
      release,
    },
  ]);
  expect(await session.prepare(request, new AbortController().signal)).toBeNull();
  expect(release).toHaveBeenCalledTimes(1);
});

it("retains the whole previous presentation when staging a new layer fails", async () => {
  const { session, video, request, release } = fixture();
  const first = await session.prepare(request, new AbortController().signal);
  first!.present();
  first!.refresh();
  const previous = getPausedVideoFrame(video);
  const second = await session.prepare(request, new AbortController().signal);
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
  expect(second!.present()).toBe(false);
  expect(getPausedVideoFrame(video)).toBe(previous);
  expect(video.currentTime).toBe(3);
  expect(release).toHaveBeenCalledTimes(2);
});

it("revalidates source identity after preparing a frame and before publishing it", async () => {
  const { session, video, request, release } = fixture();
  const prepared = await session.prepare(request, new AbortController().signal);
  video.src = "/edited.mp4";
  expect(prepared!.valid()).toBe(false);
  expect(prepared!.present()).toBe(false);
  expect(getPausedVideoFrame(video)).toBeNull();
  expect(release).toHaveBeenCalledTimes(1);
});

it("reuses display surfaces across updates and removes them when source children are replaced", async () => {
  const { session, video, request } = fixture();
  const first = await session.prepare(request, new AbortController().signal);
  first!.present();
  first!.refresh();
  const canvas = getPausedVideoFrame(video);
  const next = await session.prepare(request, new AbortController().signal);
  next!.present();
  next!.refresh();
  expect(getPausedVideoFrame(video)).toBe(canvas);
  video.append(document.createElement("source"));
  await Promise.resolve();
  expect(getPausedVideoFrame(video)).toBeNull();
  expect(Object.hasOwn(video, "currentTime")).toBe(false);
});

it("keeps the displayed surface in sync with paused editing without releasing decoded pixels", async () => {
  const { session, video, request } = fixture();
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  batch!.refresh();
  const canvas = getPausedVideoFrame(video)!;
  video.style.transform = "translateX(80px)";
  video.style.opacity = "0.4";
  video.style.width = "80px";
  await Promise.resolve();
  expect(getPausedVideoFrame(video)).toBe(canvas);
  expect(canvas.style.transform).toBe("translateX(80px)");
  expect(canvas.style.opacity).toBe("0.4");
  expect(canvas.style.width).toBe("80px");
  expect(video.currentTime).toBe(3);
});

it("holds a full-size native snapshot through original-source provider replacement", async () => {
  const { session, video, request } = fixture();
  Object.defineProperty(video, "readyState", { value: 4 });
  session.holdNative([video]);
  const snapshot = getPausedVideoFrame(video)!;
  expect([snapshot.width, snapshot.height]).toEqual([64, 36]);
  expect(snapshot.hasAttribute("data-hyperframes-picker-ignore")).toBe(true);
  expect(ownsPausedVideoTime(video)).toBe(false);
  const decoded = await session.prepare(request, new AbortController().signal);
  expect(decoded!.present()).toBe(true);
  expect(getPausedVideoFrame(video)).toBe(snapshot);
  expect(ownsPausedVideoTime(video)).toBe(true);
  expect(video.currentTime).toBe(3);
});

it("cancels a retained native observer when a new paused picture replaces it", async () => {
  const proto = HTMLVideoElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "requestVideoFrameCallback");
  const originalCancel = Object.getOwnPropertyDescriptor(proto, "cancelVideoFrameCallback");
  let queued: VideoFrameRequestCallback = () => {};
  const cancel = vi.fn();
  Object.defineProperty(proto, "requestVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: (callback: VideoFrameRequestCallback) => {
      queued = callback;
      return 123;
    },
  });
  Object.defineProperty(proto, "cancelVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: cancel,
  });
  try {
    const { session, video, request } = fixture();
    const first = await session.prepare(request, new AbortController().signal);
    first!.present();
    session.prepareNative();
    session.clear(new Set([video]), () => false);
    const replacement = await session.prepare(request, new AbortController().signal);
    replacement!.present();
    const picture = getPausedVideoFrame(video);
    expect(cancel).toHaveBeenCalledWith(123);
    queued(0, {
      mediaTime: 3,
      width: 64,
      height: 36,
      presentedFrames: 1,
      presentationTime: 0,
      expectedDisplayTime: 0,
      processingDuration: 0,
    });
    expect(getPausedVideoFrame(video)).toBe(picture);
    expect(ownsPausedVideoTime(video)).toBe(true);
  } finally {
    if (original) Object.defineProperty(proto, "requestVideoFrameCallback", original);
    else Reflect.deleteProperty(proto, "requestVideoFrameCallback");
    if (originalCancel) Object.defineProperty(proto, "cancelVideoFrameCallback", originalCancel);
    else Reflect.deleteProperty(proto, "cancelVideoFrameCallback");
  }
});

it("does not retire an adopted decoded picture when its native snapshot lease ends", async () => {
  const { session, video, request } = fixture();
  Object.defineProperty(video, "readyState", { value: 4 });
  const stopHold = session.holdNative([video]);
  const snapshot = getPausedVideoFrame(video);
  const decoded = await session.prepare(request, new AbortController().signal);
  expect(decoded!.present()).toBe(true);
  stopHold();
  expect(getPausedVideoFrame(video)).toBe(snapshot);
  expect(ownsPausedVideoTime(video)).toBe(true);
  expect(video.currentTime).toBe(3);
});

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

it("shows a paused frame with the look its video layer has, and the authored filter after it", async () => {
  vi.stubGlobal("navigator", { userAgent: MAC_CHROME });
  window.__HF_MEDIA_SOURCE_FACTS__ = {
    "/original.webm": { width: 64, height: 36, bitDepth: 8, bitrate: 1 },
  };
  const { session, video, request } = fixture();
  video.style.filter = "blur(2px)";
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  batch!.refresh();
  expect(getPausedVideoFrame(video)!.style.filter).toMatch(
    /^url\("?#__hf_native_video_look"?\) blur\(2px\)$/,
  );
  delete window.__HF_MEDIA_SOURCE_FACTS__;
  vi.unstubAllGlobals();
});

it("leaves the paused frame of an HDR source as decoded", async () => {
  vi.stubGlobal("navigator", { userAgent: MAC_CHROME });
  window.__HF_MEDIA_SOURCE_FACTS__ = {
    "/original.webm": { width: 64, height: 36, bitDepth: 10, bitrate: 1 },
  };
  const { session, video, request } = fixture();
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  batch!.refresh();
  expect(getPausedVideoFrame(video)!.style.filter).not.toContain("__hf_native_video_look");
  delete window.__HF_MEDIA_SOURCE_FACTS__;
  vi.unstubAllGlobals();
});

it("leaves the paused frame of a source the scan did not report as it was decoded", async () => {
  vi.stubGlobal("navigator", { userAgent: MAC_CHROME });
  const { session, video, request } = fixture();
  const batch = await session.prepare(request, new AbortController().signal);
  batch!.present();
  batch!.refresh();
  expect(getPausedVideoFrame(video)!.style.filter).not.toContain("__hf_native_video_look");
  vi.unstubAllGlobals();
});
