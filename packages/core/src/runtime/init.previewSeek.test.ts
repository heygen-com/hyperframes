import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { hideTimedClipsUntilFirstPass } from "./timedClipHide";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import { PREVIEW_SEEK_HOLD_ATTR, STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import type {
  PausedVideoFrame,
  PausedVideoFrameProvider,
  PausedVideoFrameRequest,
} from "./pausedVideoFrames";

function decoder(video: HTMLVideoElement, initiallyReady: boolean) {
  let time = 0;
  let ready = initiallyReady ? 4 : 0;
  let seeking = false;
  const seeks: number[] = [];
  Object.defineProperties(video, {
    duration: { value: 10, configurable: true },
    videoWidth: { value: 64, configurable: true },
    videoHeight: { value: 36, configurable: true },
    readyState: { get: () => ready, configurable: true },
    networkState: { value: 2, configurable: true },
    paused: { value: true, configurable: true },
    seeking: { get: () => seeking, configurable: true },
    currentTime: {
      get: () => time,
      set: (next: number) => {
        time = next;
        seeks.push(next);
        seeking = true;
        ready = 1;
      },
      configurable: true,
    },
  });
  video.pause = vi.fn();
  video.play = vi.fn(() => Promise.resolve());
  video.load = vi.fn();
  return {
    video,
    seeks,
    land: () => {
      ready = 4;
      seeking = false;
      video.dispatchEvent(new Event("seeked"));
    },
    reload: () => {
      time = 0;
      ready = 1;
      seeking = false;
      video.dispatchEvent(new Event("loadedmetadata"));
    },
  };
}

function film(withImage = false) {
  resetRuntimeFixtureDom();
  const meta = document.createElement("meta");
  meta.name = STUDIO_PREVIEW_MARK_META;
  document.head.append(meta);
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    [0, 5]
      .flatMap((start) =>
        ["plate", "matte"].map(
          (name) =>
            `<video id="${name}-${start}" style="width:64px;height:36px" data-start="${start}" data-duration="5" src="/${name}.mp4" muted></video>`,
        ),
      )
      .join("") +
    (withImage
      ? '<div data-start="8" data-duration="2"><img id="later-image" src="/later.png"></div>'
      : "") +
    "</div>";
  const videos = [...document.querySelectorAll("video")].map((v) =>
    decoder(v, v.dataset.start === "0"),
  );
  const main = createMockTimeline(10);
  window.__timelines = { main };
  if (withImage) hideTimedClipsUntilFirstPass();
  initSandboxRuntimeModular();
  for (const video of videos.slice(0, 2)) video.land();
  return { main, old: videos.slice(0, 2), next: videos.slice(2), drawImage };
}

function frameProvider(videos: ReturnType<typeof decoder>[]) {
  const clocks = new Map(
    videos.map(({ video }) => [video, Object.getOwnPropertyDescriptor(video, "currentTime")!]),
  );
  for (const { video } of videos) Reflect.deleteProperty(video, "currentTime");
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(
    function (this: HTMLMediaElement) {
      return clocks.get(this as HTMLVideoElement)?.get?.();
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(function (
    this: HTMLMediaElement,
    time: number,
  ) {
    clocks.get(this as HTMLVideoElement)?.set?.(time);
  });
  const pending: Array<() => void> = [];
  const provider: PausedVideoFrameProvider = {
    decode: vi.fn(
      (requests: PausedVideoFrameRequest[]) =>
        new Promise<PausedVideoFrame[]>((resolve) => {
          pending.push(() =>
            resolve(
              requests.map(({ time }) => ({
                source: document.createElement("canvas"),
                timestamp: time,
                duration: 1 / 30,
                width: 64,
                height: 36,
                release: vi.fn(),
              })),
            ),
          );
        }),
    ),
    dispose: vi.fn(),
  };
  window.__hf!.setPausedVideoFrameProvider!(provider);
  return { provider, pending };
}

it("keeps the old picture and page until both destination videos have decoded", async () => {
  const { main, old, next, drawImage } = film();
  const landed = window.__player!.seek(5.5);
  expect(window.__player!.getTime()).toBe(5.5);
  expect(main.time?.()).toBe(0);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(true);
  expect(drawImage).toHaveBeenCalledTimes(2);
  expect(document.querySelectorAll("canvas")).toHaveLength(2);
  expect(old.every(({ video }) => getComputedStyle(video).display === "none")).toBe(true);
  next[0]!.land();
  expect(main.time?.()).toBe(0);
  next[1]!.land();
  await landed;
  expect(main.time?.()).toBe(5.5);
  expect(document.querySelectorAll("canvas")).toHaveLength(0);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
  expect(old.every(({ video }) => video.style.visibility === "hidden")).toBe(true);
  expect(next.every(({ video }) => video.style.visibility === "visible")).toBe(true);
});

it("coalesces same-clip requests and publishes complete intermediate pictures", async () => {
  const { main, next } = film();
  const landed = window.__player!.seek(5.5);
  const initialSeeks = next.map((v) => v.seeks.length);
  window.__player!.seek(6);
  window.__player!.seek(7.5);
  expect(next.map((v) => v.seeks.length)).toEqual(initialSeeks);
  for (const video of next) video.land();
  expect(main.time?.()).toBe(5.5);
  expect(window.__player!.getTime()).toBe(7.5);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(true);
  expect(next.every((v) => Math.abs(v.video.currentTime - 2.5) < 0.001)).toBe(true);
  for (const video of next) video.land();
  await landed;
  expect(main.time?.()).toBe(7.5);
});

it("supersedes a stuck run immediately when the destination uses different clips", async () => {
  const { main, old } = film();
  const landed = window.__player!.seek(6);
  window.__player!.seek(1);
  expect(old.every(({ video }) => Math.abs(video.currentTime - 1) < 0.001)).toBe(true);
  for (const video of old) video.land();
  await landed;
  expect(main.time?.()).toBe(1);
  expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
});

it("settles a failed source without waiting for the decoder cap", async () => {
  const { main, next } = film();
  const landed = window.__player!.seek(6);
  for (const { video } of next) {
    Object.defineProperties(video, {
      error: { value: null, configurable: true },
      networkState: { value: 3, configurable: true },
    });
    const source = document.createElement("source");
    video.append(source);
    source.dispatchEvent(new Event("error"));
  }
  await landed;
  expect(main.time?.()).toBe(6);
  expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
});

it("keeps a pending video's complete-picture hold while waiting for a later image", async () => {
  const { main, old, next } = film(true);
  const image = document.querySelector<HTMLImageElement>("#later-image")!;
  let decodeImage = () => {};
  const decode = vi.fn(() => new Promise<void>((resolve) => (decodeImage = resolve)));
  image.decode = decode;
  window.__player!.seek(6);
  const landed = window.__player!.seek(8.5);
  expect(decode).toHaveBeenCalledOnce();
  expect(window.__player!.getTime()).toBe(8.5);
  expect(main.time?.()).toBe(0);
  expect(old.every(({ video }) => getComputedStyle(video).display === "none")).toBe(true);
  expect(document.querySelectorAll("canvas")).toHaveLength(2);
  Object.defineProperty(image, "complete", { value: true, configurable: true });
  decodeImage();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const video of next) video.land();
  for (const video of next) video.land();
  await landed;
  expect(main.time?.()).toBe(8.5);
});

it("holds overlapping same-clip seeks too, and repositions a reloaded source at the requested time", async () => {
  const { main, old } = film();
  const landed = window.__player!.seek(2);
  old[0]!.reload();
  expect(old[0]!.video.currentTime).toBeCloseTo(2, 3);
  old[0]!.land();
  expect(main.time?.()).toBe(0);
  old[1]!.land();
  await landed;
  expect(main.time?.()).toBe(2);
});

it("holds a paused keepPlaying seek and normal seeks after a non-export renderSeek", async () => {
  const { main, old, next } = film();
  window.__player!.renderSeek(0.2);
  for (const video of old) video.land();
  const landed = window.__player!.seek(6, { keepPlaying: true });
  expect(main.time?.()).toBe(0.2);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(true);
  for (const video of next) video.land();
  await landed;
  expect(main.time?.()).toBe(6);
});

it("does not pause, seek or cover a video leased by another preview control", async () => {
  const { old, next } = film();
  const leased = old[0]!;
  window.__hf!.leasePausedMedia!(leased.video);
  Object.defineProperty(leased.video, "paused", { value: false, configurable: true });
  const seeks = leased.seeks.length;
  const landed = window.__player!.seek(6);
  expect(leased.video.pause).not.toHaveBeenCalled();
  expect(leased.seeks).toHaveLength(seeks);
  expect(leased.video.hasAttribute("data-hf-seek-video")).toBe(false);
  for (const video of next) video.land();
  await landed;
  expect(leased.video.pause).not.toHaveBeenCalled();
});

it("leaves host-controlled native media to the host", () => {
  const { old } = film();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        source: "hf-parent",
        type: "control",
        action: "set-native-media-sync-disabled",
        disabled: true,
      },
    }),
  );
  Object.defineProperty(old[0]!.video, "paused", { value: false, configurable: true });
  const seeks = old[0]!.seeks.length;
  window.__player!.seek(2);
  expect(old[0]!.seeks).toHaveLength(seeks);
  expect(old[0]!.video.pause).not.toHaveBeenCalled();
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
});

