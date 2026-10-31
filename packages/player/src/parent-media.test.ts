import { afterEach, describe, it, expect, vi } from "vitest";
import { mediaElementTime } from "@hyperframes/core/runtime/media-clock";
import { ParentMediaManager, type ProxyEntry } from "./parent-media";

// A fake media element whose paused state is driven by play()/pause() stubs.
function makeFakeAudio(
  initiallyPaused: boolean,
  tag: "audio" | "video" = "audio",
): HTMLMediaElement {
  const el = tag === "video" ? document.createElement("video") : new Audio();
  let paused = initiallyPaused;
  Object.defineProperty(el, "paused", { get: () => paused });
  el.pause = () => {
    paused = true;
  };
  el.play = () => {
    paused = false;
    return Promise.resolve();
  };
  el.src = "https://example.test/music.mp3";
  return el;
}

function makeManager(overrides: Partial<{ isPaused: boolean; owner: "runtime" | "parent" }> = {}) {
  const mgr = new ParentMediaManager({
    dispatchEvent: () => {},
    getMuted: () => false,
    getVolume: () => 1,
    getPlaybackRate: () => 1,
    getCurrentTime: () => 0,
    isPaused: () => overrides.isPaused ?? true,
  });
  return mgr;
}

describe("ParentMediaManager audio-src proxy lifecycle", () => {
  it("replaces the audio-src proxy instead of stacking a second one", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    expect(mgr.entries).toHaveLength(1);

    mgr.setupFromUrl("https://example.test/b.mp3");
    // The old proxy must be gone, not accumulated alongside the new one.
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0].el.src).toBe("https://example.test/b.mp3");
  });

  it("is a no-op when the same audio-src URL is set again", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    const first = mgr.entries[0];

    mgr.setupFromUrl("https://example.test/a.mp3");
    expect(mgr.entries).toHaveLength(1);
    // Same element reference — not torn down and rebuilt.
    expect(mgr.entries[0]).toBe(first);
  });

  it("clears the audio-src proxy on teardownUrlAudio", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    const el = mgr.entries[0].el;

    mgr.teardownUrlAudio();
    expect(mgr.entries).toHaveLength(0);
    // The proxy's source is reset so it stops preloading.
    expect(el.src).not.toBe("https://example.test/a.mp3");
  });

  it("teardownUrlAudio removes only the url proxy, leaving other entries", () => {
    const mgr = makeManager();
    // Simulate an iframe-adopted entry already in the pool.
    const adopted: ProxyEntry = {
      el: new Audio(),
      start: 0,
      duration: Infinity,
      mediaStart: 0,
    };
    adopted.el.src = "https://example.test/iframe-clip.mp4";
    mgr.entries.push(adopted);

    mgr.setupFromUrl("https://example.test/a.mp3");
    expect(mgr.entries).toHaveLength(2);

    mgr.teardownUrlAudio();
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0]).toBe(adopted);
  });

  it("teardownUrlAudio is safe to call with no audio-src set", () => {
    const mgr = makeManager();
    expect(() => mgr.teardownUrlAudio()).not.toThrow();
    expect(mgr.entries).toHaveLength(0);
  });

  it("pauses a proxy once the playhead passes the clip end (trimmed clip)", () => {
    const mgr = makeManager({ owner: "parent", isPaused: false });
    const el = makeFakeAudio(false); // already playing within the clip
    mgr.entries.push({ el, start: 0, duration: 5, mediaStart: 0 });

    mgr.mirrorTime(3); // inside [0, 5) — stays playing
    expect(el.paused).toBe(false);

    mgr.mirrorTime(6); // past the trimmed end — must pause
    expect(el.paused).toBe(true);
  });

  it("re-reads the source element's live data-duration so trims bound the proxy", () => {
    const mgr = makeManager({ owner: "parent", isPaused: false });
    const source = new Audio();
    source.setAttribute("data-start", "0");
    source.setAttribute("data-duration", "30");
    // jsdom reports isConnected=false unless attached; attach it.
    document.body.appendChild(source);

    const el = makeFakeAudio(false);
    mgr.entries.push({ el, start: 0, duration: 30, mediaStart: 0, source });

    mgr.mirrorTime(20); // within 30 → playing
    expect(el.paused).toBe(false);

    // User trims the clip to 10s; the proxy must pick it up and pause at 20s.
    source.setAttribute("data-duration", "10");
    mgr.mirrorTime(20);
    expect(el.paused).toBe(true);
    source.remove();
  });

  it("scrubAll plays in-window proxies at the playhead and pauses out-of-window ones", () => {
    const mgr = makeManager({ owner: "parent" });
    const inWin = makeFakeAudio(true); // currently paused — scrub should start it
    const outWin = makeFakeAudio(false); // currently playing, but outside its window
    mgr.entries.push({ el: inWin, start: 0, duration: 5, mediaStart: 0 });
    mgr.entries.push({ el: outWin, start: 10, duration: 5, mediaStart: 0 });

    mgr.scrubAll(2); // playhead at 2s

    // in-window proxy: positioned at rel time and AUDIBLE (the point of scrub-audio)
    expect(inWin.currentTime).toBeCloseTo(mediaElementTime(2), 9);
    expect(inWin.paused).toBe(false);
    // out-of-window proxy: paused, not blipped
    expect(outWin.paused).toBe(true);
  });

  it("does not duplicate or hijack a clip the composition already owns", () => {
    const mgr = makeManager();
    // The composition already adopted a clip with this URL.
    const adopted: ProxyEntry = {
      el: new Audio(),
      start: 0,
      duration: Infinity,
      mediaStart: 0,
    };
    adopted.el.src = "https://example.test/shared.mp3";
    mgr.entries.push(adopted);

    // Pointing audio-src at the same URL must not create a second proxy...
    mgr.setupFromUrl("https://example.test/shared.mp3");
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0]).toBe(adopted);

    // ...and removing audio-src must not tear down the composition's own clip
    // (teardown targets the tracked proxy by reference, not by URL match).
    mgr.teardownUrlAudio();
    expect(mgr.entries).toHaveLength(1);
    expect(mgr.entries[0]).toBe(adopted);
  });
});

