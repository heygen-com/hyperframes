// fallow-ignore-file code-duplication complexity
import { beforeEach, describe, it, expect, vi } from "vitest";
import { MAX_AUDIO_GAIN } from "../audioGain.js";
import { WebAudioTransport } from "./webAudioTransport";

function createMockAudioContext(currentTime = 100) {
  const startFn = vi.fn();
  const endedListeners: (() => void)[] = [];
  const sourceNode = {
    buffer: null as AudioBuffer | null,
    playbackRate: { value: 1 },
    start: startFn,
    stop: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === "ended") endedListeners.push(cb);
    }),
    _fireEnded: () => endedListeners.forEach((cb) => cb()),
  };
  const gainNode = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const mediaElementSourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const masterGain = {
    gain: { value: 1 },
    connect: vi.fn(),
  };
  const ctx = {
    currentTime,
    state: "running",
    resume: vi.fn(),
    createBufferSource: vi.fn(() => sourceNode),
    createMediaElementSource: vi.fn(() => mediaElementSourceNode),
    createGain: vi.fn(() => gainNode),
    destination: {},
    close: vi.fn(),
  };
  return { ctx, sourceNode, mediaElementSourceNode, gainNode, masterGain, startFn };
}

function setupTransport(currentTime = 100) {
  const transport = new WebAudioTransport();
  const mock = createMockAudioContext(currentTime);
  (transport as unknown as { _ctx: unknown })._ctx = mock.ctx;
  (transport as unknown as { _masterGain: unknown })._masterGain = mock.masterGain;
  const gen = transport.startGeneration();
  return { transport, mock, gen };
}

const mockBuffer = {} as AudioBuffer;
const mockEl = {
  muted: false,
  volume: 0.4,
  getAttribute: (name: string) => (name === "data-playback-rate" ? "1" : null),
} as unknown as HTMLMediaElement;

describe("WebAudioTransport author gain vs user volume", () => {
  it("carries a static above-unity author gain onto the element gain node", () => {
    // The regression this ceiling exists to prevent: a static `data-volume`
    // above unity was capped at 1 here while the render honoured it, so preview
    // and render disagreed on every boosted clip. Automation lanes hid it —
    // they schedule ramps onto the param directly and never pass through here.
    const { transport, mock } = setupTransport();
    const el = { muted: false } as HTMLMediaElement;
    transport["_activeSources"] = [{ el, gainNode: mock.gainNode, sourceKind: "buffer" }] as never;

    transport.setElementVolume(el, 1.949845);

    expect(mock.gainNode.gain.value).toBeCloseTo(1.949845, 6);
  });

  it("still refuses a gain beyond the shared ceiling", () => {
    const { transport, mock } = setupTransport();
    const el = { muted: false } as HTMLMediaElement;
    transport["_activeSources"] = [{ el, gainNode: mock.gainNode, sourceKind: "buffer" }] as never;

    transport.setElementVolume(el, 99);

    expect(mock.gainNode.gain.value).toBeCloseTo(MAX_AUDIO_GAIN, 6);
  });

  it("keeps the user's master volume spec-clamped — it is a fader, not a gain", () => {
    const transport = new WebAudioTransport();
    const master = { gain: { value: 1 }, connect: vi.fn() };
    (transport as unknown as { _masterGain: unknown })._masterGain = master;

    transport.setVolume(99);

    expect(master.gain.value).toBe(1);
  });
});