it("leaves a grading canvas's hidden source in its layout during the hold", async () => {
  const { old, next, drawImage } = film();
  old[0]!.video.setAttribute("data-hf-color-grading-source-hidden", "true");
  old[0]!.video.style.setProperty("opacity", "0", "important");
  const landed = window.__player!.seek(6);
  expect(old[0]!.video.hasAttribute("data-hf-seek-video")).toBe(false);
  expect(drawImage).toHaveBeenCalledTimes(1);
  for (const video of next) video.land();
  await landed;
});

it.each(["play", "render", "teardown"])(
  "cleans up a pending seek on %s and ignores late completions",
  async (action) => {
    const { main, next } = film();
    const player = window.__player!;
    const landed = player.seek(6);
    if (action === "play") player.play();
    else if (action === "render") player.renderSeek(2);
    else window.__hfRuntimeTeardown?.();
    const time = main.time?.();
    for (const video of next) video.land();
    await landed;
    expect(main.time?.()).toBe(time);
    expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
    expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
    if (action === "play") expect(player.getTime()).toBeGreaterThanOrEqual(6);
    if (action === "render") expect(time).toBe(2);
  },
);

it("caps a stalled decoder without leaving the picture hidden", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { main } = film();
  const landed = window.__player!.seek(6);
  await vi.advanceTimersByTimeAsync(5000);
  await landed;
  expect(main.time?.()).toBe(6);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
  expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
});