describe("ParentMediaManager priming", () => {
  const iPhone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  afterEach(() => vi.restoreAllMocks());

  function primed() {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/a.mp3");
    const el = mgr.entries[0].el;
    const calls: string[] = [];
    const play = el.play.bind(el);
    el.play = () => (calls.push("play"), play());
    const pause = el.pause.bind(el);
    el.pause = () => (calls.push("pause"), pause());
    mgr.primeAll();
    return calls;
  }

  it("plays then pauses every idle copy so iOS lets it start after the tap", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(iPhone);
    expect(primed()).toEqual(["play", "pause"]);
  });

  it("leaves the copies alone where no tap is needed", () => {
    expect(primed()).toEqual([]);
  });
});

describe("ParentMediaManager across documents", () => {
  afterEach(() => document.body.replaceChildren());

  it("drops the previous document's proxies on reset and keeps the audio-src one", () => {
    const mgr = makeManager();
    mgr.setupFromUrl("https://example.test/narration.mp3");
    const track = document.createElement("audio");
    track.setAttribute("src", "https://example.test/old-film.mp3");
    track.setAttribute("data-start", "0");
    track.preload = "auto";
    document.body.appendChild(track);
    mgr.setupFromIframe(document);
    expect(mgr.entries).toHaveLength(2);
    const oldProxy = mgr.entries[1].el;

    mgr.resetForIframeLoad();

    expect(mgr.entries.map((m) => m.el.src)).toEqual(["https://example.test/narration.mp3"]);
    expect(oldProxy.getAttribute("src")).toBe("");
  });

  it("keeps the audio-src track after a reset when the old document shared its URL", () => {
    const mgr = makeManager();
    const track = document.createElement("audio");
    track.setAttribute("src", "https://example.test/narration.mp3");
    track.setAttribute("data-start", "2");
    track.setAttribute("data-duration", "3");
    track.preload = "auto";
    document.body.appendChild(track);
    mgr.setupFromIframe(document);
    mgr.setupFromUrl("https://example.test/narration.mp3");
    expect(mgr.entries).toHaveLength(1);

    mgr.resetForIframeLoad();

    expect(mgr.entries.map((m) => [m.el.src, m.start, m.duration])).toEqual([
      ["https://example.test/narration.mp3", 0, Infinity],
    ]);
  });
});

