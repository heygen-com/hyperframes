import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { heldPosters } from "./proxySrc";
import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

function audio(id: string, duration: number, readyState: { value: number; bufferedTo?: number }) {
  const el = document.getElementById(id) as HTMLAudioElement;
  let paused = true;
  Object.defineProperties(el, {
    duration: { value: duration, configurable: true },
    readyState: { get: () => readyState.value, configurable: true },
    buffered: {
      get: () => ({ length: 1, start: () => 0, end: () => readyState.bufferedTo ?? 0 }),
      configurable: true,
    },
    paused: { get: () => paused, configurable: true },
  });
  el.play = vi.fn(() => {
    paused = false;
    return Promise.resolve();
  });
  el.pause = vi.fn(() => {
    if (!paused) el.dispatchEvent(new Event("pause"));
    paused = true;
  });
  el.load = vi.fn();
  return el;
}

function playPodcast(voiceStart = 0, voiceTag = "audio", extraHtml = "") {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    '<audio id="music" data-start="0" data-duration="10" src="/music.m4a"></audio>' +
    `<${voiceTag} id="voice" data-track-index="0" data-start="${voiceStart}" data-duration="4" src="/voice.m4a"></${voiceTag}>` +
    extraHtml +
    "</div>";
  const voiceReady: { value: number; bufferedTo?: number } = { value: 1 };
  const music = audio("music", 10, { value: 4 });
  const voice = audio("voice", 4, voiceReady);
  window.__timelines = { main: createMockTimeline(10) };

  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  window.requestAnimationFrame = (cb) => (frames.set(++nextFrame, cb), nextFrame);
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  const states: Array<{ isPlaying: boolean; buffering: boolean }> = [];
  vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
    const m = message as { type?: string; isPlaying: boolean; buffering: boolean };
    if (m?.type === "state") states.push({ isPlaying: m.isPlaying, buffering: m.buffering });
  });

  initSandboxRuntimeModular();
  window.__player!.play();
  const step = (ms: number) => {
    now += ms;
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) cb(now);
  };
  const playFor = (seconds: number) => {
    for (let ms = 0; ms < seconds * 1000; ms += 1000 / 60) step(1000 / 60);
  };
  return { music, voice, voiceReady, states, playFor, step };
}

it("a track not ready pauses everything with Buffering, and resumes when it can play", () => {
  const { music, voice, voiceReady, states, playFor } = playPodcast();

  playFor(1);
  expect(window.__player!.getTime()).toBeLessThan(0.1);
  expect(music.paused).toBe(true);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  voiceReady.value = 4;
  playFor(1);
  expect(window.__player!.getTime()).toBeGreaterThan(0.9);
  expect(music.paused).toBe(false);
  expect(voice.paused).toBe(false);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
});

it("the music plays on while a video shows a still across a copy swap", () => {
  const { music, voice, states, playFor } = playPodcast(0, "video");
  heldPosters.set(voice, { poster: null, since: performance.now() });

  playFor(1);
  expect(window.__player!.getTime()).toBeGreaterThan(0.9);
  expect(music.paused).toBe(false);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
});

it("a copy that never lands stops standing in, and the film waits for it", () => {
  const { music, voice, states, playFor } = playPodcast(0, "video");
  heldPosters.set(voice, { poster: null, since: performance.now() - 60_000 });

  playFor(1);
  expect(window.__player!.getTime()).toBeLessThan(0.1);
  expect(music.paused).toBe(true);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });
});

it("holds on the frame a slow tick skips into a clip with no data, after asking it to play", () => {
  const { voice, states, playFor, step } = playPodcast(0.5);

  playFor(0.4);
  expect(voice.play).not.toHaveBeenCalled();
  step(250);
  expect(voice.play).toHaveBeenCalled();
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });
});

it("resumes for a held clip with data buffered ahead that reports only its current frame, as WebKit's do", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
  );
  const { voiceReady, states, playFor } = playPodcast();

  playFor(0.5);
  voiceReady.value = 2;
  playFor(0.5);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  voiceReady.bufferedTo = 2;
  playFor(1);
  expect(window.__player!.getTime()).toBeGreaterThan(0.9);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
});

