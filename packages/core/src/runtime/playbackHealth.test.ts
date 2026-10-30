import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bridge", () => ({ postRuntimeMessage: vi.fn() }));

import { postRuntimeMessage } from "./bridge";
import {
  notePlaybackFrame,
  noteDisplayScale,
  PLAYBACK_HEALTH,
  restartPlaybackHealth,
  type PlaybackHealthInput,
} from "./playbackHealth";

const posted = vi.mocked(postRuntimeMessage);
const FPS = 30;

type Health = {
  droppedShare: number;
  choppy: boolean;
  fps: number;
  worstFrameMs: number;
  skippedShare: number;
  waitingShare: number;
  gapP50Ms: number;
  gapP95Ms: number;
} | null;
const healths = (): Health[] =>
  posted.mock.calls.map(([message]) =>
    message.type === "preview-health" ? (message.health as Health) : null,
  );

/** Plays `seconds` of film from `startMs`, one tick every `step` ms. */
function play(
  startMs: number,
  seconds: number,
  over: Partial<PlaybackHealthInput> = {},
  step = 1000 / 60,
) {
  let film = (startMs / 1000) * 1;
  for (let ms = startMs; ms <= startMs + seconds * 1000; ms += step) {
    film = ms / 1000;
    notePlaybackFrame({
      nowMs: ms,
      filmTime: film,
      fps: FPS,
      rate: 1,
      playing: true,
      hidden: false,
      waiting: false,
      layoutKey: "a",
      ...over,
    });
  }
}

beforeEach(() => {
  posted.mockClear();
  notePlaybackFrame({
    nowMs: 0,
    filmTime: 0,
    fps: FPS,
    rate: 1,
    playing: false,
    hidden: false,
    waiting: false,
    layoutKey: "a",
  });
  restartPlaybackHealth();
  posted.mockClear();
});

describe("playback health", () => {
  it("reports nothing before the warm-up second and a full window have passed", () => {
    play(1000, PLAYBACK_HEALTH.warmupSeconds + PLAYBACK_HEALTH.windowSeconds - 0.5);
    expect(healths()).toEqual([]);
  });

  it("reads a smooth film as not choppy", () => {
    play(1000, 6);
    const last = healths().at(-1);
    expect(last).toBeTruthy();
    expect(last?.choppy).toBe(false);
    expect(last?.droppedShare).toBeLessThan(0.05);
  });

  it("calls a film choppy when ticks arrive far apart", () => {
    play(1000, 8, {}, 100);
    const last = healths().at(-1);
    expect(last?.choppy).toBe(true);
    expect(last?.worstFrameMs).toBeGreaterThanOrEqual(100);
  });

  it("calls a film choppy when a playing video keeps waiting for data", () => {
    play(1000, 6, { waiting: true });
    expect(healths().at(-1)?.choppy).toBe(true);
  });

  it("names slow ticks as skipped frames with the tick gaps, and a waiting video as waiting", () => {
    play(1000, 8, {}, 100);
    const slow = healths().at(-1);
    expect(slow?.skippedShare).toBeGreaterThan(0.5);
    expect(slow?.waitingShare).toBe(0);
    expect(slow?.gapP50Ms).toBe(100);
    expect(slow?.gapP95Ms).toBe(100);
    restartPlaybackHealth();
    posted.mockClear();
    play(20_000, 6, { waiting: true });
    const waiting = healths().at(-1);
    expect(waiting?.waitingShare).toBeGreaterThan(0.9);
    expect(waiting?.skippedShare).toBeLessThan(0.05);
    expect(waiting?.gapP95Ms).toBeLessThan(20);
  });

  it("does not count stalls in the first second after play starts", () => {
    play(1000, 1, {}, 250);
    play(2250, 4);
    expect(healths().find((health) => health !== null)?.choppy).toBe(false);
  });

  it("does not count the first second after a seek", () => {
    play(1000, 5);
    posted.mockClear();
    notePlaybackFrame({
      nowMs: 6100,
      filmTime: 40,
      fps: FPS,
      rate: 1,
      playing: true,
      hidden: false,
      waiting: false,
      layoutKey: "a",
    });
    expect(healths()).toEqual([null]);
  });

  it("reports null and starts over when playback stops", () => {
    play(1000, 5);
    posted.mockClear();
    notePlaybackFrame({
      nowMs: 6100,
      filmTime: 6.1,
      fps: FPS,
      rate: 1,
      playing: false,
      hidden: false,
      waiting: false,
      layoutKey: "a",
    });
    expect(healths()).toEqual([null]);
  });

  it("keeps measuring when the host repeats the display scale it already sent", () => {
    noteDisplayScale(1);
    play(1000, 5);
    posted.mockClear();
    noteDisplayScale(1);
    expect(healths()).toEqual([]);

    noteDisplayScale(0.5);
    expect(healths()).toEqual([null]);
  });

  it("starts over when the window size changes", () => {
    play(1000, 5);
    posted.mockClear();
    play(6100, 0.1, { layoutKey: "b" });
    expect(healths()).toEqual([null]);
  });
});