describe("ParentMediaManager following its clips", () => {
  afterEach(() => document.body.replaceChildren());
  const flushObserver = () => new Promise((resolveFlush) => setTimeout(resolveFlush, 0));

  function adoptedClip(mgr: ParentMediaManager, src: string): HTMLVideoElement {
    const clip = document.createElement("video");
    clip.setAttribute("src", src);
    clip.setAttribute("data-start", "0");
    clip.preload = "auto";
    document.body.appendChild(clip);
    mgr.setupFromIframe(document);
    return clip;
  }

  const copy = "https://example.test/clip.mov?hf-proxy=h264";

  it("drops a clip's proxy when the runtime stops preloading the clip, and adopts it again when due", async () => {
    const mgr = makeManager();
    const clip = adoptedClip(mgr, "https://example.test/clip.mp4");
    const proxy = mgr.entries[0].el;

    clip.preload = "none";
    await flushObserver();
    expect(mgr.entries).toHaveLength(0);
    expect(proxy.getAttribute("src")).toBe("");

    clip.preload = "auto";
    await flushObserver();
    expect(mgr.entries.map((m) => m.el.src)).toEqual(["https://example.test/clip.mp4"]);
  });

  it("keeps a re-pointed clip's proxy on its file while the composition owns playback", async () => {
    const mgr = makeManager();
    const clip = adoptedClip(mgr, "https://example.test/clip.mov");
    clip.setAttribute("src", copy);
    await flushObserver();

    expect(mgr.entries.map((m) => m.el.src)).toEqual(["https://example.test/clip.mov"]);
  });

  it("re-points each proxy to its clip's current src when the parent takes over playback", async () => {
    const mgr = makeManager();
    const clip = adoptedClip(mgr, "https://example.test/clip.mov");
    clip.setAttribute("src", copy);
    await flushObserver();

    mgr.promoteToParentProxy(document);

    expect(mgr.entries.map((m) => m.el.src)).toEqual([copy]);
  });

  it("follows a re-pointed clip at once while the parent owns playback", async () => {
    const mgr = makeManager();
    const clip = adoptedClip(mgr, "https://example.test/clip.mov");
    mgr.promoteToParentProxy(document);
    clip.setAttribute("src", copy);
    await flushObserver();

    expect(mgr.entries.map((m) => m.el.src)).toEqual([copy]);
  });

  it("gives a clip re-pointed at another clip's file its own proxy", async () => {
    const mgr = makeManager();
    adoptedClip(mgr, "https://example.test/a.mov");
    const b = adoptedClip(mgr, "https://example.test/b.mov");
    mgr.promoteToParentProxy(document);
    b.setAttribute("src", "https://example.test/a.mov");
    await flushObserver();

    expect(mgr.entries.map((m) => m.el.src)).toEqual([
      "https://example.test/a.mov",
      "https://example.test/a.mov",
    ]);
  });

  const files = (mgr: ParentMediaManager) => mgr.entries.map((m) => m.el.src).sort();

  it("keeps both proxies when two clips swap files while the parent owns playback", async () => {
    const mgr = makeManager();
    const a = adoptedClip(mgr, "https://example.test/a.mov");
    const b = adoptedClip(mgr, "https://example.test/b.mov");
    mgr.promoteToParentProxy(document);
    a.setAttribute("src", "https://example.test/b.mov");
    b.setAttribute("src", "https://example.test/a.mov");
    await flushObserver();

    expect(files(mgr)).toEqual(["https://example.test/a.mov", "https://example.test/b.mov"]);
  });

  it("keeps both proxies when two clips swap or chain files before the parent takes over", async () => {
    const mgr = makeManager();
    const a = adoptedClip(mgr, "https://example.test/a.mov");
    const b = adoptedClip(mgr, "https://example.test/b.mov");
    a.setAttribute("src", "https://example.test/b.mov");
    b.setAttribute("src", "https://example.test/c.mov");
    await flushObserver();

    mgr.promoteToParentProxy(document);

    expect(files(mgr)).toEqual(["https://example.test/b.mov", "https://example.test/c.mov"]);
  });

  it("keeps the proxy of a clip when another clip on the same file leaves", async () => {
    const mgr = makeManager();
    const first = adoptedClip(mgr, "https://example.test/a.mov");
    const twin = adoptedClip(mgr, "https://example.test/a.mov");
    twin.remove();
    await flushObserver();

    expect(mgr.entries.map((m) => m.source)).toEqual([first]);
  });

  it("drops the proxy of a re-pointed clip when the clip leaves", async () => {
    const mgr = makeManager();
    const clip = adoptedClip(mgr, "https://example.test/clip.mov");
    clip.setAttribute("src", copy);
    await flushObserver();

    clip.remove();
    await flushObserver();

    expect(mgr.entries).toHaveLength(0);
  });
});

