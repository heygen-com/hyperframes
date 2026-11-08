import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { hideTimedClipsUntilFirstPass } from "./timedClipHide";
import { resetSeekDispatchState } from "./adapters/seek-dispatch";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import {
  PREVIEW_SEEK_HOLD_ATTR,
  STUDIO_PREVIEW_MARK_META,
  PLAYER_FRAME_ATTR,
} from "../studioPreviewMark";
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
    metadataAt: (position: number) => {
      time = position;
      ready = 1;
      seeking = false;
    },
    presentAt: (position: number) => {
      time = position;
      ready = 4;
      seeking = false;
      video.dispatchEvent(new Event("timeupdate"));
    },
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

function film(withImage = false, studio = true) {
  resetRuntimeFixtureDom();
  const meta = document.createElement("meta");
  meta.name = STUDIO_PREVIEW_MARK_META;
  if (studio) document.head.append(meta);
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
  "finishes native handoff on Play and ignores retired completions on render or teardown (%s)",
  async (action) => {
    const { main, next } = film();
    const player = window.__player!;
    const landed = player.seek(6);
    const cases = {
      play: { run: () => player.play(), before: 0, after: 6 },
      render: { run: () => player.renderSeek(2), before: 2, after: 2 },
      teardown: { run: () => window.__hfRuntimeTeardown?.(), before: 0, after: 0 },
    };
    const expected = cases[action as keyof typeof cases];
    expected.run();
    expect(main.time!()).toBe(expected.before);
    for (const video of next) video.land();
    await landed;
    expect(main.time!()).toBe(expected.after);
    expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
    expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
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

it("keeps the complete picture and buffers beyond the handoff cap until native frames are ready", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { main, old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const landed = window.__player!.seek(1);
  pending.shift()!();
  await landed;
  for (const video of old) video.metadataAt(1);
  window.__player!.play();
  expect(old.every(({ video }) => video.preload === "auto")).toBe(true);
  await vi.advanceTimersByTimeAsync(5100);
  expect(window.__player!.isPlaying()).toBe(false);
  expect(main.time?.()).toBe(1);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
  window.__player!.seek(1);
  for (const video of old) video.land();
  await vi.advanceTimersByTimeAsync(0);
  expect(window.__player!.isPlaying()).toBe(true);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(0);
});

it("settles a stalled paused fallback while retaining the last complete picture", async () => {
  resetSeekDispatchState();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { main, old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(1);
  pending.shift()!();
  await initial;
  vi.mocked(provider.decode).mockRejectedValueOnce(new Error("decoder unavailable"));
  const stalled = window.__player!.seek(6);
  const retargeted = window.__player!.seek(7);
  const wait = window.__hfWaitForSeekCompletion!();
  await vi.advanceTimersByTimeAsync(5100);
  await stalled;
  await retargeted;
  await wait;
  expect(main.time?.()).toBe(1);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(true);
  const retry = window.__player!.seek(8);
  pending.shift()!();
  await retry;
  expect(main.time?.()).toBe(8);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
});

it.each([
  ["already metadata-only, idle", false, 1],
  ["ready, then metadata-only idle", true, 1],
  ["ready, then loading forever", true, 2],
  ["metadata-only, loading forever", false, 2],
] as const)(
  "bounds Play for %s while retaining its full-quality picture",
  async (_, initiallyReady, networkState) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { main, old, next } = film();
    const { pending } = frameProvider([...old, ...next]);
    const initial = window.__player!.seek(3);
    pending.shift()!();
    await initial;
    const stalled = old[0]!;
    if (initiallyReady) stalled.land();
    else stalled.metadataAt(3);
    Object.defineProperty(stalled.video, "networkState", {
      value: networkState,
      configurable: true,
    });
    window.__player!.play();
    old[1]!.land();
    await vi.advanceTimersByTimeAsync(5100);
    if (initiallyReady || networkState === 2) expect(window.__player!.isPlaying()).toBe(false);
    expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(
      window.__player!.isPlaying() ? 1 : 2,
    );
    stalled.video.dispatchEvent(new Event("progress"));
    await vi.advanceTimersByTimeAsync(4900);
    expect(window.__player!.isPlaying()).toBe(true);
    expect(main.time?.()).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(1);
    const held = document.querySelector("[data-hf-preview-video-canvas]")!;
    expect([held.getAttribute("width"), held.getAttribute("height")]).toEqual(["64", "36"]);
  },
);

it("keeps every unready video picture at the hard deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(3);
  pending.shift()!();
  await initial;
  const pictures = [...document.querySelectorAll("[data-hf-preview-video-canvas]")];
  window.__player!.play();
  await vi.advanceTimersByTimeAsync(10000);
  expect(window.__player!.isPlaying()).toBe(true);
  expect([...document.querySelectorAll("[data-hf-preview-video-canvas]")]).toEqual(pictures);
  window.__player!.pause();
  pending.shift()!();
  await Promise.resolve();
  await Promise.resolve();
  window.__player!.play();
  await Promise.resolve();
  await Promise.resolve();
  expect(window.__player!.isPlaying()).toBe(true);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
});

it("reveals a delayed playing frame without chasing the moving clock with more seeks", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(3);
  pending.shift()!();
  await initial;
  const stalled = old[0]!;
  stalled.metadataAt(3);
  let error: { code: number } | null = { code: 4 };
  Object.defineProperty(stalled.video, "error", { configurable: true, get: () => error });
  window.__player!.play();
  old[1]!.land();
  await vi.advanceTimersByTimeAsync(0);
  error = null;
  const seeks = stalled.seeks.length;
  Object.defineProperty(stalled.video, "paused", { configurable: true, value: false });
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(50);
    stalled.land();
    if (i === 0) stalled.video.dispatchEvent(new Event("playing"));
    stalled.presentAt(3 + (i + 1) / 30);
  }
  expect(stalled.seeks).toHaveLength(seeks);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(0);
  expect(window.__player!.isPlaying()).toBe(true);
});