it("exposes the presented clock to animation callbacks while retaining the latest scrub destination", async () => {
  const { main, next } = film();
  const times: number[] = [];
  const original = main.totalTime!;
  main.totalTime = (time?: number) => {
    if (time !== undefined) times.push(window.__player!.getTime());
    return original(time);
  };
  const done = window.__player!.seek(5.5);
  window.__player!.seek(7.5);
  for (const video of next) video.land();
  expect(times).toContain(5.5);
  expect(window.__player!.getTime()).toBe(7.5);
  for (const video of next) video.land();
  await done;
});

it.each(["stop-media", "set-native-media-sync-disabled"])(
  "does not resume a pending playback handoff after %s",
  async (action) => {
    const { old, next } = film();
    const { pending } = frameProvider([...old, ...next]);
    const landed = window.__player!.seek(1);
    pending.shift()!();
    await landed;
    window.__player!.play();
    expect(window.__player!.isPlaying()).toBe(false);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { source: "hf-parent", type: "control", action, disabled: true },
      }),
    );
    await Promise.resolve();
    for (const video of old) video.land();
    await Promise.resolve();
    expect(window.__player!.isPlaying()).toBe(false);
  },
);

it("retains an in-flight destination when the host replaces its frame provider", async () => {
  const { main, old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const first = window.__player!.seek(6);
  const replacement = { decode: provider.decode, dispose: vi.fn() };
  window.__hf!.setPausedVideoFrameProvider!(replacement);
  expect(provider.dispose).toHaveBeenCalledTimes(1);
  expect(window.__player!.getTime()).toBe(6);
  pending.shift()!();
  pending.shift()!();
  await first;
  await Promise.resolve();
  expect(main.time?.()).toBe(6);
});

it("loads original source metadata before publishing provider frames used by intrinsic-size effects", async () => {
  const { main, old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  for (const { video } of next)
    Object.defineProperty(video, "videoWidth", { value: 0, configurable: true });
  const landed = window.__player!.seek(6);
  pending.shift()!();
  await Promise.resolve();
  expect(main.time?.()).toBe(0);
  for (const { video } of next) {
    Object.defineProperty(video, "videoWidth", { value: 64, configurable: true });
    video.dispatchEvent(new Event("loadedmetadata"));
  }
  await landed;
  expect(main.time?.()).toBe(6);
});

it("refines the paused frame once after input settles, then warms native playback", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const landed = window.__player!.seek(1);
  pending.shift()!();
  await landed;
  await vi.advanceTimersByTimeAsync(120);
  expect(provider.decode).toHaveBeenCalledTimes(2);
  expect(vi.mocked(provider.decode).mock.calls[1]![0].every((request) => request.settled)).toBe(
    true,
  );
  pending.shift()!();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(120);
  expect(old.every(({ video }) => !Object.hasOwn(video, "currentTime"))).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(provider.decode).toHaveBeenCalledTimes(2);
  expect(window.__player!.isPlaying()).toBe(false);
});

it("decodes frame-step seeks at settled quality immediately without a second refinement", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const landed = window.__player!.seek(1, { settled: true });
  expect(vi.mocked(provider.decode).mock.calls[0]![0].every((request) => request.settled)).toBe(
    true,
  );
  pending.shift()!();
  await landed;
  await vi.advanceTimersByTimeAsync(1000);
  expect(provider.decode).toHaveBeenCalledTimes(1);
  expect(window.__player!.isPlaying()).toBe(false);
});