describe("ParentMediaManager clip window", () => {
  it("plays a proxy inside its clip window and pauses it at the clip end instant", () => {
    const mgr = makeManager({ isPaused: false, owner: "parent" });
    const el = makeFakeAudio(false);
    mgr.entries.push({ el, start: 1, duration: 2, mediaStart: 0 });

    mgr.mirrorTime(2.999);
    expect(el.paused).toBe(false);
    mgr.mirrorTime(3);
    expect(el.paused).toBe(true);
  });
});

describe("ParentMediaManager takes cut from one joined file", () => {
  afterEach(() => document.body.replaceChildren());

  const FILE = "https://example.test/joined.mp4";
  // [data-start, data-duration, data-media-start] of each take: the picture cuts hard, the audio window
  // starts a little before the cut and ends a little after it.
  const TAKES = [
    [0, 8.2, 3],
    [8, 8.2, 20],
    [16, 8.8, 31.5],
  ];

  function mountTakes() {
    const audios: HTMLAudioElement[] = [];
    for (const [start, duration, mediaStart] of TAKES) {
      const video = document.createElement("video");
      video.setAttribute("src", FILE);
      video.setAttribute("muted", "");
      video.setAttribute("data-start", String(start));
      video.setAttribute("data-duration", String(duration));
      video.setAttribute("data-media-start", String(mediaStart));
      const audio = document.createElement("audio");
      audio.setAttribute("src", FILE);
      audio.setAttribute("data-start", String(start));
      audio.setAttribute("data-duration", String(duration));
      audio.setAttribute("data-media-start", String(mediaStart));
      document.body.append(video, audio);
      audios.push(audio);
    }
    return audios;
  }

  // Count writes to currentTime the way a seek storm shows up in a browser.
  function trackSeeks(el: HTMLMediaElement) {
    let time = 0;
    const seeks: number[] = [];
    Object.defineProperty(el, "currentTime", {
      get: () => time,
      set: (v: number) => {
        time = v;
        seeks.push(v);
      },
    });
    let paused = true;
    Object.defineProperty(el, "paused", { get: () => paused });
    el.play = () => {
      paused = false;
      return Promise.resolve();
    };
    el.pause = () => {
      paused = true;
    };
    return {
      seeks,
      advance: (dt: number) => {
        if (!paused) time += dt;
      },
    };
  }

  it("plays every take from its own media start for its own window, with one seek per take", () => {
    const audios = mountTakes();
    const mgr = makeManager({ isPaused: false });
    mgr.setupFromIframe(document);
    expect(mgr.entries).toHaveLength(audios.length);
    const tracks = mgr.entries.map((m) => trackSeeks(m.el));
    mgr.promoteToParentProxy(document);

    let t = 0;
    const playing: boolean[][] = [];
    for (; t <= 25; t += 0.1) {
      mgr.mirrorTime(t);
      playing.push(mgr.entries.map((m) => !m.el.paused));
      for (const track of tracks) track.advance(0.1);
    }

    // each take is heard, and from the cut footage's own place in the file
    TAKES.forEach(([start, duration, mediaStart], i) => {
      const first = tracks[i].seeks[0];
      expect(first).toBeGreaterThanOrEqual(mediaStart);
      expect(first).toBeLessThanOrEqual(mediaStart + 0.1);
      expect(playing.some((row) => row[i])).toBe(true);
      expect(mgr.entries[i].start).toBe(start);
      expect(mgr.entries[i].duration).toBe(duration);
      // at most the entry seek per take window (promotion adds one aligned seek at most)
      expect(tracks[i].seeks.length).toBeLessThanOrEqual(2);
    });
    // a muted video is picture only: no proxy plays its file's audio on top of its take's audio
    expect(mgr.entries.every((m) => m.source?.tagName === "AUDIO")).toBe(true);
  });

  it("keeps every take silent outside its window", () => {
    mountTakes();
    const mgr = makeManager({ isPaused: false });
    mgr.setupFromIframe(document);
    mgr.entries.forEach((m) => trackSeeks(m.el));
    mgr.promoteToParentProxy(document);

    mgr.mirrorTime(12);
    expect(mgr.entries.map((m) => !m.el.paused)).toEqual([false, true, false]);
    mgr.mirrorTime(24.5);
    expect(mgr.entries.map((m) => !m.el.paused)).toEqual([false, false, true]);
  });

  it("seeks a take to its media start plus the time into its window on a user seek", () => {
    mountTakes();
    const mgr = makeManager();
    mgr.setupFromIframe(document);
    const tracks = mgr.entries.map((m) => trackSeeks(m.el));

    mgr.seekAll(10);

    expect(tracks[1].seeks.map(Math.round)).toEqual([22]);
    expect(tracks[0].seeks).toEqual([]);
  });

  it("positions an upcoming take at its media start before its window opens", () => {
    mountTakes();
    const mgr = makeManager({ isPaused: false });
    mgr.setupFromIframe(document);
    const tracks = mgr.entries.map((m) => trackSeeks(m.el));
    mgr.promoteToParentProxy(document);

    mgr.mirrorTime(6.4); // inside take 1's window, 1.6 s before take 2
    expect(tracks[1].seeks.at(-1)).toBeUndefined();
    mgr.mirrorTime(7.0);
    expect(tracks[1].seeks.map(Math.round)).toEqual([20]);
    expect(mgr.entries[1].el.paused).toBe(true);

    // at the cut it only plays: no second seek
    mgr.mirrorTime(8.0);
    expect(mgr.entries[1].el.paused).toBe(false);
    expect(tracks[1].seeks.map(Math.round)).toEqual([20]);
  });
});