it("waits for real data ahead: a starved clip reporting a little future data does not resume", () => {
  const { voiceReady, states, playFor } = playPodcast();

  playFor(0.5);
  voiceReady.value = 3;
  voiceReady.bufferedTo = 0.2;
  playFor(0.5);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  voiceReady.bufferedTo = 2;
  playFor(0.5);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
});

it("a video a little behind the film is not sought when it starves or when it resumes", () => {
  const { voice, voiceReady, playFor } = playPodcast(0, "video");
  voiceReady.value = 4;
  playFor(1);
  const seeks = vi.fn();
  let position = window.__player!.getTime() - 0.07;
  Object.defineProperty(voice, "currentTime", {
    get: () => position,
    set: (to: number) => {
      seeks(to);
      position = to;
    },
    configurable: true,
  });

  voiceReady.value = 2;
  voiceReady.bufferedTo = position + 0.1;
  playFor(0.5);
  voiceReady.value = 4;
  playFor(0.1);

  expect(voice.paused).toBe(false);
  expect(seeks).not.toHaveBeenCalled();
});

it("the film waits for a playing video stuck waiting, even with the bytes buffered", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Chrome/140.0 AppleWebKit/537.36");
  const { voice, voiceReady, states, playFor } = playPodcast(0, "video");
  voiceReady.value = 4;
  playFor(0.5);
  expect(voice.paused).toBe(false);

  voiceReady.value = 2;
  voiceReady.bufferedTo = 5;
  playFor(0.1);

  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });
});

it("a hold for data does not reload a later clip", () => {
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const mark = document.createElement("meta");
  mark.name = STUDIO_PREVIEW_MARK_META;
  document.head.append(mark);
  const { voiceReady, playFor } = playPodcast(
    0,
    "video",
    '<video id="later" data-track-index="0" data-start="9" data-duration="1" src="/later.mp4"></video>',
  );
  const later = document.getElementById("later") as HTMLVideoElement;
  load.mockClear();
  voiceReady.value = 4;
  playFor(0.5);
  const armed = later.preload;
  const before = load.mock.contexts.filter((el) => el === later).length;

  voiceReady.value = 1;
  playFor(0.5);

  mark.remove();
  expect(armed).toBe("auto");
  expect(later.preload).toBe(armed);
  expect(load.mock.contexts.filter((el) => el === later).length).toBe(before);
});

it("a film held for data reads as choppy, so the app can lower it", () => {
  const reports: Array<{ choppy: boolean; waitingShare: number }> = [];
  const { voiceReady, playFor } = playPodcast(0, "video");
  voiceReady.value = 4;
  playFor(0.5);
  const post = vi.mocked(window.parent.postMessage);
  post.mockClear();
  voiceReady.value = 1;
  playFor(6);
  for (const [message] of post.mock.calls) {
    const m = message as {
      type?: string;
      health: { choppy: boolean; waitingShare: number } | null;
    };
    if (m?.type === "preview-health" && m.health) reports.push(m.health);
  }
  expect(reports.at(-1)?.choppy).toBe(true);
  expect(reports.at(-1)?.waitingShare).toBeGreaterThan(0.9);
});

it("a video far behind the film lands on it when it starves", () => {
  const { voice, voiceReady, playFor } = playPodcast(0, "video");
  voiceReady.value = 4;
  playFor(2);
  const seeks = vi.fn();
  let position = 0.5;
  Object.defineProperty(voice, "currentTime", {
    get: () => position,
    set: (to: number) => {
      seeks(to);
      position = to;
    },
    configurable: true,
  });

  voiceReady.value = 2;
  voiceReady.bufferedTo = 0.6;
  playFor(0.1);

  expect(seeks).toHaveBeenCalled();
  expect(position).toBeCloseTo(window.__player!.getTime(), 1);
});

it("a pause while buffering stays paused once the track is ready", () => {
  const { music, voiceReady, states, playFor } = playPodcast();

  playFor(0.5);
  window.__player!.pause();
  voiceReady.value = 4;
  playFor(1);
  expect(window.__player!.getTime()).toBeLessThan(0.1);
  expect(music.paused).toBe(true);
  expect(states.at(-1)).toEqual({ isPlaying: false, buffering: false });
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