it.each([1500, 2500].flatMap((lateMs) => [25, 40, 100, 600].map((seekMs) => ({ lateMs, seekMs }))))(
  "aligns a recovered picture once after $lateMs ms with $seekMs ms seek latency",
  async ({ lateMs, seekMs }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { old, next } = film();
    const { pending } = frameProvider([...old, ...next]);
    const initial = window.__player!.seek(1);
    pending.shift()!();
    await initial;
    const stalled = old[0]!;
    stalled.metadataAt(1);
    let error: { code: number } | null = { code: 4 };
    Object.defineProperty(stalled.video, "error", { configurable: true, get: () => error });
    window.__player!.play();
    old[1]!.land();
    await vi.advanceTimersByTimeAsync(0);
    error = null;
    const seeks = stalled.seeks.length;
    for (let elapsed = 0; elapsed < lateMs; elapsed += 25) {
      await vi.advanceTimersByTimeAsync(25);
      window.__player!.getTime();
    }
    expect(window.__player!.getTime()).toBeCloseTo(1 + lateMs / 1000, 2);
    Object.defineProperty(stalled.video, "paused", { configurable: true, value: false });
    stalled.land();
    stalled.video.dispatchEvent(new Event("playing"));
    stalled.presentAt(1 + 1 / 30);
    expect(stalled.seeks).toHaveLength(seeks + 1);
    const target = window.__player!.getTime();
    expect(stalled.seeks.at(-1)).toBeCloseTo(target, 2);
    expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(1);
    for (let elapsed = 0; elapsed < seekMs; elapsed += 25) {
      await vi.advanceTimersByTimeAsync(Math.min(25, seekMs - elapsed));
      window.__player!.getTime();
    }
    expect(window.__player!.getTime() - target).toBeCloseTo(seekMs / 1000, 2);
    stalled.land();
    stalled.presentAt(target + 1 / 30);
    expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(0);
    expect(stalled.seeks).toHaveLength(seeks + 1);
    expect(Math.abs(stalled.video.currentTime - window.__player!.getTime())).toBeLessThan(
      Math.max(0.1, seekMs / 1000),
    );
    expect(window.__player!.isPlaying()).toBe(true);
  },
);