describe("ParentMediaManager drift policy", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  // A playing proxy `lag` seconds behind a timeline at `t`, a clip that starts at 0 and plays from media 0.
  function playingProxy(lag: number, t = 5, tag: "audio" | "video" = "audio") {
    const mgr = makeManager({ isPaused: false });
    const el = makeFakeAudio(false, tag);
    const writes: number[] = [];
    let time = t - lag;
    Object.defineProperty(el, "currentTime", {
      get: () => time,
      set: (v: number) => {
        time = v;
        writes.push(v);
      },
    });
    mgr.entries.push({ el, start: 0, duration: 30, mediaStart: 0 });
    return { mgr, el, writes, setTime: (v: number) => (time = v) };
  }

  it("leaves a proxy inside the sync tolerance alone", () => {
    const { mgr, el, writes, setTime } = playingProxy(0.03);
    mgr.mirrorTime(5);
    setTime(5.07);
    mgr.mirrorTime(5.1);
    expect(writes).toEqual([]);
    expect(el.playbackRate).toBe(1);
  });

  it("steers a proxy that lags a little by rate, capped at 10%, without seeking", () => {
    const { mgr, el, writes } = playingProxy(0.07);
    mgr.mirrorTime(5);
    mgr.mirrorTime(5.08);
    expect(writes).toEqual([]);
    expect(el.playbackRate).toBeGreaterThan(1);
    expect(el.playbackRate).toBeLessThanOrEqual(1.1);
  });

  it("returns a steered proxy to its authored rate once it has caught up", () => {
    const { mgr, el, setTime } = playingProxy(0.07);
    mgr.mirrorTime(5);
    setTime(5.1);
    mgr.mirrorTime(5.1);
    expect(el.playbackRate).toBe(1);
  });

  it("seeks a proxy that holds a lag past 100 ms, once", () => {
    const { mgr, writes, setTime } = playingProxy(0.25);
    mgr.mirrorTime(5); // first sample: offset not yet known to hold
    setTime(4.85); // the proxy advanced with the timeline: the lag held
    mgr.mirrorTime(5.1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeCloseTo(mediaElementTime(5.1), 9);
  });

  it("seeks a video proxy that holds a 1 s lag: a proxy is heard, whatever its tag", () => {
    const { mgr, el, writes, setTime } = playingProxy(1, 5, "video");
    mgr.mirrorTime(5);
    setTime(4.1);
    mgr.mirrorTime(5.1);
    expect(writes).toHaveLength(1);
    expect(el.playbackRate).toBe(1);
  });

  it("steers, never seeks, a proxy whose lag keeps growing because it is stalled", () => {
    const { mgr, el, writes } = playingProxy(0.25);
    mgr.mirrorTime(5);
    mgr.mirrorTime(5.1); // currentTime did not move: lag grew by 100 ms
    expect(writes).toEqual([]);
    expect(el.playbackRate).toBeLessThanOrEqual(1.1);
  });

  it("seeks at once on a forced alignment when the proxy is off the playhead", () => {
    const { mgr, writes } = playingProxy(2);
    mgr.mirrorTime(5, { force: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeCloseTo(mediaElementTime(5), 9);
  });

  it("aims a seek of a playing proxy ahead by the time its last seek took to land", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const mgr = makeManager({ isPaused: false });
    mgr.setupFromUrl("https://example.test/take.mp3");
    const el = mgr.entries[0].el;
    const writes: number[] = [];
    let time = 4.75;
    Object.defineProperty(el, "currentTime", {
      get: () => time,
      set: (v: number) => {
        time = v;
        writes.push(v);
      },
    });
    Object.defineProperty(el, "paused", { get: () => false });
    mgr.promoteToParentProxy(null, () => {}); // owner parent without the alignment seek

    mgr.mirrorTime(5); // 250 ms behind
    time = 4.85;
    mgr.mirrorTime(5.1); // the lag held: seek, no landing time known yet
    now = 1230;
    el.dispatchEvent(new Event("seeked")); // it took 230 ms to land
    time = 5.0; // landed 230 ms late, lagging the playhead again
    mgr.mirrorTime(5.33);
    time = 5.1;
    mgr.mirrorTime(5.43);

    expect(writes).toHaveLength(2);
    expect(writes[0]).toBeCloseTo(mediaElementTime(5.1), 9);
    expect(writes[1]).toBeCloseTo(mediaElementTime(5.43 + 0.23), 9);
  });
});

describe("proxy crossorigin", () => {
  it.each(["audio", "video"] as const)("a %s proxy carries its source's crossorigin", (tag) => {
    const created: HTMLMediaElement[] = [];
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((t: string) => {
      const el = real(t);
      if (t === "video") created.push(el as HTMLMediaElement);
      return el;
    });
    const OrigAudio = globalThis.Audio;
    globalThis.Audio = function () {
      const el = real("audio");
      created.push(el);
      return el;
    } as unknown as typeof Audio;
    const source = real(tag);
    source.setAttribute("crossorigin", "anonymous");
    const parent = Object.create(ParentMediaManager.prototype) as ParentMediaManager;
    Object.assign(parent, {
      _entries: [],
      _urlTaken: () => false,
      _getMuted: () => false,
      _getVolume: () => 1,
      _getPlaybackRate: () => 1,
    });
    (parent as any)._createEntry("https://x/a.mp3", tag, 0, 5, source);
    const proxy = created.find((e) => e.tagName.toLowerCase() === tag)!;
    globalThis.Audio = OrigAudio;
    vi.restoreAllMocks();
    expect(proxy.getAttribute("crossorigin")).toBe("anonymous");
  });
});
