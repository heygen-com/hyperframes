import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { heldPosters } from "./proxySrc";
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

function playPodcast(voiceStart = 0, voiceTag = "audio", musicReadyState = 4) {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    '<audio id="music" data-start="0" data-duration="10" src="/music.m4a"></audio>' +
    `<${voiceTag} id="voice" data-start="${voiceStart}" data-duration="4" src="/voice.m4a"></${voiceTag}>` +
    "</div>";
  const voiceReady: { value: number; bufferedTo?: number } = { value: 1 };
  const music = audio("music", 10, { value: musicReadyState });
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

it("a track not ready at the start holds the playhead for 0.3 s at most, then plays on", () => {
  const { music, voice, voiceReady, states, playFor } = playPodcast();

  playFor(0.25);
  expect(window.__player!.getTime()).toBeLessThan(0.05);
  expect(music.paused).toBe(true);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  playFor(1.25);
  expect(window.__player!.getTime()).toBeGreaterThan(0.9);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });

  voiceReady.value = 4;
  playFor(0.5);
  expect(voice.paused).toBe(false);
  expect(music.paused).toBe(false);
});

it("the track the playhead follows, cold at the start, holds it for 0.3 s at most too", () => {
  const { states, playFor } = playPodcast(0, "audio", 1);

  playFor(0.25);
  expect(window.__player!.getTime()).toBeLessThan(0.05);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  playFor(1.25);
  expect(window.__player!.getTime()).toBeGreaterThan(0.9);
});

it("a track not ready mid-film still pauses everything with Buffering, and resumes when it can play", () => {
  const { music, voiceReady, states, playFor } = playPodcast(2);

  playFor(2.5);
  expect(window.__player!.getTime()).toBeGreaterThan(1.9);
  expect(window.__player!.getTime()).toBeLessThan(2.1);
  expect(music.paused).toBe(true);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  voiceReady.value = 4;
  playFor(1);
  expect(window.__player!.getTime()).toBeGreaterThan(2.9);
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

it("a copy that never lands stops standing in, and the film waits for it through the start wait", () => {
  const { music, voice, states, playFor } = playPodcast(0, "video");
  heldPosters.set(voice, { poster: null, since: performance.now() - 60_000 });

  playFor(0.25);
  expect(window.__player!.getTime()).toBeLessThan(0.05);
  expect(music.paused).toBe(true);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });
});

it("after a start that ran on without data, the next clip without data holds again once the first one has it", () => {
  const { voiceReady, states, playFor } = playPodcast();

  playFor(1);
  voiceReady.value = 4;
  playFor(0.2);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
  voiceReady.value = 1;
  playFor(0.2);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });
});

it("a clip due while another catches up from the start still holds, then plays with the first one still cold", () => {
  const { voiceReady, states, playFor } = playPodcast(0.5, "audio", 1);

  playFor(0.45);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
  playFor(0.45);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });
  const heldAt = window.__player!.getTime();
  playFor(0.3);
  expect(window.__player!.getTime()).toBe(heldAt);

  voiceReady.value = 4;
  playFor(0.3);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
  expect(window.__player!.getTime()).toBeGreaterThan(heldAt);
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
  const { voiceReady, states, playFor } = playPodcast(0.5);

  playFor(0.6);
  voiceReady.value = 2;
  playFor(0.5);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: true });

  voiceReady.bufferedTo = 2;
  playFor(1);
  expect(window.__player!.getTime()).toBeGreaterThan(1.1);
  expect(states.at(-1)).toEqual({ isPlaying: true, buffering: false });
});

it("a pause while buffering stays paused once the track is ready", () => {
  const { music, voiceReady, states, playFor } = playPodcast();

  playFor(0.2);
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