it("keeps a paused recovery covered until its static target seek lands", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(3);
  pending.shift()!();
  await initial;
  const stalled = old[0]!;
  stalled.metadataAt(3);
  let error: { code: number } | null = { code: 4 };
  Object.defineProperty(stalled.video, "error", { configurable: true, get: () => error });
  window.__player!.play();
  old[1]!.land();
  await vi.advanceTimersByTimeAsync(500);
  expect(window.__player!.isPlaying()).toBe(true);
  window.__hf!.setPausedVideoFrameProvider!(null);
  window.__player!.pause();
  const picture = document.querySelector("[data-hf-preview-video-canvas]");
  expect(picture).not.toBeNull();
  error = null;
  stalled.metadataAt(3);
  stalled.land();
  expect(stalled.video.previousElementSibling).toBe(picture);
  expect(stalled.video.currentTime).toBeCloseTo(3.5, 2);
  stalled.land();
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(0);
});

it("publishes a late native recovery after a paused fallback wait has settled", async () => {
  resetSeekDispatchState();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { main, old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(1);
  pending.shift()!();
  await initial;
  vi.mocked(provider.decode).mockRejectedValueOnce(new Error("decoder unavailable"));
  const stalled = window.__player!.seek(6);
  await vi.advanceTimersByTimeAsync(5100);
  await stalled;
  expect(main.time?.()).toBe(1);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(true);
  expect(window.__player!.getTime()).toBe(1);
  const priorSeeks = old[0]!.seeks.length;
  const destinationSeeks = next.map((video) => video.seeks.length);
  old[0]!.reload();
  expect(old[0]!.seeks.length).toBeGreaterThan(priorSeeks);
  expect(next.map((video) => video.seeks.length)).toEqual(destinationSeeks);
  for (const video of next) video.land();
  await Promise.resolve();
  expect(main.time?.()).toBe(6);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(false);
  expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
});

it("keeps a hold-only snapshot visible while Play awaits decoder suspension", async () => {
  const { next, old } = film();
  const { provider } = frameProvider([...old, ...next]);
  let suspended = () => {};
  provider.suspend = () =>
    new Promise<void>((resolve) => {
      suspended = resolve;
    });
  const seek = window.__player!.seek(6);
  const pictures = [...document.querySelectorAll("canvas")];
  expect(pictures).toHaveLength(2);
  window.__player!.play();
  await seek;
  expect([...document.querySelectorAll("canvas")]).toEqual(pictures);
  suspended();
  await Promise.resolve();
  for (const video of next) video.land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(window.__player!.isPlaying()).toBe(true);
  expect(document.querySelectorAll("canvas, [data-hf-seek-video]")).toHaveLength(0);
});

it("resumes a pending Play after its frame provider is replaced", async () => {
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(1);
  pending.shift()!();
  await initial;
  window.__player!.play();
  window.__hf!.setPausedVideoFrameProvider!({ decode: provider.decode, dispose: vi.fn() });
  pending.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const video of old) video.land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(window.__player!.isPlaying()).toBe(true);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(0);
});

it("cancels the hard Play deadline when Pause restores provider ownership", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(3);
  pending.shift()!();
  await initial;
  window.__player!.play();
  await vi.advanceTimersByTimeAsync(9000);
  window.__player!.pause();
  pending.shift()!();
  await vi.advanceTimersByTimeAsync(20000);
  expect(window.__player!.isPlaying()).toBe(false);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
});

