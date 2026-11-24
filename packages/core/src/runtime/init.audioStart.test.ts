import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

let now = 0;

/** An element that reports playing at once but only moves `startLagMs` later, as real output does; a seek renews it. */
function lateStartingAudio(el: HTMLAudioElement, startLagMs: number) {
  let paused = true;
  let position = 0;
  let movesFromMs = 0;
  let rate = 1;
  const rates: number[] = [];
  const read = () =>
    paused || now < movesFromMs ? position : position + ((now - movesFromMs) / 1000) * rate;
  const rebase = () => {
    position = read();
    movesFromMs = Math.max(now, movesFromMs);
  };
  Object.defineProperties(el, {
    duration: { value: 10, configurable: true },
    readyState: { value: 4, configurable: true },
    seeking: { value: false, configurable: true },
    buffered: { value: { length: 1, start: () => 0, end: () => 10 }, configurable: true },
    paused: { get: () => paused, configurable: true },
    currentTime: {
      get: read,
      set: (t: number) => {
        position = t;
        movesFromMs = now + startLagMs;
      },
      configurable: true,
    },
    playbackRate: {
      get: () => rate,
      set: (r: number) => {
        rebase();
        rate = r;
        rates.push(r);
      },
      configurable: true,
    },
  });
  el.play = vi.fn(() => {
    if (paused) {
      paused = false;
      movesFromMs = now + startLagMs;
    }
    return Promise.resolve();
  });
  el.pause = vi.fn(() => {
    if (paused) return;
    position = read();
    paused = true;
    el.dispatchEvent(new Event("pause"));
  });
  el.load = vi.fn();
  return rates;
}

function playNarration(startLagMs: number) {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    '<audio id="voice" data-start="0" data-duration="10" src="/voice.m4a"></audio>' +
    "</div>";
  const voice = document.getElementById("voice") as HTMLAudioElement;
  const rates = lateStartingAudio(voice, startLagMs);
  window.__timelines = { main: createMockTimeline(10) };
  now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  window.requestAnimationFrame = (cb) => (frames.set(++nextFrame, cb), nextFrame);
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  initSandboxRuntimeModular();
  const playFor = (seconds: number) => {
    for (let ms = 0; ms < seconds * 1000; ms += 1000 / 60) {
      now += 1000 / 60;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    }
  };
  return { voice, rates, playFor };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__player;
});

it.each([60, 200, 700])(
  "audio that starts %i ms after Play is not sped up to catch the film, on the first Play or after a Pause",
  (startLagMs) => {
    const { voice, rates, playFor } = playNarration(startLagMs);

    window.__player!.play();
    playFor(2);
    window.__player!.pause();
    playFor(0.5);
    window.__player!.play();
    playFor(2);

    expect(rates.filter((r) => r !== 1)).toEqual([]);
    expect(Math.abs(window.__player!.getTime() - voice.currentTime)).toBeLessThan(0.05);
  },
);
