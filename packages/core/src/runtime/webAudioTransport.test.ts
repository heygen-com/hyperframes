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
  // Every createGain call returns a distinct node. Sharing one hides graph
  // errors because the solo stage can overwrite the authored-volume stage.
  const gainNodes: Array<{
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const makeGain = () => {
    const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    gainNodes.push(node);
    return node;
  };
  const gainNode = makeGain();
  let served = 0;
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
    createGain: vi.fn(() => (served++ === 0 ? gainNode : makeGain())),
    destination: {},
    close: vi.fn(),
  };
  return { ctx, sourceNode, mediaElementSourceNode, gainNode, gainNodes, masterGain, startFn };
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
      const [volumeGain, soloGain] = mock.gainNodes;
      expect(volumeGain?.connect).toHaveBeenCalledWith(soloGain);
      expect(soloGain?.connect).toHaveBeenCalledWith(mock.masterGain);
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
    it("keeps author boost above unity on the per-element gain node", async () => {
      const { transport, mock, gen } = setupTransport(100);

      await transport.schedulePlayback(mockEl, mockBuffer, 0, 0, 0, 1, gen);
      transport.setElementVolume(mockEl, 3.98);

      expect(mock.gainNode.gain.value).toBeCloseTo(3.98, 5);
    });

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

  describe("group routing (preview)", () => {
    // Real jsdom elements — `groupInput` looks the group up via
    // `el.ownerDocument.getElementById`, and `audioGroupOf` reads `tagName` /
    // `getAttribute`, neither of which the plain-object mocks above implement.
    function createGroupMockAudioContext(currentTime = 100) {
      const gainNodes: {
        gain: { value: number };
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
      }[] = [];
      const analysers: {
        fftSize: number;
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        getFloatTimeDomainData: ReturnType<typeof vi.fn>;
      }[] = [];
      const masterGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      const mediaElementSource = { connect: vi.fn(), disconnect: vi.fn() };
      const ctx = {
        currentTime,
        state: "running",
        resume: vi.fn(),
        createBufferSource: vi.fn(() => ({
          buffer: null as AudioBuffer | null,
          playbackRate: { value: 1 },
          start: vi.fn(),
          stop: vi.fn(),
          disconnect: vi.fn(),
          connect: vi.fn(),
          addEventListener: vi.fn(),
        })),
        createGain: vi.fn(() => {
          // The AudioParam scheduling surface is part of the contract the group
          // bus uses (`clearParamLane` cancels before re-seeding a reused bus).
          // A bare `{ value }` made any such call throw, and `schedulePlayback`
          // swallows throws into `return null` — so the mock's own gap read as
          // "the member did not play" rather than as a missing stub.
          const node = {
            gain: {
              value: 1,
              cancelScheduledValues: vi.fn(),
              cancelAndHoldAtTime: vi.fn(),
              setValueAtTime: vi.fn(),
              linearRampToValueAtTime: vi.fn(),
              exponentialRampToValueAtTime: vi.fn(),
              setValueCurveAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
          gainNodes.push(node);
          return node;
        }),
        createAnalyser: vi.fn(() => {
          const node = {
            fftSize: 2048,
            connect: vi.fn(),
            disconnect: vi.fn(),
            getFloatTimeDomainData: vi.fn(),
          };
          analysers.push(node);
          return node;
        }),
        // The media-element route needs this as much as the decoded one: without
        // it `scheduleMediaElementPlayback` throws and its catch returns null,
        // which reads as "the member did not play" rather than a missing stub.
        createMediaElementSource: vi.fn(() => mediaElementSource),
        destination: {},
        close: vi.fn(),
      };
      return { ctx, gainNodes, analysers, masterGain, mediaElementSource };
    }

    function setupGroupTransport(currentTime = 100) {
      const transport = new WebAudioTransport();
      const mock = createGroupMockAudioContext(currentTime);
      (transport as unknown as { _ctx: unknown })._ctx = mock.ctx;
      (transport as unknown as { _masterGain: unknown })._masterGain = mock.masterGain;
      const gen = transport.startGeneration();
      return { transport, mock, gen };
    }

    function groupedAudioEl(id: string, groupId?: string): HTMLMediaElement {
      const el = document.createElement("audio");
      el.id = id;
      if (groupId) el.setAttribute("data-audio-group", groupId);
      document.body.appendChild(el);
      return el as unknown as HTMLMediaElement;
    }

    /** Create a grouped member and schedule it in one step — the shape every
     *  test below needs, differing only in id/group/generation. */
    async function scheduleGrouped(
      transport: WebAudioTransport,
      gen: number,
      id: string,
      groupId?: string,
    ): Promise<HTMLMediaElement> {
      const el = groupedAudioEl(id, groupId);
      await transport.schedulePlayback(el, mockBuffer, 0, 0, 0, 1, gen);
      return el;
    }

    /** The group's own input gain is built lazily on the first member — index
     *  1 in creation order (that member's own gain is 0). */
    const firstGroupInput = (mock: ReturnType<typeof createGroupMockAudioContext>) =>
      mock.gainNodes[1]!;

    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("routes an ungrouped clip to master through its own solo stage", async () => {
      const { transport, mock, gen } = setupGroupTransport();

      await scheduleGrouped(transport, gen, "lone");

      expect(mock.gainNodes).toHaveLength(2);
      const [clipGain, soloGain] = mock.gainNodes;
      expect(clipGain!.connect).toHaveBeenCalledWith(soloGain);
      expect(soloGain!.connect).toHaveBeenCalledWith(mock.masterGain);
    });

    // The media-element transport is the PRIMARY path for audio — the runtime
    // tries it first and only falls back to a decoded buffer. It has to reach
    // the same bus, or grouping silently applies to nothing that actually plays.
    // The render clamps a track volume with `clampAudioGain` (ceiling ~3.98),
    // so an over-unity bus previewed at 1.0 exported up to 12 dB louder than
    // it auditioned.
    it("previews an over-unity bus fader at the render's ceiling, not unity", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      document.body.innerHTML = `<hf-audio-group id="vo" data-volume="10"></hf-audio-group>`;
      await scheduleGrouped(transport, gen, "a", "vo");

      // Creation order: a-gain(0), groupInput(1), groupOutput(2), muteGain(3), fader(4).
      expect(mock.gainNodes[4]!.gain.value).toBeCloseTo(3.9811, 3);
    });

    it("still floors a negative bus fader at zero", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      document.body.innerHTML = `<hf-audio-group id="vo" data-volume="-1"></hf-audio-group>`;
      await scheduleGrouped(transport, gen, "a", "vo");

      expect(mock.gainNodes[4]!.gain.value).toBe(0);
    });

    // A bare getElementById read a member's own fader and chain as the bus's.
    it("ignores a non-<hf-audio-group> element sharing the group id", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      document.body.innerHTML = `<div id="vo" data-volume="0.25" data-hidden></div>`;
      await scheduleGrouped(transport, gen, "a", "vo");

      // Flat bus: unity fader, unmuted — the documented "group with no element"
      // degradation, not the stranger's settings.
      expect(mock.gainNodes[4]!.gain.value).toBe(1);
      expect(mock.gainNodes[3]!.gain.value).toBe(1);
    });

    it("routes a grouped clip's MEDIA-ELEMENT playback to the group bus, not master", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      const el = groupedAudioEl("vo-1", "vo");

      await transport.scheduleMediaElementPlayback(el, 0, 0, 0, 1, gen, 1);

      const clipGain = mock.gainNodes[0]!;
      const soloGain = mock.gainNodes[5]!;
      expect(clipGain.connect).toHaveBeenCalledWith(soloGain);
      expect(soloGain.connect).toHaveBeenCalledWith(firstGroupInput(mock));
      expect(clipGain.connect).not.toHaveBeenCalledWith(mock.masterGain);
    });

    it("routes an UNGROUPED clip's media-element playback straight to master", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      const el = groupedAudioEl("lone");

      await transport.scheduleMediaElementPlayback(el, 0, 0, 0, 1, gen, 1);

      expect(mock.gainNodes).toHaveLength(2);
      expect(mock.gainNodes[0]!.connect).toHaveBeenCalledWith(mock.gainNodes[1]);
      expect(mock.gainNodes[1]!.connect).toHaveBeenCalledWith(mock.masterGain);
    });

    it("two members of the same group land on ONE shared group gain, not master directly", async () => {
      const { transport, mock, gen } = setupGroupTransport();

      await scheduleGrouped(transport, gen, "a", "vo");
      await scheduleGrouped(transport, gen, "b", "vo");

      // Creation order for a: gain(0), group bus(1–4), solo(5). Then b uses
      // gain(6), solo(7); both solo stages feed the one shared group input.
      expect(mock.gainNodes.length).toBeGreaterThanOrEqual(8);
      const aGain = mock.gainNodes[0]!;
      const aSolo = mock.gainNodes[5]!;
      const groupInput = firstGroupInput(mock);
      const groupOutput = mock.gainNodes[2]!;
      const muteGain = mock.gainNodes[3]!;
      const fader = mock.gainNodes[4]!;
      const bGain = mock.gainNodes[6]!;
      const bSolo = mock.gainNodes[7]!;

      // Both members feed their own solo stage, then the shared bus.
      expect(aGain.connect).toHaveBeenCalledWith(aSolo);
      expect(bGain.connect).toHaveBeenCalledWith(bSolo);
      expect(aSolo.connect).toHaveBeenCalledWith(groupInput);
      expect(bSolo.connect).toHaveBeenCalledWith(groupInput);
      expect(aGain.connect).not.toHaveBeenCalledWith(mock.masterGain);
      expect(bGain.connect).not.toHaveBeenCalledWith(mock.masterGain);

      // The bus's input never reaches master directly. It runs through the
      // chain (dry here — neither member's group has a chain-bearing
      // `<hf-audio-group>`) onto the FADER, then the mute gain (B5), then the
      // output gain, then master. The fader sits POST-FX because that is where
      // the render bakes group volume in.
      expect(groupInput.connect).not.toHaveBeenCalledWith(mock.masterGain);
      expect(groupInput.connect).toHaveBeenCalledWith(fader);
      expect(fader.connect).toHaveBeenCalledWith(muteGain);
      expect(muteGain.connect).toHaveBeenCalledWith(groupOutput);
      expect(groupOutput.connect).toHaveBeenCalledWith(mock.masterGain);
    });

    it("a second member of an already-open group does not rebuild the group bus", async () => {
      const { transport, mock, gen } = setupGroupTransport();

      await scheduleGrouped(transport, gen, "a", "vo");
      const gainCountAfterFirst = mock.gainNodes.length;
      await scheduleGrouped(transport, gen, "b", "vo");

      // Only b's volume and solo gains are new — no second group bus minted.
      expect(mock.gainNodes.length).toBe(gainCountAfterFirst + 2);
    });

    it("a group id with no matching <hf-audio-group> element still gets a flat bus", async () => {
      const { transport, mock, gen } = setupGroupTransport();

      await scheduleGrouped(transport, gen, "a", "orphan-group"); // no matching element

      const muteGain = mock.gainNodes[3]!;
      const groupOutput = mock.gainNodes[2]!;
      const fader = mock.gainNodes[4]!;
      expect(firstGroupInput(mock).connect).toHaveBeenCalledWith(fader);
      expect(fader.connect).toHaveBeenCalledWith(muteGain);
      expect(muteGain.connect).toHaveBeenCalledWith(groupOutput);
      expect(groupOutput.connect).toHaveBeenCalledWith(mock.masterGain);
      // No element to read, so the fader sits at unity.
      expect(fader.gain.value).toBe(1);
    });

    // The old assertion here was `resolves.not.toBeNull()` — it was named for
    // group volume and checked only that scheduling did not throw, so the bus
    // sitting at unity while the render applied data-volume went unseen. The
    // export was ~8 dB quieter than what had been auditioned.
    it("puts the group's own data-volume on the bus fader", async () => {
      document.body.innerHTML = `<hf-audio-group id="vo" data-label="Voiceover" data-volume="0.4"></hf-audio-group>`;
      const { transport, mock, gen } = setupGroupTransport();

      await expect(scheduleGrouped(transport, gen, "a", "vo")).resolves.not.toBeNull();

      expect(mock.gainNodes[4]!.gain.value).toBeCloseTo(0.4, 6);
    });

    it("leaves the fader at unity when the group carries no data-volume", async () => {
      document.body.innerHTML = `<hf-audio-group id="vo" data-label="Voiceover"></hf-audio-group>`;
      const { transport, mock, gen } = setupGroupTransport();

      // No throw wiring the group's automation reader against a real
      // <hf-audio-group> element that carries no fx/automation attrs.
      await expect(scheduleGrouped(transport, gen, "a", "vo")).resolves.not.toBeNull();
      expect(mock.gainNodes[4]!.gain.value).toBe(1);
    });

    it("destroy() disposes every group bus", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      await scheduleGrouped(transport, gen, "a", "vo");
      const groupInput = firstGroupInput(mock);

      transport.destroy();

      expect(groupInput.disconnect).toHaveBeenCalled();
    });

    it("stopAll() does NOT dispose group buses — replaying the group does not rebuild it", async () => {
      const { transport, mock, gen } = setupGroupTransport();
      await scheduleGrouped(transport, gen, "a", "vo");
      const groupInput = firstGroupInput(mock);

      transport.stopAll();
      expect(groupInput.disconnect).not.toHaveBeenCalled();

      const gen2 = transport.startGeneration();
      await scheduleGrouped(transport, gen2, "a", "vo");
      // Still only one group-input gain ever created for "vo".
      expect(mock.gainNodes.filter((n) => n === groupInput)).toHaveLength(1);
    });

    describe('solo — "Hear only this" compatibility bridge', () => {
      it("silences non-soloed members without attenuating their shared group bus", async () => {
        const { transport, mock, gen } = setupGroupTransport();
        await scheduleGrouped(transport, gen, "a", "vo");
        await scheduleGrouped(transport, gen, "b", "vo");

        transport.setSolo(new Set(["a"]));

        expect(mock.gainNodes[5]!.gain.value).toBe(1);
        expect(mock.gainNodes[7]!.gain.value).toBe(0);
        expect(firstGroupInput(mock).gain.value).toBe(1);
      });

      it("soloing a group keeps every member of that group audible", async () => {
        const { transport, mock, gen } = setupGroupTransport();
        await scheduleGrouped(transport, gen, "a", "vo");
        await scheduleGrouped(transport, gen, "b", "vo");

        transport.setSolo(new Set(["vo"]));

        expect(mock.gainNodes[5]!.gain.value).toBe(1);
        expect(mock.gainNodes[7]!.gain.value).toBe(1);
      });

      it("applies an existing solo to newly scheduled clips and restores them when cleared", async () => {
        const { transport, mock, gen } = setupGroupTransport();
        transport.setSolo(new Set(["a"]));
        await scheduleGrouped(transport, gen, "a");
        await scheduleGrouped(transport, gen, "b");

        expect(mock.gainNodes[1]!.gain.value).toBe(1);
        expect(mock.gainNodes[3]!.gain.value).toBe(0);

        transport.setSolo(new Set());
        expect(mock.gainNodes[1]!.gain.value).toBe(1);
        expect(mock.gainNodes[3]!.gain.value).toBe(1);
      });
    });

    // Surviving stopAll() is the point of the bus — and the trap. Its envelopes
    // were booked against the FIRST pass's absolute context times, so a replay
    // or a seek left the fader holding that pass's last value: 0 after a
    // fade-out, i.e. silent for the rest of the session.
    it("re-anchors the reused bus once per play generation, and only once", async () => {
      document.body.innerHTML = `<hf-audio-group id="vo" data-volume="0.5"></hf-audio-group>`;
      const { transport, mock, gen } = setupGroupTransport();
      await scheduleGrouped(transport, gen, "a", "vo");
      const fader = mock.gainNodes[4]!;

      // Something moved the fader mid-pass (a ramp reaching its last point).
      fader.gain.value = 0;
      transport.stopAll();

      const gen2 = transport.startGeneration();
      await scheduleGrouped(transport, gen2, "a", "vo");
      expect(fader.gain.value).toBeCloseTo(0.5, 6);

      // A second member in the SAME pass must not re-book on top of the first.
      fader.gain.value = 0;
      await scheduleGrouped(transport, gen2, "b", "vo");
      expect(fader.gain.value).toBe(0);
    });

    // reanchor runs inside schedulePlayback, whose catch turns any throw into
    // `return null` — so a bus that fails to re-anchor would silently take the
    // MEMBER out of the pass, and a generation stamped before the attempt would
    // stop every later member retrying.
    it("keeps the member playing when re-anchoring the bus throws", async () => {
      document.body.innerHTML = `<hf-audio-group id="vo" data-volume="0.5"></hf-audio-group>`;
      const { transport, mock, gen } = setupGroupTransport();
      await scheduleGrouped(transport, gen, "a", "vo");
      const fader = mock.gainNodes[4]!;
      fader.gain.cancelScheduledValues = vi.fn(() => {
        throw new Error("param is not schedulable");
      });

      transport.stopAll();
      const gen2 = transport.startGeneration();

      await expect(scheduleGrouped(transport, gen2, "a", "vo")).resolves.not.toBeNull();
      // Generation not consumed by the failed attempt, so a sibling still tries.
      fader.gain.cancelScheduledValues = vi.fn();
      await scheduleGrouped(transport, gen2, "b", "vo");
      expect(fader.gain.value).toBeCloseTo(0.5, 6);
    });

    describe("group mute (B5)", () => {
      it("a group created with data-hidden already set starts muted (mute gain at 0)", async () => {
        document.body.innerHTML = `<hf-audio-group id="vo" data-hidden></hf-audio-group>`;
        const { transport, mock, gen } = setupGroupTransport();

        await scheduleGrouped(transport, gen, "a", "vo");

        const muteGain = mock.gainNodes[3]!;
        expect(muteGain.gain.value).toBe(0);
      });

      it("setGroupMuted toggles the mute gain on an active group bus", async () => {
        const { transport, mock, gen } = setupGroupTransport();
        await scheduleGrouped(transport, gen, "a", "vo");
        const muteGain = mock.gainNodes[3]!;
        expect(muteGain.gain.value).toBe(1);

        transport.setGroupMuted("vo", true);
        expect(muteGain.gain.value).toBe(0);

        transport.setGroupMuted("vo", false);
        expect(muteGain.gain.value).toBe(1);
      });

      it("setGroupMuted on a group with no active member is a no-op, not a throw", () => {
        const { transport } = setupGroupTransport();
        expect(() => transport.setGroupMuted("never-played", true)).not.toThrow();
      });
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