it("bounds a deferred decoder release and ignores its late completion", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  let released = () => {};
  provider.suspend = () =>
    new Promise<void>((resolve) => {
      released = resolve;
    });
  const initial = window.__player!.seek(3);
  pending.shift()!();
  await initial;
  window.__player!.play();
  await vi.advanceTimersByTimeAsync(10000);
  expect(window.__player!.isPlaying()).toBe(true);
  const pictures = [...document.querySelectorAll("[data-hf-preview-video-canvas]")];
  expect(pictures).toHaveLength(2);
  released();
  await Promise.resolve();
  await Promise.resolve();
  expect(window.__player!.isPlaying()).toBe(true);
  expect([...document.querySelectorAll("[data-hf-preview-video-canvas]")]).toEqual(pictures);
});

it("ignores decoder release after Pause cancels a pending Play", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  let released = () => {};
  provider.suspend = () =>
    new Promise<void>((resolve) => {
      released = resolve;
    });
  const initial = window.__player!.seek(3);
  pending.shift()!();
  await initial;
  window.__player!.play();
  await vi.advanceTimersByTimeAsync(9000);
  window.__player!.pause();
  pending.shift()!();
  await Promise.resolve();
  await Promise.resolve();
  const pictures = [...document.querySelectorAll("[data-hf-preview-video-canvas]")];
  const seeks = old.map((video) => video.seeks.length);
  released();
  await Promise.resolve();
  await Promise.resolve();
  expect(old.map((video) => video.seeks.length)).toEqual(seeks);
  await vi.advanceTimersByTimeAsync(1000);
  expect(window.__player!.isPlaying()).toBe(false);
  expect([...document.querySelectorAll("[data-hf-preview-video-canvas]")]).toEqual(pictures);
});

it("does not wait for a video frame from an audio-only video element", async () => {
  const { main, next } = film();
  for (const { video } of next)
    Object.defineProperties(video, {
      readyState: { value: 1, configurable: true },
      videoWidth: { value: 0, configurable: true },
      error: { value: null, configurable: true },
    });
  expect(window.__player!.seek(6)).toBeUndefined();
  expect(main.time?.()).toBe(6);
  window.__player!.play();
  expect(window.__player!.isPlaying()).toBe(true);
});

it("waits for paused decoder suspension before preparing native playback", async () => {
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  let releaseDecoders = () => {};
  provider.suspend = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releaseDecoders = resolve;
      }),
  );
  const initial = window.__player!.seek(1);
  pending.shift()!();
  await initial;
  const seeks = old.map((v) => v.seeks.length);
  window.__player!.play();
  expect(provider.suspend).toHaveBeenCalledOnce();
  expect(old.map((v) => v.seeks.length)).toEqual(seeks);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
  releaseDecoders();
  await Promise.resolve();
  for (const video of old) video.land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(window.__player!.isPlaying()).toBe(true);
});

