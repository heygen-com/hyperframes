import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";

function media(video: HTMLVideoElement, loaded: boolean) {
  let ready = loaded ? 4 : 0;
  let network = 1;
  let fetching = false;
  let seeking = false;
  let time = 0;
  let releases = 0;
  const select = () => {
    ready = 0;
    seeking = false;
    fetching = video.hasAttribute("src") && video.preload !== "none";
    network = !video.hasAttribute("src") ? 0 : fetching ? 2 : 1;
  };
  const setAttribute = video.setAttribute.bind(video);
  const removeAttribute = video.removeAttribute.bind(video);
  video.setAttribute = (name: string, value: string) => {
    setAttribute(name, value);
    if (name === "src") select();
  };
  video.removeAttribute = (name: string) => {
    if (name === "src") releases++;
    removeAttribute(name);
  };
  const preload = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "preload")!;
  Object.defineProperties(video, {
    preload: {
      get: () => preload.get!.call(video),
      set: (value: string) => {
        preload.set!.call(video, value);
        if (value === "none" || ready > 0 || network !== 1) return;
        fetching = true;
        network = 2;
      },
      configurable: true,
    },
    readyState: { get: () => ready, configurable: true },
    networkState: { get: () => network, configurable: true },
    videoWidth: { get: () => (ready > 0 ? 64 : 0), configurable: true },
    videoHeight: { get: () => (ready > 0 ? 36 : 0), configurable: true },
    duration: { get: () => (ready > 0 ? 5 : Number.NaN), configurable: true },
    paused: { value: true, configurable: true },
    seeking: { get: () => seeking, configurable: true },
    currentTime: {
      get: () => time,
      set: (next: number) => {
        time = next;
        if (ready === 0) return;
        seeking = true;
        ready = 1;
      },
      configurable: true,
    },
  });
  video.load = vi.fn(select);
  video.pause = vi.fn();
  video.play = vi.fn(() => Promise.resolve());
  return {
    video,
    releases: () => releases,
    finishLoad: () => {
      if (!fetching) return;
      fetching = false;
      ready = 1;
      video.dispatchEvent(new Event("loadedmetadata"));
    },
    land: () => {
      if (ready === 0) return;
      ready = 4;
      seeking = false;
      video.dispatchEvent(new Event("seeked"));
    },
  };
}

function film(starts: number[]) {
  resetRuntimeFixtureDom();
  const meta = document.createElement("meta");
  meta.name = STUDIO_PREVIEW_MARK_META;
  document.head.append(meta);
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="70">' +
    starts
      .flatMap((start) =>
        ["plate", "matte"].map(
          (name) =>
            `<video id="${name}-${start}" style="width:64px;height:36px" data-start="${start}" data-duration="5" src="/${name}-${start}.mp4" muted></video>`,
        ),
      )
      .join("") +
    "</div>";
  const clips = [...document.querySelectorAll("video")].map((video) =>
    media(video, video.dataset.start === "0"),
  );
  const main = createMockTimeline(70);
  window.__timelines = { main };
  initSandboxRuntimeModular();
  const at = (start: number) => clips.filter(({ video }) => video.dataset.start === String(start));
  for (const clip of at(0)) clip.land();
  return { main, at };
}

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  document.querySelector(`meta[name="${STUDIO_PREVIEW_MARK_META}"]`)?.remove();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});

it("lets go for good of far clips a superseded seek started loading", async () => {
  const { main, at } = film([0, 60]);
  window.__player!.seek(61);
  expect(at(60).map(({ video }) => video.networkState)).toEqual([2, 2]);
  const landed = window.__player!.seek(0);
  for (const clip of at(0)) clip.finishLoad();
  for (const clip of at(0)) clip.land();
  await landed;
  expect(main.time?.()).toBe(0);
  for (let i = 0; i < 5; i++) for (const clip of at(60)) clip.finishLoad();
  expect(at(60).map(({ video }) => [video.preload, video.readyState])).toEqual([
    ["none", 0],
    ["none", 0],
  ]);
  expect(at(60).map((clip) => clip.releases())).toEqual([1, 1]);
});

it("loads a seek's far clips once, without releasing them before it lands", async () => {
  const { main, at } = film([0, 60]);
  const landed = window.__player!.seek(61);
  for (const clip of at(60)) clip.finishLoad();
  expect(at(60).map((clip) => clip.releases())).toEqual([0, 0]);
  for (const clip of at(60)) clip.land();
  await landed;
  expect(main.time?.()).toBe(61);
  expect(at(60).map(({ video }) => video.readyState)).toEqual([4, 4]);
});

it("gives back the far clips a seek no longer needs as soon as it moves on", async () => {
  const { main, at } = film([0, 30, 60]);
  window.__player!.seek(31);
  for (const clip of at(30)) clip.finishLoad();
  const landed = window.__player!.seek(61);
  expect(at(30).map(({ video }) => [video.preload, video.readyState])).toEqual([
    ["none", 0],
    ["none", 0],
  ]);
  expect(at(60).map(({ video }) => video.networkState)).toEqual([2, 2]);
  for (const clip of at(60)) clip.finishLoad();
  for (const clip of at(60)) clip.land();
  await landed;
  expect(main.time?.()).toBe(61);
  expect(at(30).map((clip) => clip.releases())).toEqual([1, 1]);
});

it("lets go of the clips it leaves before loading a far destination", async () => {
  const { main, at } = film([0, 60]);
  const landed = window.__player!.seek(61);
  expect(at(0).map(({ video }) => [video.preload, video.readyState])).toEqual([
    ["none", 0],
    ["none", 0],
  ]);
  expect(at(60).map(({ video }) => video.networkState)).toEqual([2, 2]);
  for (const clip of at(60)) clip.finishLoad();
  for (const clip of at(60)) clip.land();
  await landed;
  expect(main.time?.()).toBe(61);
});

it("keeps the clips it leaves when the destination is close by", () => {
  const { at } = film([0, 5]);
  window.__player!.seek(6);
  expect(at(0).map(({ video }) => [video.preload, video.readyState])).toEqual([
    ["auto", 4],
    ["auto", 4],
  ]);
  expect(at(0).map((clip) => clip.releases())).toEqual([0, 0]);
});

it("starts no clip near the place it leaves while it loads a far destination", async () => {
  const { at } = film([0, 1, 1.5, 60]);
  const upcoming = [...at(1), ...at(1.5)];
  expect(upcoming.map(({ video }) => video.networkState)).toEqual([2, 2, 2, 1]);
  window.__player!.seek(61);
  await Promise.resolve();
  expect(upcoming.map(({ video }) => [video.preload, video.networkState])).toEqual([
    ["none", 1],
    ["none", 1],
    ["none", 1],
    ["none", 1],
  ]);
});

it("keeps a far clip released after a composition script raises its preload", () => {
  const { at } = film([0, 60]);
  const [clip] = at(60);
  clip!.video.preload = "auto";
  for (let i = 0; i < 5; i++) clip!.finishLoad();
  expect([clip!.video.preload, clip!.video.readyState, clip!.releases()]).toEqual(["none", 0, 1]);
});
