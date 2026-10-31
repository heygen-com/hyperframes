import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportClock } from "./clock";
import { syncRuntimeMedia, type RuntimeMediaClip } from "./media";

// Safari's audio reports the time it was started or seeked to, ready to play, until output begins.
const OUTPUT_START_MS = 150;
const SEEKING_MS = 30;
const TICK_MS = 16;

function safariAudio(now: () => number) {
  const el = document.createElement("audio");
  document.body.appendChild(el);
  let position = 0;
  let movingFromMs = Infinity;
  let paused = true;
  let rate = 1;
  let seeks = 0;
  let seekingUntilMs = -Infinity;
  const restart = () => (movingFromMs = now() + OUTPUT_START_MS);
  const advance = (dtMs: number) => {
    if (!paused && now() >= movingFromMs) position += (dtMs / 1000) * rate;
  };
  Object.defineProperties(el, {
    paused: { configurable: true, get: () => paused },
    seeking: { configurable: true, get: () => now() < seekingUntilMs },
    readyState: { configurable: true, get: () => 4 },
    duration: { configurable: true, get: () => 60 },
    played: {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => position }),
    },
    playbackRate: { configurable: true, get: () => rate, set: (v: number) => (rate = v) },
    currentTime: {
      configurable: true,
      get: () => position,
      set: (v: number) => {
        seeks += 1;
        seekingUntilMs = now() + SEEKING_MS;
        position = v;
        restart();
      },
    },
  });
  el.play = vi.fn(() => {
    paused = false;
    restart();
    return Promise.resolve();
  });
  el.pause = vi.fn(() => void (paused = true));
  return { el, advance, seeks: () => seeks };
}

/** Plays one audio clip for `seconds`; like the runtime, the playhead follows it once it is unpaused. */
function playAudioClock(seconds: number) {
  let ms = 0;
  const audio = safariAudio(() => ms);
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
  for (ms = TICK_MS; ms < seconds * 1000; ms += TICK_MS) {
    audio.advance(TICK_MS);
    if (!audio.el.paused)
      clock.attachAudioSource({ el: audio.el, compositionStart: 0, mediaStart: 0 });
    syncRuntimeMedia({
      clips: [clip],
      timeSeconds: clock.now(),
      playing: true,
      playbackRate: 1,
      getCompositionDuration: () => 60,
    });
  }
  return { seeks: audio.seeks(), time: clock.now(), audioTime: audio.el.currentTime };
}

describe("an audio clock whose output starts late, as Safari's does", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("plays through without seeking the audio it follows", () => {
    const run = playAudioClock(10);
    expect(run.seeks).toBe(0);
    expect(run.time).toBeGreaterThan(9.5);
    expect(Math.abs(run.time - run.audioTime)).toBeLessThan(0.1);
  });
});