it("restores paused ownership when Pause cancels an unfinished decoder suspension", async () => {
  const { old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  let releaseDecoders = () => {};
  provider.suspend = () =>
    new Promise<void>((resolve) => {
      releaseDecoders = resolve;
    });
  const initial = window.__player!.seek(1);
  pending.shift()!();
  await initial;
  window.__player!.play();
  window.__player!.pause();
  expect(pending).toHaveLength(1);
  pending.shift()!();
  releaseDecoders();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(window.__player!.isPlaying()).toBe(false);
  expect(
    old.every(({ video }) => Object.hasOwn(video, "currentTime") && video.currentTime === 1),
  ).toBe(true);
});

it("warms the restart destination before Play when paused at the end", async () => {
  const { main, old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const landed = window.__player!.seek(10, { settled: true });
  pending.shift()!();
  await landed;
  expect(main.time?.()).toBe(10);
  for (const video of old) video.metadataAt(0);
  const seeks = old.map((v) => v.seeks.length);
  window.__player!.play();
  expect(old.map((v) => v.seeks.length)).toEqual(seeks.map((n) => n + 1));
  expect(window.__player!.isPlaying()).toBe(false);
  for (const video of old) video.land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(window.__player!.isPlaying()).toBe(true);
  expect(window.__player!.getTime()).toBeLessThan(1);
  expect(old.every(({ video }) => video.style.visibility === "visible")).toBe(true);
});

it("retains a complete paused picture while replacing or removing its frame provider", async () => {
  const { main, old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const initial = window.__player!.seek(1);
  pending.shift()!();
  await initial;
  const replacement = { decode: provider.decode, dispose: vi.fn() };
  window.__hf!.setPausedVideoFrameProvider!(replacement);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
  pending.shift()!();
  await Promise.resolve();
  await Promise.resolve();
  expect(main.time?.()).toBe(1);
  window.__hf!.setPausedVideoFrameProvider!(null);
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(2);
  for (const video of old) video.land();
  await Promise.resolve();
  expect(document.querySelectorAll("[data-hf-preview-video-canvas]")).toHaveLength(0);
});

it("retains an in-flight destination when the host replaces its frame provider", async () => {
  const { main, old, next } = film();
  const { provider, pending } = frameProvider([...old, ...next]);
  const first = window.__player!.seek(6);
  const picture = document.querySelector("[data-hf-preview-video-canvas]");
  expect(picture).not.toBeNull();
  const replacement = { decode: provider.decode, dispose: vi.fn() };
  window.__hf!.setPausedVideoFrameProvider!(replacement);
  expect(document.querySelector("[data-hf-preview-video-canvas]")).toBe(picture);
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

it("releases a native hold when stop-media cancels its first provider seek", async () => {
  const { old, next } = film();
  const { pending } = frameProvider([...old, ...next]);
  const seek = window.__player!.seek(3);
  expect(document.querySelectorAll("canvas[data-hf-preview-video-canvas]")).toHaveLength(2);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: { source: "hf-parent", type: "control", action: "stop-media" },
    }),
  );
  await seek;
  expect(document.querySelectorAll("canvas[data-hf-preview-video-canvas]")).toHaveLength(0);
  pending.shift()!();
  await Promise.resolve();
  expect(document.querySelectorAll("canvas[data-hf-preview-video-canvas]")).toHaveLength(0);
});

it("keeps the native-only complete picture when Play interrupts an unresolved scrub", async () => {
  const { main, next } = film();
  const seek = window.__player!.seek(6);
  const pictures = [...document.querySelectorAll("canvas")];
  expect(pictures).toHaveLength(2);
  window.__player!.play();
  await seek;
  expect(main.time?.()).toBe(0);
  expect(pictures.every((picture) => picture.isConnected)).toBe(true);
  expect(document.documentElement.hasAttribute(PREVIEW_SEEK_HOLD_ATTR)).toBe(true);
  next[0]!.land();
  expect(main.time?.()).toBe(0);
  next[1]!.land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(main.time?.()).toBe(6);
  expect(window.__player!.isPlaying()).toBe(true);
  expect(window.__player!.getTime()).toBeGreaterThanOrEqual(6);
  expect(document.querySelectorAll("canvas")).toHaveLength(0);
});

function safariPlayerFilm() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  );
  const frame = document.createElement("iframe");
  frame.setAttribute(PLAYER_FRAME_ATTR, "");
  vi.spyOn(window, "frameElement", "get").mockReturnValue(frame);
  return film(false, false);
}

it("keeps pending-seek Play synchronous in an unmarked Safari player frame", () => {
  const { main, next } = safariPlayerFilm();
  void window.__player!.seek(6);
  expect(main.time?.()).toBe(0);
  window.__player!.play();
  expect(main.time?.()).toBe(6);
  expect(next.some(({ video }) => vi.mocked(video.play).mock.calls.length > 0)).toBe(true);
});

it("retains an explicit unmarked provider handoff before its first picture", async () => {
  const { main, old, next } = safariPlayerFilm();
  for (const video of old) video.metadataAt(0);
  const { pending } = frameProvider([...old, ...next]);
  const seeking = window.__player!.seek(6);
  window.__player!.play();
  expect(main.time?.()).toBe(0);
  expect(window.__player!.isPlaying()).toBe(false);
  for (const video of next) video.land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(window.__player!.isPlaying()).toBe(true);
  pending.shift()!();
  await seeking;
  expect(main.time?.()).toBe(6);
});
