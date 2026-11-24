import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransportClock } from "./clock";
import { syncRuntimeMedia, type RuntimeMediaClip } from "./media";

// Chromium moves an element's currentTime in steps; the element plays at whatever rate it is given.
function steppingAudio(stepMs: number) {
  const el = document.createElement("audio");
  document.body.appendChild(el);
  let position = 0;
  let rate = 1;
  let rateWrites = 0;
  let seeks = 0;
  Object.defineProperties(el, {
    paused: { configurable: true, get: () => false },
    seeking: { configurable: true, get: () => false },
    readyState: { configurable: true, get: () => 4 },
    duration: { configurable: true, get: () => 60 },
    playbackRate: {
      configurable: true,
      get: () => rate,
      set: (v: number) => {
        rateWrites += 1;
        rate = v;
      },
    },
    currentTime: {
      configurable: true,
      get: () => (Math.floor((position * 1000) / stepMs) * stepMs) / 1000,
      set: (v: number) => {
        seeks += 1;
        position = v;
      },
    },
  });
  el.play = vi.fn(() => Promise.resolve());
  el.pause = vi.fn();
  return {
    el,
    advance: (dtMs: number) => (position += (dtMs / 1000) * rate),
    rateWrites: () => rateWrites,
    seeks: () => seeks,
  };
}

/** Plays one audio clip the clock follows for `seconds` of `hz` display frames, syncing media as the runtime does. */
function play(stepMs: number, hz: number, seconds = 10) {
  let ms = 0;
  const audio = steppingAudio(stepMs);
  const clock = new TransportClock({ nowMs: () => ms, duration: 60 });
  const clip: RuntimeMediaClip = {
    el: audio.el,
    start: 0,
    mediaStart: 0,
    duration: 60,
    end: 60,
    volume: null,
    playbackRate: 1,
    loop: false,
    sourceDuration: null,
  };
  clock.play();
  const tickMs = 1000 / hz;
  for (let tick = 1; tick <= seconds * hz; tick++) {
    ms = tick * tickMs;
    audio.advance(tickMs);
    clock.attachAudioSource({ el: audio.el, compositionStart: 0, mediaStart: 0 });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: clock.now(),
      playing: true,
      playbackRate: 1,
      clockAhead: (el) => clock.aheadOf(el),
      getCompositionDuration: () => 60,
    });
  }
  return { rateWrites: audio.rateWrites(), seeks: audio.seeks(), filmSpeed: clock.now() / seconds };
}

describe("a clock that runs between the steps of the audio it follows, as Chromium reports it", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("does not steer that audio against its own lead, so the film keeps its speed", () => {
    for (const [stepMs, hz] of [
      [45, 60],
      [50, 144],
      [60, 60],
      [70, 60],
      [90, 120],
    ]) {
      const run = play(stepMs, hz);
      expect(run.rateWrites, `${stepMs} ms steps at ${hz} Hz: rate writes`).toBe(0);
      expect(run.seeks, `${stepMs} ms steps at ${hz} Hz: seeks`).toBe(0);
      expect(
        Math.abs(run.filmSpeed - 1),
        `${stepMs} ms steps at ${hz} Hz: film speed`,
      ).toBeLessThan(0.001);
    }
  });
});
