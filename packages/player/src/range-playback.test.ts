import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";

type Player = HTMLElement & {
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  currentTime: number;
  duration: number;
  paused: boolean;
  loop: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
  iframe: HTMLIFrameElement;
  _assetsReady: boolean;
  _onMessage: (event: MessageEvent) => void;
  _onProbeReady: (result: unknown) => void;
};

// The last frame inside a range ending at 3 s at 30 fps, and the middle of it.
const HOLD_AT_3 = 89 / 30;
const MID_LAST_AT_3 = 89.5 / 30;

let player: Player;
let events: string[];

function createPlayer(attrs: Record<string, string> = {}): Player {
  const el = document.createElement("hyperframes-player") as Player;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  events = [];
  for (const type of ["ready", "ended", "rangeclamped", "durationchange", "play"]) {
    el.addEventListener(type, (event) => {
      const detail = (event as CustomEvent).detail;
      const shown = type === "rangeclamped" ? ` ${JSON.stringify(detail)}` : "";
      events.push(`${type}@${Number(el.currentTime.toFixed(3))}${shown}`);
    });
  }
  return el;
}

const ranEvents = () => events.filter((e) => !e.startsWith("play@"));

describe("HyperframesPlayer range playback: composition", () => {
  let postSpy: MockInstance<typeof window.postMessage>;
  // A runtime that advertises `play-range` (the current one), or an older one that does not.
  let protocol: Record<string, unknown>;

  const send = (data: Record<string, unknown>) =>
    player._onMessage(
      new MessageEvent("message", {
        source: window,
        data: { source: "hf-preview", ...protocol, ...data },
      }),
    );
  const timeline = (seconds: number) =>
    send({
      type: "timeline",
      durationInFrames: seconds * 30,
      durationSeconds: seconds,
      scenes: [],
    });
  const state = (currentTime: number, isPlaying: boolean, ended = false) =>
    send({ type: "state", frame: Math.round(currentTime * 30), currentTime, isPlaying, ended });
  const controls = (action: string) =>
    postSpy.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((data) => data?.type === "control" && data.action === action);
  const seeks = () => controls("seek").map((data) => data.timeSeconds as number);
  const sentRanges = () =>
    controls("set-play-range").map((data) => [data.startSeconds, data.endSeconds]);

  function mount(attrs: Record<string, string> = {}, seconds = 6) {
    player = createPlayer(attrs);
    Object.defineProperty(player.iframe, "contentWindow", {
      configurable: true,
      get: () => window,
    });
    document.body.appendChild(player);
    timeline(seconds);
    player._assetsReady = true;
  }

  beforeEach(async () => {
    await import("./hyperframes-player.js");
    postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    protocol = { ...runtimeProtocolMetadata(30) };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("parks on range-start at ready and hands the range to the runtime once", () => {
    mount({ "range-start": "2", "range-end": "3" });

    expect(events).toEqual(["ready@2"]);
    expect(seeks()).toEqual([2]);
    expect(sentRanges()).toEqual([[2, 3]]);
    expect(player.paused).toBe(true);
  });

  it("starts a play from outside the range at range-start, and leaves a parked seek alone", () => {
    mount({ "range-start": "2", "range-end": "3" });

    player.seek(5);
    state(5, false, true);
    expect(player.currentTime).toBe(5);
    expect(ranEvents()).toEqual(["ready@2"]);
    player.play();
    expect(seeks()).toEqual([2, 5, 2]);
    expect(player.currentTime).toBe(2);

    player.seek(1);
    player.play();
    expect(seeks().at(-1)).toBe(2);

    player.seek(2.5);
    player.play();
    expect(seeks().at(-1)).toBe(2.5);
  });

  it("ends on the range's last frame when the runtime reports its end there", () => {
    mount({ "range-start": "2", "range-end": "3" });
    player.play();

    state(HOLD_AT_3, false, true);

    expect(ranEvents()).toEqual(["ready@2", "ended@2.967"]);
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(HOLD_AT_3);
    player.play();
    expect(seeks().at(-1)).toBe(2);
  });

  it("wraps to range-start and keeps playing with loop", () => {
    mount({ "range-start": "2", "range-end": "3", loop: "" });
    player.play();

    state(HOLD_AT_3, false, true);

    expect(seeks()).toEqual([2, 2]);
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBe(2);
    expect(ranEvents()).toEqual(["ready@2"]);
  });

  it("stops an older runtime that plays past the end on the last frame inside, or wraps it", () => {
    protocol = {};
    mount({ "range-start": "2", "range-end": "3" });
    player.play();
    state(3.03, true);
    expect(ranEvents()).toEqual(["ready@2", "ended@2.967"]);
    expect(seeks().at(-1)).toBe(HOLD_AT_3);
    expect(player.currentTime).toBe(HOLD_AT_3);
    expect(player.paused).toBe(true);

    player.loop = true;
    player.play();
    state(2.1, true);
    state(3.03, true);
    expect(seeks().slice(-2)).toEqual([2, 2]);
    expect(player.paused).toBe(false);
  });

  for (const runtime of ["a play-range runtime", "an older runtime"]) {
    it(`keeps playing from range-start with ${runtime} when a new end leaves the playhead past it`, () => {
      if (runtime === "an older runtime") protocol = {};
      mount({ "range-start": "2", "range-end": "3" });
      player.play();
      state(2.5, true);
      const seeksBefore = seeks().length;
      const eventsBefore = events.length;

      player.rangeEnd = 2.4;
      state(2.53, true);
      state(2.54, true, true);
      state(2, true);

      expect(events.slice(eventsBefore)).toEqual([]);
      expect(player.paused).toBe(false);
      expect(player.currentTime).toBe(2);
      expect(sentRanges().at(-1)).toEqual([2, 2.4]);
      // A play-range runtime jumps by itself; for an older one the player seeks.
      expect(seeks().slice(seeksBefore)).toEqual(runtime === "an older runtime" ? [2] : []);

      // Past the new end: an older runtime is read from its time, a current one says so.
      if (runtime === "an older runtime") state(2.41, true);
      else state(71 / 30, false, true);
      expect(ranEvents().at(-1)).toBe("ended@2.367");
    });
  }

  it("clamps a range past the film to its end and says so once", () => {
    mount({ "range-start": "2", "range-end": "10", loop: "" });
    timeline(6);

    expect(events).toEqual([
      "ready@2",
      'rangeclamped@2 {"rangeStart":2,"rangeEnd":6,"duration":6}',
    ]);
    expect(sentRanges().at(-1)).toEqual([2, 6]);
    player.play();
    state(6, false, true);
    expect(seeks().at(-1)).toBe(2);
  });

  it("clamps when a later duration makes the range exceed the film", () => {
    mount({ "range-start": "2", "range-end": "5" });
    expect(events).toEqual(["ready@2"]);

    timeline(4);

    expect(events).toEqual([
      "ready@2",
      "durationchange@2",
      'rangeclamped@2 {"rangeStart":2,"rangeEnd":4,"duration":4}',
    ]);
    expect(sentRanges().at(-1)).toEqual([2, 4]);
  });

  it("plays an empty or negative range as if unset, and says so once", () => {
    mount({ "range-start": "3", "range-end": "2", loop: "" });
    timeline(6);

    expect(events).toEqual([
      "ready@0",
      'rangeclamped@0 {"rangeStart":null,"rangeEnd":null,"duration":6}',
    ]);
    expect(seeks()).toEqual([]);
    expect(sentRanges().at(-1)).toEqual([null, null]);
    player.play();
    state(6, false, true);
    expect(seeks()).toEqual([0]);

    player.rangeStart = -1;
    expect(events.at(-1)).toBe('rangeclamped@0 {"rangeStart":null,"rangeEnd":null,"duration":6}');
    expect(events.filter((e) => e.startsWith("rangeclamped"))).toHaveLength(2);
  });

  it("re-parks a paused player on a new range's start only when the playhead falls outside it", () => {
    mount({ "range-start": "2", "range-end": "3" });

    player.rangeEnd = 5;
    expect(seeks()).toEqual([2]);
    player.rangeStart = 4;
    expect(seeks()).toEqual([2, 4]);
    player.seek(4.5);
    player.rangeEnd = 4.8;
    expect(seeks().at(-1)).toBe(4.5);
    expect(player.currentTime).toBe(4.5);
    player.rangeEnd = 4.2;
    expect(seeks().at(-1)).toBe(4);
    expect(player.paused).toBe(true);
    expect(sentRanges().at(-1)).toEqual([4, 4.2]);
  });

  it("clears the range in the runtime when both attributes go", () => {
    mount({ "range-start": "2", "range-end": "3" });

    player.removeAttribute("range-start");
    player.removeAttribute("range-end");

    expect(sentRanges().at(-1)).toEqual([null, null]);
  });

  it("reflects range-start and range-end as rangeStart and rangeEnd both ways", () => {
    player = createPlayer();
    expect([player.rangeStart, player.rangeEnd]).toEqual([null, null]);

    player.rangeStart = 1.5;
    player.setAttribute("range-end", "4");
    expect(player.getAttribute("range-start")).toBe("1.5");
    expect(player.rangeEnd).toBe(4);

    player.rangeStart = null;
    player.rangeEnd = undefined as unknown as null;
    expect(player.hasAttribute("range-start")).toBe(false);
    expect(player.hasAttribute("range-end")).toBe(false);
    expect([player.rangeStart, player.rangeEnd]).toEqual([null, null]);
  });

  // Pins the existing whole-film behaviour: no range attribute, no new message, loop from 0.
  it("changes nothing for a player without range attributes", () => {
    mount({ loop: "" });
    send({ type: "ready" });
    player.play();
    state(6, false, true);

    expect([player.rangeStart, player.rangeEnd]).toEqual([null, null]);
    expect(sentRanges()).toEqual([]);
    expect(seeks()).toEqual([0]);
    expect(ranEvents()).toEqual(["ready@0"]);
  });
});

describe("HyperframesPlayer range playback: video and direct timelines", () => {
  let frames: FrameRequestCallback[];
  let playSpy: MockInstance<HTMLMediaElement["play"]>;

  function setMedia(video: HTMLMediaElement, props: Record<string, unknown>) {
    for (const [name, value] of Object.entries(props)) {
      Object.defineProperty(video, name, { configurable: true, writable: true, value });
    }
  }

  function flushFrame() {
    const frame = frames.shift();
    if (!frame) throw new Error("no animation frame queued");
    frame(performance.now());
  }

  beforeEach(async () => {
    await import("./hyperframes-player.js");
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(function (this: HTMLMediaElement) {
        setMedia(this, { paused: false });
        return Promise.resolve();
      });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      function (this: HTMLMediaElement) {
        setMedia(this, { paused: true });
      },
    );
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("parks, stops on the last frame inside, wraps with loop and reports a clamp for a video", () => {
    player = createPlayer({ type: "video/mp4", src: "https://cdn.example.com/film.mp4" });
    player.setAttribute("range-start", "2");
    player.setAttribute("range-end", "3");
    document.body.appendChild(player);
    const video = player.shadowRoot!.querySelector("video")!;
    setMedia(video, { duration: 6, videoWidth: 640, videoHeight: 360 });
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(2);
    expect(ranEvents()).toEqual(["ready@2"]);

    player.play();
    setMedia(video, { currentTime: 3.01 });
    flushFrame();
    expect(ranEvents()).toEqual(["ready@2", "ended@2.983"]);
    expect(video.currentTime).toBeCloseTo(MID_LAST_AT_3, 9);
    expect(player.currentTime).toBeCloseTo(MID_LAST_AT_3, 9);
    expect(player.paused).toBe(true);

    player.loop = true;
    player.play();
    expect(video.currentTime).toBe(2);
    setMedia(video, { currentTime: 3.02 });
    flushFrame();
    expect(video.currentTime).toBe(2);
    expect(playSpy).toHaveBeenCalledTimes(3);
    expect(player.paused).toBe(false);

    const plays = events.filter((e) => e.startsWith("play@")).length;
    player.rangeEnd = 2.5;
    setMedia(video, { currentTime: 2.7 });
    player.rangeStart = 2.1;
    expect(video.currentTime).toBe(2.1);
    expect(player.paused).toBe(false);
    expect(events.filter((e) => e.startsWith("play@"))).toHaveLength(plays);

    setMedia(video, { duration: 2.4 });
    video.dispatchEvent(new Event("durationchange"));
    expect(events.at(-1)).toBe('rangeclamped@2.1 {"rangeStart":2.1,"rangeEnd":2.4,"duration":2.4}');
  });

  it("stops a check early at a range end inside the film, never at the film's own end", () => {
    player = createPlayer({ type: "video/mp4", src: "https://cdn.example.com/film.mp4" });
    player.setAttribute("range-end", "3");
    document.body.appendChild(player);
    const video = player.shadowRoot!.querySelector("video")!;
    setMedia(video, { duration: 6, videoWidth: 640, videoHeight: 360 });
    video.dispatchEvent(new Event("loadedmetadata"));

    player.play();
    setMedia(video, { currentTime: 2.95 });
    flushFrame();
    setMedia(video, { currentTime: 2.99 });
    flushFrame();
    expect(ranEvents()).toEqual(["ready@0", "ended@2.983"]);

    player.removeAttribute("range-end");
    player.seek(5.9);
    player.play();
    setMedia(video, { currentTime: 5.95 });
    flushFrame();
    setMedia(video, { currentTime: 5.99 });
    flushFrame();
    expect(player.paused).toBe(false);
  });

  it("checks a video's range end on its timeupdate while the tab is hidden", () => {
    player = createPlayer({ type: "video/mp4", src: "https://cdn.example.com/film.mp4" });
    player.setAttribute("range-end", "3");
    document.body.appendChild(player);
    const video = player.shadowRoot!.querySelector("video")!;
    setMedia(video, { duration: 6, videoWidth: 640, videoHeight: 360 });
    video.dispatchEvent(new Event("loadedmetadata"));

    player.play();
    setMedia(video, { currentTime: 3.01 });
    video.dispatchEvent(new Event("timeupdate"));
    expect(player.paused).toBe(false);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    try {
      video.dispatchEvent(new Event("timeupdate"));
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
    expect(ranEvents()).toEqual(["ready@0", "ended@2.983"]);
  });

  it("parks, stops on the last frame inside and wraps a same-origin __timelines composition", () => {
    let time = 0;
    const tl = {
      duration: () => 6,
      time: () => time,
      seek: vi.fn((t: number) => void (time = t)),
      play: vi.fn(),
      pause: vi.fn(),
    };
    player = createPlayer({ "range-start": "2", "range-end": "3" });
    Object.defineProperty(player.iframe, "contentWindow", {
      configurable: true,
      get: () => ({ __timelines: { main: tl }, postMessage: vi.fn() }),
    });
    document.body.appendChild(player);
    player._onProbeReady({
      duration: 6,
      adapter: { kind: "direct-timeline", timeline: tl, getDuration: () => 6 },
      compositionSize: null,
    });
    player._assetsReady = true;
    expect(tl.seek).toHaveBeenLastCalledWith(2, false);

    player.play();
    time = 3.02;
    flushFrame();
    expect(ranEvents()).toEqual(["ready@2", "ended@2.983"]);
    expect(time).toBeCloseTo(MID_LAST_AT_3, 9);

    player.loop = true;
    player.play();
    time = 3.02;
    flushFrame();
    expect(tl.seek).toHaveBeenLastCalledWith(2, false);
    expect(tl.seek).not.toHaveBeenCalledWith(0, false);
    expect(player.paused).toBe(false);
  });
});
