import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

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

let player: Player;
let events: string[];

function createPlayer(attrs: Record<string, string> = {}): Player {
  const el = document.createElement("hyperframes-player") as Player;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  events = [];
  for (const type of ["ready", "ended", "rangeclamped", "durationchange"]) {
    el.addEventListener(type, (event) => {
      const detail = (event as CustomEvent).detail;
      const shown = type === "rangeclamped" ? ` ${JSON.stringify(detail)}` : "";
      events.push(`${type}@${el.currentTime}${shown}`);
    });
  }
  return el;
}

describe("HyperframesPlayer range playback: composition", () => {
  let postSpy: MockInstance<typeof window.postMessage>;

  const send = (data: Record<string, unknown>) =>
    player._onMessage(
      new MessageEvent("message", { source: window, data: { source: "hf-preview", ...data } }),
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
  const seeks = () => controls("seek").map((data) => data.timeSeconds);
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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("parks on range-start at ready and hands the range to the runtime", () => {
    mount({ "range-start": "2", "range-end": "3" });

    expect(events).toEqual(["ready@2"]);
    expect(seeks()).toEqual([2]);
    expect(sentRanges().at(-1)).toEqual([2, 3]);
    expect(player.paused).toBe(true);
  });

  it("starts a play from outside the range at range-start, and leaves a parked seek alone", () => {
    mount({ "range-start": "2", "range-end": "3" });

    player.seek(5);
    state(5, false, true);
    expect(player.currentTime).toBe(5);
    expect(events).toEqual(["ready@2"]);
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

  it("stops at range-end with ended when the runtime reports its end there", () => {
    mount({ "range-start": "2", "range-end": "3" });
    player.play();

    state(3, false, true);

    expect(events).toEqual(["ready@2", "ended@3"]);
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(3);
    player.play();
    expect(seeks().at(-1)).toBe(2);
  });

  it("wraps to range-start and keeps playing with loop", () => {
    mount({ "range-start": "2", "range-end": "3", loop: "" });
    player.play();

    state(3, false, true);

    expect(seeks()).toEqual([2, 2]);
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBe(2);
    expect(events).toEqual(["ready@2"]);
  });

  it("stops or wraps a runtime that ignores set-play-range and plays past the end", () => {
    mount({ "range-start": "2", "range-end": "3" });
    player.play();
    state(3.03, true);
    expect(events).toEqual(["ready@2", "ended@3"]);
    expect(seeks().at(-1)).toBe(3);
    expect(player.paused).toBe(true);

    player.loop = true;
    player.play();
    state(3.03, true);
    expect(seeks().slice(-2)).toEqual([2, 2]);
    expect(player.paused).toBe(false);
  });

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

  it("parks a paused player on a new range's start, and moves a playing one only from outside", () => {
    mount({ "range-start": "2", "range-end": "3" });

    player.rangeEnd = 5;
    player.rangeStart = 4;
    expect(player.currentTime).toBe(4);
    expect(player.paused).toBe(true);
    expect(sentRanges().at(-1)).toEqual([4, 5]);

    player.play();
    state(4.1, true);
    player.rangeStart = 1;
    expect(seeks().at(-1)).toBe(4);
    player.rangeEnd = 2;
    expect(seeks().at(-1)).toBe(1);
    expect(player.paused).toBe(false);
    expect(sentRanges().at(-1)).toEqual([1, 2]);

    state(1.2, true);
    player.rangeEnd = 3;
    expect(seeks().at(-1)).toBe(1);
    expect(player.paused).toBe(false);
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
    expect(player.hasAttribute("range-start")).toBe(false);
    expect(player.rangeStart).toBeNull();
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
    expect(events).toEqual(["ready@0"]);
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

  it("parks, stops with ended, wraps with loop and reports a clamp for a video", () => {
    player = createPlayer({ type: "video/mp4", src: "https://cdn.example.com/film.mp4" });
    player.setAttribute("range-start", "2");
    player.setAttribute("range-end", "3");
    document.body.appendChild(player);
    const video = player.shadowRoot!.querySelector("video")!;
    setMedia(video, { duration: 6, videoWidth: 640, videoHeight: 360 });
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(2);
    expect(events).toEqual(["ready@2"]);

    player.play();
    setMedia(video, { currentTime: 3.01 });
    flushFrame();
    expect(events).toEqual(["ready@2", "ended@3"]);
    expect(player.paused).toBe(true);

    player.loop = true;
    player.play();
    expect(video.currentTime).toBe(2);
    setMedia(video, { currentTime: 3.02 });
    flushFrame();
    expect(video.currentTime).toBe(2);
    expect(playSpy).toHaveBeenCalledTimes(3);
    expect(player.paused).toBe(false);

    setMedia(video, { duration: 2.5 });
    video.dispatchEvent(new Event("durationchange"));
    expect(events.at(-1)).toBe('rangeclamped@2 {"rangeStart":2,"rangeEnd":2.5,"duration":2.5}');
  });

  it("parks, stops and wraps a same-origin __timelines composition inside the range", () => {
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
    expect(events).toEqual(["ready@2", "ended@3"]);

    player.loop = true;
    player.play();
    time = 3.02;
    flushFrame();
    expect(tl.seek).toHaveBeenLastCalledWith(2, false);
    expect(tl.seek).not.toHaveBeenCalledWith(0, false);
    expect(player.paused).toBe(false);
  });
});
