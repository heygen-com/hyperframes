import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parentCopyKey } from "@hyperframes/core/audible-video";
import { ParentAudio } from "./parent-audio.js";
import type { ProxyEntry } from "./parent-media.js";

// No AudioContext in the test DOM: a stand-in transport keeps what it was asked to do, and plays on its own clock.
const { transports, FakeTransport } = vi.hoisted(() => {
  const transports: InstanceType<typeof FakeTransport>[] = [];
  class FakeTransport {
    fetchInit: RequestInit | undefined;
    opts: unknown;
    gen = 0;
    time = -1;
    stops = 0;
    context = { state: "running", resume: vi.fn(async () => {}) };
    decodeAudioElement = vi.fn(async () => ({}) as AudioBuffer);
    schedulePlayback = vi.fn(
      async (_el: unknown, _b: unknown, _s: number, _m: number, read: () => number) => {
        this.time = read();
        return {};
      },
    );
    constructor(opts?: { fetchInit?: RequestInit }) {
      this.opts = opts;
      this.fetchInit = opts?.fetchInit;
      transports.push(this);
    }
    open = () => true;
    setVolume = vi.fn();
    setMuted = vi.fn();
    destroy = vi.fn();
    fitsDecodeBudget = () => true;
    currentGeneration = () => this.gen;
    getTime = () => this.time;
    stopAll() {
      this.gen += 1;
      this.time = -1;
      this.stops += 1;
    }
  }
  return { transports, FakeTransport };
});
vi.mock("@hyperframes/core/runtime/web-audio-transport", () => ({
  WebAudioTransport: FakeTransport,
}));

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";

function copy(src: string, attrs: Record<string, string> = {}): ProxyEntry {
  const el = new Audio();
  el.src = new URL(src, location.href).href;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  Object.defineProperties(el, {
    readyState: { value: 4, configurable: true },
    duration: { value: 30, configurable: true },
  });
  const listed = { kind: "audio" as const, src: el.src, start: 2, mediaStart: 0 };
  return { el, start: 2, duration: 18, mediaStart: 0, listedKey: parentCopyKey(listed) };
}

function player(copies: ProxyEntry[], rate = 1) {
  const sendControl = vi.fn();
  const audio = new ParentAudio({
    copies: () => copies,
    sendControl,
    getCurrentTime: () => 3,
    getPlaybackRate: () => rate,
    getVolume: () => 1,
    getMuted: () => false,
    isPaused: () => false,
  });
  const sent = (action: string) =>
    sendControl.mock.calls.filter(([a]) => a === action).map(([, d]) => d);
  return { audio, sent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  transports.length = 0;
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const total = url.includes("long") ? 68_000_000 : 400_000;
      return new Response(null, {
        status: 206,
        headers: { "content-range": `bytes 0-0/${total}` },
      });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ParentAudio", () => {
  // fails without the fix: a sealed film's audio could only play from late-starting elements.
  it("plays a sealed film's clip from a decoded buffer, tells the film, and posts the clock it follows", async () => {
    const bed = copy("bed.m4a");
    const { audio, sent } = player([bed]);

    audio.play();
    await settle();

    const transport = transports[0]!;
    expect(transport.fetchInit).toEqual({
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(transport.schedulePlayback).toHaveBeenCalledWith(
      bed.el,
      expect.anything(),
      2,
      0,
      expect.any(Function),
      1,
      transport.gen,
      1,
      18,
    );
    expect(bed.claimed).toBe(true);
    expect(sent("set-parent-audio").at(-1)).toEqual({ clips: [bed.listedKey] });
    const clock = sent("audio-clock").at(-1) as { time: number; rate: number; at: number };
    expect(clock.time).toBe(transport.getTime());
    expect(clock.rate).toBe(1);
    expect(Math.abs(clock.at - (performance.timeOrigin + performance.now()))).toBeLessThan(1000);
    audio.destroy();
  });

  it("stops the buffers on pause and lets the film's clock run on its own", async () => {
    const { audio, sent } = player([copy("bed.m4a")]);
    audio.play();
    await settle();

    audio.pause();

    expect(transports[0]!.time).toBe(-1);
    expect(sent("audio-clock").at(-1)).toEqual({ time: null });
    audio.destroy();
  });

  it("gives every clip back to the film at a speed other than 1x, where only its element keeps pitch", async () => {
    const bed = copy("bed.m4a");
    const { audio, sent } = player([bed]);
    audio.play();
    await settle();

    audio.setRate(1.5);

    expect(bed.claimed).toBe(false);
    expect(sent("set-parent-audio").at(-1)).toEqual({ clips: [] });
    audio.destroy();
  });

  it("leaves on its native copy a clip from another host, one in an audio group, and one from a long file", async () => {
    const copies = [
      copy("https://elsewhere.test/bed.m4a"),
      copy("grouped.m4a", { "data-audio-group": "vo" }),
      copy("long-bed.m4a"),
    ];
    const { audio, sent } = player(copies);

    audio.play();
    await settle();

    expect(transports[0]!.schedulePlayback).not.toHaveBeenCalled();
    expect(copies.some((m) => m.claimed)).toBe(false);
    expect(sent("audio-clock")).toEqual([]);
    audio.destroy();
  });

  // fails without the fix: the parent played a mastered film's clips dry and read buses from its own page.
  it("leaves a mastered film's clip on its native copy and reads no bus from the host page", async () => {
    const copies = [{ ...copy("voice.m4a"), mastered: true }];
    const { audio } = player(copies);

    audio.play();
    await settle();

    expect(transports[0]!.schedulePlayback).not.toHaveBeenCalled();
    expect(transports[0]!.opts).toMatchObject({ busDocument: null });
    audio.destroy();
  });

  // fails without the fix: a clip with its own effects chain or automation stayed on its native copy, so it played dry.
  it("plays a clip with its own effects chain or automation from a decoded buffer, attributes and all", async () => {
    const copies = [
      copy("fx.m4a", { "data-fx-chain": '{"version":1,"nodes":[]}' }),
      copy("lane.m4a", { "data-automation": "{}" }),
    ];
    const { audio } = player(copies);

    audio.play();
    await settle();

    const scheduled = transports[0]!.schedulePlayback.mock.calls.map(
      ([el]) => el as HTMLMediaElement,
    );
    expect(
      scheduled.map((el) => el.getAttribute("data-fx-chain") ?? el.getAttribute("data-automation")),
    ).toEqual(['{"version":1,"nodes":[]}', "{}"]);
    audio.destroy();
  });

  it("starts a host's untapped play on the first tap anywhere on its page", async () => {
    const { audio } = player([copy("bed.m4a")]);
    audio.play();
    const transport = transports[0]!;
    transport.context.state = "suspended";
    audio.play();
    const before = transport.context.resume.mock.calls.length;

    document.dispatchEvent(new Event("pointerdown"));

    expect(transport.context.resume.mock.calls.length).toBe(before + 1);
    audio.destroy();
  });
});