describe("WebAudioTransport", () => {
  beforeEach(() => {
    mockEl.muted = false;
    mockEl.volume = 0.4;
  });

  describe("pitch-preserving media-element source route", () => {
    it("routes native media through WebAudio without decoding, resampling, or muting it", async () => {
      const { transport, mock, gen } = setupTransport(100);

      const scheduled = await transport.scheduleMediaElementPlayback(mockEl, 0, 0, 0, 0.8, gen, 2);

      expect(scheduled).not.toBeNull();
      expect(mock.ctx.createMediaElementSource).toHaveBeenCalledWith(mockEl);
      expect(mock.ctx.createBufferSource).not.toHaveBeenCalled();
      expect(mock.mediaElementSourceNode.connect).toHaveBeenCalled();
      expect(mock.gainNode.connect).toHaveBeenCalledWith(mock.masterGain);
      expect(mockEl.muted).toBe(false);
      expect(mockEl.volume).toBe(1);
      expect(mock.gainNode.gain.value).toBe(0.8);
      expect(transport.ownsElement(mockEl)).toBe(false);
      expect(transport.routesElement(mockEl)).toBe(true);
      expect(transport.isActive()).toBe(true);
    });

    it("creates one MediaElementAudioSourceNode per element and context", async () => {
      const { transport, mock } = setupTransport(100);

      let gen = transport.startGeneration();
      await transport.scheduleMediaElementPlayback(mockEl, 0, 0, 0, 1, gen, 1);
      transport.stopAll();
      gen = transport.startGeneration();
      await transport.scheduleMediaElementPlayback(mockEl, 0, 0, 0, 1, gen, 2);

      expect(mock.ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
    });

    it("re-aims FX automation on a global-rate change without resampling the native source", async () => {
      const { transport, mock, gen } = setupTransport(100);
      await transport.scheduleMediaElementPlayback(mockEl, 0, 0, 0, 1, gen, 1);
      const active = (transport as unknown as { _activeSources: { fx?: unknown }[] })
        ._activeSources;
      const setRate = vi.fn();
      active[0]!.fx = { dispose: vi.fn(), setRate };

      transport.setRate(2);

      expect(setRate).toHaveBeenCalledWith(2);
      expect(mock.ctx.createBufferSource).not.toHaveBeenCalled();
    });

    it("disconnects the transient graph on stop but keeps the cached native source reusable", async () => {
      const { transport, mock, gen } = setupTransport(100);
      await transport.scheduleMediaElementPlayback(mockEl, 0, 0, 0, 1, gen, 2);

      transport.stopAll();

      expect(mock.mediaElementSourceNode.disconnect).toHaveBeenCalled();
      expect(mockEl.muted).toBe(false);
      expect(mockEl.volume).toBe(0.4);
      expect(transport.isActive()).toBe(false);
    });
  });

  it("tracks play generation for async race prevention", () => {
    const transport = new WebAudioTransport();
    expect(transport.currentGeneration()).toBe(0);
    const gen1 = transport.startGeneration();
    expect(gen1).toBe(1);
    const gen2 = transport.startGeneration();
    expect(gen2).toBe(2);
    expect(transport.currentGeneration()).toBe(2);
  });

  it("getTime returns -1 when paused", () => {
    const transport = new WebAudioTransport();
    expect(transport.getTime()).toBe(-1);
  });

  it("isActive returns false initially", () => {
    const transport = new WebAudioTransport();
    expect(transport.isActive()).toBe(false);
  });

  it("stopAll restores el.muted to prior value", () => {
    const transport = new WebAudioTransport();
    const mockEl = { muted: false } as HTMLMediaElement;
    const mockSource = {
      el: mockEl,
      sourceKind: "buffer" as const,
      sourceNode: { stop: vi.fn(), disconnect: vi.fn() } as unknown as AudioBufferSourceNode,
      gainNode: { disconnect: vi.fn() } as unknown as GainNode,
      compositionStart: 0,
      mediaStart: 0,
      scheduledAt: 0,
      priorMuted: false,
    };
    // Simulate WebAudio taking over: el.muted was set to true
    mockEl.muted = true;
    (transport as unknown as { _activeSources: (typeof mockSource)[] })._activeSources = [
      mockSource,
    ];
    (transport as unknown as { _paused: boolean })._paused = false;

    expect(transport.isActive()).toBe(true);
    transport.stopAll();
    expect(mockEl.muted).toBe(false);
    expect(transport.isActive()).toBe(false);
  });

  it("stopAll restores el.muted=true when element was already muted", () => {
    const transport = new WebAudioTransport();
    const mockEl = { muted: true } as HTMLMediaElement;
    const mockSource = {
      el: mockEl,
      sourceKind: "buffer" as const,
      sourceNode: { stop: vi.fn(), disconnect: vi.fn() } as unknown as AudioBufferSourceNode,
      gainNode: { disconnect: vi.fn() } as unknown as GainNode,
      compositionStart: 0,
      mediaStart: 0,
      scheduledAt: 0,
      priorMuted: true,
    };
    (transport as unknown as { _activeSources: (typeof mockSource)[] })._activeSources = [
      mockSource,
    ];

    transport.stopAll();
    expect(mockEl.muted).toBe(true);
  });

  it("stopAll called multiple times is safe (idempotent)", () => {
    const transport = new WebAudioTransport();
    transport.stopAll();
    transport.stopAll();
    expect(transport.isActive()).toBe(false);
  });

  it("destroy clears buffer cache and nulls context", () => {
    const transport = new WebAudioTransport();
    transport.destroy();
    expect(transport.context).toBeNull();
    expect(transport.isActive()).toBe(false);
  });

  it("restores the configured master volume after user mute then unmute", () => {
    const { transport, mock } = setupTransport();
    transport.setVolume(0.4);
    transport.setMuted(true);
    expect(mock.masterGain.gain.value).toBe(0);

    transport.setMuted(false);

    expect(mock.masterGain.gain.value).toBe(0.4);
  });

  it("applies author and user volume once in separate gain layers", async () => {
    const { transport, mock, gen } = setupTransport();
    await transport.scheduleMediaElementPlayback(mockEl, 0, 0, 0, 0.8, gen, 1);
    transport.setVolume(0.5);

    expect(mock.gainNode.gain.value).toBe(0.8);
    expect(mock.masterGain.gain.value).toBe(0.5);
    expect(mock.gainNode.gain.value * mock.masterGain.gain.value).toBeCloseTo(0.4);
  });

  describe("ownsElement (per-element mute gate)", () => {
    function withSource(el: HTMLMediaElement) {
      const transport = new WebAudioTransport();
      const source = {
        el,
        sourceKind: "buffer" as const,
        sourceNode: { stop: vi.fn(), disconnect: vi.fn() } as unknown as AudioBufferSourceNode,
        gainNode: { disconnect: vi.fn() } as unknown as GainNode,
        compositionStart: 0,
        mediaStart: 0,
        scheduledAt: 0,
        priorMuted: false,
      };
      (transport as unknown as { _activeSources: (typeof source)[] })._activeSources = [source];
      (transport as unknown as { _paused: boolean })._paused = false;
      return transport;
    }

    it("returns true for an element the transport plays", () => {
      const el = {
        muted: false,
        getAttribute: (name: string) => (name === "data-playback-rate" ? "1" : null),
      } as unknown as HTMLMediaElement;
      expect(withSource(el).ownsElement(el)).toBe(true);
    });

    it("returns false for an element the transport does not play", () => {
      const el = {
        muted: false,
        getAttribute: (name: string) => (name === "data-playback-rate" ? "1" : null),
      } as unknown as HTMLMediaElement;
      const other = { muted: false } as HTMLMediaElement;
      expect(withSource(el).ownsElement(other)).toBe(false);
    });

    it("returns false after stopAll releases the element", () => {
      const el = { muted: false } as HTMLMediaElement;
      const transport = withSource(el);
      transport.stopAll();
      expect(transport.ownsElement(el)).toBe(false);
    });
  });

  describe("schedulePlayback timing", () => {
    it("starts in-progress clips immediately with correct buffer offset", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen);

      expect(mock.startFn).toHaveBeenCalledWith(0, 3);
    });

    it("starts in-progress clips with mediaStart offset", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 2, 8, 1, gen);

      expect(mock.startFn).toHaveBeenCalledWith(0, 5);
    });

    it("schedules future clips with delay instead of playing immediately", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 10, 0, 2, 1, gen);

      expect(mock.startFn).toHaveBeenCalledWith(108, 0);
    });

    it("schedules future clips with correct mediaStart", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 10, 1.5, 2, 1, gen);

      expect(mock.startFn).toHaveBeenCalledWith(108, 1.5);
    });

    it("starts clips at exact composition start time immediately", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 5, 1, gen);

      expect(mock.startFn).toHaveBeenCalledWith(0, 0);
    });
  });

  describe("clip duration bound (trim)", () => {
    it("bounds an in-progress clip to its remaining authored window", async () => {
      const { transport, mock, gen } = setupTransport(100);
      // compStart=5, mediaStart=0, compTime=8 → elapsed=3; clipDuration=10 → 7 left
      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 1, 10);
      expect(mock.startFn).toHaveBeenCalledWith(0, 3, 7);
    });

    it("bounds a future clip to its full authored window", async () => {
      const { transport, mock, gen } = setupTransport(100);
      // compStart=10, mediaStart=1.5, compTime=2 → elapsed=-8 → delay 8; clipDuration=4
      await transport.schedulePlayback(mockEl, mockBuffer, 10, 1.5, 2, 1, gen, 1, 4);
      expect(mock.startFn).toHaveBeenCalledWith(108, 1.5, 4);
    });

    it("does not schedule a clip whose window has already elapsed", async () => {
      const { transport, mock, gen } = setupTransport(100);
      // elapsed=15 > clipDuration=10 → nothing to play
      const result = await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 20, 1, gen, 1, 10);
      expect(result).toBeNull();
      expect(mock.startFn).not.toHaveBeenCalled();
    });

    it("keeps source bounds in authored media time when global rate changes", async () => {
      const { transport, mock, gen } = setupTransport(100);
      // Global rate=2 changes wallclock speed, not source-time span.
      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 2, 10);
      expect(mock.startFn).toHaveBeenCalledWith(0, 3, 7);
    });

    it("plays unbounded when clipDuration is omitted (legacy behavior)", async () => {
      const { transport, mock, gen } = setupTransport(100);
      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen);
      expect(mock.startFn).toHaveBeenCalledWith(0, 3);
    });
  });

  describe("playback rate", () => {
    it("combines authored media rate with global rate without corrupting source seek or clock", async () => {
      const { transport, mock, gen } = setupTransport(100);
      const el = {
        muted: false,
        getAttribute: (name: string) => (name === "data-playback-rate" ? "2" : null),
      } as unknown as HTMLMediaElement;

      // At composition t=0.5 with mediaStart=1, authored 2x has consumed one
      // source second. Global 0.5x makes the source node's wallclock rate 1x,
      // but the composition clock must still advance at global 0.5x.
      await transport.schedulePlayback(el, mockBuffer, 0, 1, 0.5, 1, gen, 0.5, 2);

      expect(mock.sourceNode.playbackRate.value).toBe(1);
      expect(mock.startFn).toHaveBeenCalledWith(0, 2, 3);
      mock.ctx.currentTime = 101;
      expect(transport.getTime()).toBe(1);

      transport.setRate(1);
      expect(mock.sourceNode.playbackRate.value).toBe(2);
    });

    it("sets sourceNode.playbackRate.value when rate is provided", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 2);

      expect(mock.sourceNode.playbackRate.value).toBe(2);
    });

    it("defaults rate to 1 when not provided", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen);

      expect(mock.sourceNode.playbackRate.value).toBe(1);
    });

    it("scales delay by rate for future clips so they fire at the right wallclock", async () => {
      const { transport, mock, gen } = setupTransport(100);

      // compStart=10, compositionTime=2, rate=2 → 8s of comp time = 4s wallclock
      await transport.schedulePlayback(mockEl, mockBuffer, 10, 0, 2, 1, gen, 2);

      expect(mock.startFn).toHaveBeenCalledWith(104, 0);
    });

    it("keeps in-progress buffer offset at elapsed + mediaStart regardless of rate", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 2);

      expect(mock.startFn).toHaveBeenCalledWith(0, 3);
    });

    it("setRate updates active sources in place", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 1);
      expect(mock.sourceNode.playbackRate.value).toBe(1);

      transport.setRate(2);

      expect(mock.sourceNode.playbackRate.value).toBe(2);
    });

    it("setRate re-aims each source's FX automation, not just its playback rate", async () => {
      // The lanes are committed to absolute context times when the source is
      // scheduled, so bumping playbackRate alone left every automated parameter
      // running its original plan over audio moving at a different speed.
      const { transport, mock, gen } = setupTransport(100);
      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 1);
      const active = (transport as unknown as { _activeSources: { fx?: unknown }[] })
        ._activeSources;
      const setRate = vi.fn();
      active[0]!.fx = { dispose: vi.fn(), setRate };

      transport.setRate(2);

      expect(setRate).toHaveBeenCalledWith(2);
      expect(mock.sourceNode.playbackRate.value).toBe(2);
    });

    it("setRate before any sources are scheduled does not throw", () => {
      const transport = new WebAudioTransport();
      expect(() => transport.setRate(2)).not.toThrow();
    });

    it("setRate is a no-op when the rate is unchanged", async () => {
      const { transport, mock, gen } = setupTransport(100);
      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 2);

      mock.ctx.currentTime = 100.5;
      const timeBefore = transport.getTime();
      transport.setRate(2);
      const timeAfter = transport.getTime();

      expect(timeAfter).toBe(timeBefore);
      // No re-anchor, so the next 0.5s of wallclock still maps to 1s of comp time.
      mock.ctx.currentTime = 101;
      expect(transport.getTime()).toBeCloseTo(10, 10);
    });

    it("setRate clamps non-finite or non-positive values to 1", async () => {
      const { transport, mock, gen } = setupTransport(100);
      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 2);
      expect(mock.sourceNode.playbackRate.value).toBe(2);

      transport.setRate(Number.NaN);
      expect(mock.sourceNode.playbackRate.value).toBe(1);

      transport.setRate(2);
      transport.setRate(0);
      expect(mock.sourceNode.playbackRate.value).toBe(1);

      transport.setRate(2);
      transport.setRate(-1);
      expect(mock.sourceNode.playbackRate.value).toBe(1);
    });

    it("getTime advances at the configured rate", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 2);

      // At schedule time, ctx.currentTime=100, compositionTime=8.
      expect(transport.getTime()).toBeCloseTo(8, 10);

      // Advance the audio-context clock by 0.5 wallclock seconds; at rate=2,
      // composition time should have advanced 1s.
      mock.ctx.currentTime = 100.5;
      expect(transport.getTime()).toBeCloseTo(9, 10);
    });

    it("getTime tracks composition time after a mid-playback setRate", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 5, 0, 8, 1, gen, 1);
      expect(transport.getTime()).toBeCloseTo(8, 10);

      // 0.5s passes at rate=1 → composition time = 8.5
      mock.ctx.currentTime = 100.5;
      expect(transport.getTime()).toBeCloseTo(8.5, 10);

      // Bump rate to 2 — composition time should NOT jump.
      transport.setRate(2);
      expect(transport.getTime()).toBeCloseTo(8.5, 10);

      // Another 0.5s wallclock at rate=2 → composition time = 9.5
      mock.ctx.currentTime = 101;
      expect(transport.getTime()).toBeCloseTo(9.5, 10);
    });
  });

  describe("onended cleanup (audio dropout fix)", () => {
    it("cleans up _activeSources when AudioBufferSourceNode ends naturally", async () => {
      const { transport, mock, gen } = setupTransport(100);
      const el = {
        muted: false,
        getAttribute: (name: string) => (name === "data-playback-rate" ? "1" : null),
      } as unknown as HTMLMediaElement;

      await transport.schedulePlayback(el, mockBuffer, 0, 0, 0, 1, gen);
      expect(transport.isActive()).toBe(true);
      expect(el.muted).toBe(true);

      mock.sourceNode._fireEnded();

      expect(transport.isActive()).toBe(false);
      expect(el.muted).toBe(false);
    });

    it("restores priorMuted=true when element was already muted", async () => {
      const { transport, mock, gen } = setupTransport(100);
      const el = {
        muted: true,
        getAttribute: (name: string) => (name === "data-playback-rate" ? "1" : null),
      } as unknown as HTMLMediaElement;

      await transport.schedulePlayback(el, mockBuffer, 0, 0, 0, 1, gen);
      expect(el.muted).toBe(true);

      mock.sourceNode._fireEnded();

      expect(el.muted).toBe(true);
      expect(transport.isActive()).toBe(false);
    });

    it("disposes the FX graph when a clip ends naturally", async () => {
      // stopAll() disposes by walking _activeSources, and the splice above had
      // already removed this entry — so the handle, its MutationObserver and any
      // running LFO survived the clip for the rest of the session.
      const { transport, mock, gen } = setupTransport(100);
      await transport.schedulePlayback(mockEl, mockBuffer, 0, 0, 0, 1, gen);

      mock.sourceNode._fireEnded();

      expect(mock.sourceNode.disconnect).toHaveBeenCalled();
      expect(mock.gainNode.disconnect).toHaveBeenCalled();
    });

    it("registers onended listener on the sourceNode", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 0, 0, 0, 1, gen);

      expect(mock.sourceNode.addEventListener).toHaveBeenCalledWith("ended", expect.any(Function));
    });

    it("onended after stopAll is a no-op — does not clobber restored state", async () => {
      const { transport, mock, gen } = setupTransport(100);
      const el = {
        muted: false,
        getAttribute: (name: string) => (name === "data-playback-rate" ? "1" : null),
      } as unknown as HTMLMediaElement;

      await transport.schedulePlayback(el, mockBuffer, 0, 0, 0, 1, gen);
      expect(el.muted).toBe(true);

      transport.stopAll();
      expect(el.muted).toBe(false);
      expect(transport.isActive()).toBe(false);

      el.muted = true;

      mock.sourceNode._fireEnded();

      expect(el.muted).toBe(true);
      expect(transport.isActive()).toBe(false);
    });
  });

  describe("decodeAudioElement retry policy (late-asset self-heal)", () => {
    function transportWithDecode(decodeImpl: () => Promise<AudioBuffer>) {
      const transport = new WebAudioTransport();
      const ctx = { state: "running", decodeAudioData: vi.fn(decodeImpl) };
      (transport as unknown as { _ctx: unknown })._ctx = ctx;
      return transport;
    }
    const el = (src: string) =>
      ({
        getAttribute: (name: string) => (name === "src" ? src : null),
        currentSrc: "",
      }) as unknown as HTMLMediaElement;
    const failedSrcs = (t: WebAudioTransport) =>
      (t as unknown as { _failedSrcs: Set<string> })._failedSrcs;

    it("does NOT blacklist a transient fetch failure — a later play retries and succeeds", async () => {
      const transport = transportWithDecode(async () => ({}) as AudioBuffer);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 }) // asset not uploaded yet
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      vi.stubGlobal("fetch", fetchMock);

      const first = await transport.decodeAudioElement(el("tts.wav"));
      expect(first).toBeNull();
      expect(failedSrcs(transport).has("tts.wav")).toBe(false); // not permanently silenced

      const second = await transport.decodeAudioElement(el("tts.wav"));
      expect(second).not.toBeNull(); // self-heals once the asset is available
      expect(fetchMock).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    });

    it("DOES blacklist genuinely undecodable bytes — not retried", async () => {
      const transport = transportWithDecode(async () => {
        throw new Error("unsupported codec");
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      vi.stubGlobal("fetch", fetchMock);

      const first = await transport.decodeAudioElement(el("corrupt.wav"));
      expect(first).toBeNull();
      expect(failedSrcs(transport).has("corrupt.wav")).toBe(true); // bad data is permanent

      const second = await transport.decodeAudioElement(el("corrupt.wav"));
      expect(second).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1); // short-circuited, no re-fetch
      vi.unstubAllGlobals();
    });
  });
});