it("notifies video-driven effects on the committed clock before animation redraw", async () => {
  const proto = HTMLVideoElement.prototype;
  const request = Object.getOwnPropertyDescriptor(proto, "requestVideoFrameCallback");
  const cancel = Object.getOwnPropertyDescriptor(proto, "cancelVideoFrameCallback");
  Object.defineProperties(proto, {
    requestVideoFrameCallback: { value: vi.fn(() => 1), configurable: true, writable: true },
    cancelVideoFrameCallback: { value: vi.fn(), configurable: true, writable: true },
  });
  try {
    const { main, old, next } = film();
    const { pending } = frameProvider([...old, ...next]);
    const notifications: number[] = [];
    old[0]!.video.requestVideoFrameCallback(() => notifications.push(window.__player!.getTime()));
    const original = main.totalTime!;
    main.totalTime = (time?: number) => {
      if (time === 1) expect(notifications).toEqual([1]);
      return original(time);
    };
    const landed = window.__player!.seek(1);
    pending.shift()!();
    await landed;
    expect(notifications).toEqual([1]);
  } finally {
    if (request) Object.defineProperty(proto, "requestVideoFrameCallback", request);
    else Reflect.deleteProperty(proto, "requestVideoFrameCallback");
    if (cancel) Object.defineProperty(proto, "cancelVideoFrameCallback", cancel);
    else Reflect.deleteProperty(proto, "cancelVideoFrameCallback");
  }
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  document.querySelector(`meta[name="${STUDIO_PREVIEW_MARK_META}"]`)?.remove();
  for (const style of document.querySelectorAll(
    "style[data-hf-skip-hidden-images], style[data-hf-hidden-clip-contents]",
  ))
    style.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetRuntimeFixtureDom();
});
