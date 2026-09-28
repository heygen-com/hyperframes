import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAudioTransport } from "./webAudioTransport";

function makeNode() {
  return {
    gain: { value: 1 },
    connect(dest: unknown) {
      return dest;
    },
    disconnect() {},
  };
}

let resumeGate: Promise<void> | null = null;
let suspendGate: Promise<void> | null = null;
let suspendFails = false;
let startsLate = false;
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = startsLate ? "suspended" : "running";
  currentTime = 0;
  destination = makeNode();
  onstatechange: (() => void) | null = null;
  // Chrome fires "statechange" after construction and on every transition.
  constructor() {
    contexts.push(this);
    queueMicrotask(() => {
      this.state = "running";
      this.onstatechange?.();
    });
  }
  createGain() {
    return makeNode();
  }
  createMediaElementSource() {
    return makeNode();
  }
  createBufferSource() {
    return {
      ...makeNode(),
      buffer: null,
      playbackRate: { value: 1 },
      start() {},
      stop() {},
      addEventListener() {},
    };
  }
  suspends = 0;
  // Chrome applies suspend() and resume() in call order.
  private queue: Promise<void> = Promise.resolve();
  private enqueue(gate: Promise<void> | null, next: "running" | "suspended") {
    this.queue = this.queue
      .then(() => gate)
      .then(() => {
        this.state = next;
        this.onstatechange?.();
      });
    return this.queue;
  }
  suspend() {
    this.suspends += 1;
    if (suspendFails) return Promise.reject(new Error("closed"));
    return this.enqueue(suspendGate, "suspended");
  }
  resume() {
    return this.enqueue(resumeGate, "running");
  }
  close() {
    return Promise.resolve();
  }
}

const idle = () => vi.advanceTimersByTimeAsync(20000);
const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;

async function startTransport() {
  const transport = new WebAudioTransport();
  await transport.init();
  await idle();
  return { transport, ctx: contexts[contexts.length - 1]! };
}

function makeTrack(): HTMLAudioElement {
  const el = document.createElement("audio");
  el.src = "/track.mp3";
  document.body.append(el);
  return el;
}

function setTrackPlaying(el: HTMLAudioElement, playing: boolean) {
  Object.defineProperty(el, "paused", { configurable: true, get: () => !playing });
  el.dispatchEvent(new Event(playing ? "play" : "pause"));
}

const play = (transport: WebAudioTransport, el: HTMLMediaElement) =>
  transport.scheduleMediaElementPlayback(el, 0, 0, 0, 1, transport.startGeneration());

describe("WebAudioTransport keeps its context suspended while nothing sounds", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
    resumeGate = null;
    suspendGate = null;
    suspendFails = false;
    startsLate = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
    document.body.innerHTML = "";
  });

  it("suspends a freshly opened context while the transport is paused", async () => {
    const { ctx } = await startTransport();
    expect(ctx.state).toBe("suspended");
  });

  it("suspends a context the browser starts only after construction", async () => {
    startsLate = true;
    const { ctx } = await startTransport();
    expect(ctx.state).toBe("suspended");
  });

  it("resumes for Play and suspends again on Pause", async () => {
    const { transport, ctx } = await startTransport();
    expect(await play(transport, makeTrack())).not.toBeNull();
    expect(ctx.state).toBe("running");
    transport.stopAll();
    await idle();
    expect(ctx.state).toBe("suspended");
  });

  it("resumes for a Play that lands while the Pause's suspend is still pending", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    let release!: () => void;
    suspendGate = new Promise((resolve) => (release = resolve));
    transport.stopAll();
    await idle();
    const pending = play(transport, el);
    release();
    expect(await pending).not.toBeNull();
    await idle();
    expect(ctx.state).toBe("running");
  });

  it("never suspends for a stop-and-reschedule inside one play", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    const suspendsBefore = ctx.suspends;
    transport.stopAll();
    await play(transport, el);
    await idle();
    expect(ctx.suspends).toBe(suspendsBefore);
    expect(ctx.state).toBe("running");
  });

  it("goes back to sleep when Pause lands while Play waits on resume", async () => {
    const { transport, ctx } = await startTransport();
    let release!: () => void;
    resumeGate = new Promise((resolve) => (release = resolve));
    const pending = play(transport, makeTrack());
    transport.stopAll();
    await idle();
    release();
    expect(await pending).toBeNull();
    await idle();
    expect(ctx.state).toBe("suspended");
  });

  it("ends up running when a track pauses while Play waits on a slow resume()", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    transport.stopAll();
    await idle();
    let release!: () => void;
    resumeGate = new Promise((resolve) => (release = resolve));
    const pending = play(transport, el);
    setTrackPlaying(el, false);
    await idle();
    release();
    expect(await pending).not.toBeNull();
    await idle();
    expect(ctx.state).toBe("running");
  });

  it("stays running while a captured track sounds on the paused idle route", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    transport.stopAll();
    await idle();
    setTrackPlaying(el, true);
    await idle();
    expect(ctx.state).toBe("running");
    transport.stopAll();
    await idle();
    expect(ctx.state).toBe("running");
    setTrackPlaying(el, false);
    await idle();
    expect(ctx.state).toBe("suspended");
  });
  it("waits the full idle delay before suspending", async () => {
    const { transport, ctx } = await startTransport();
    await play(transport, makeTrack());
    const suspendsBefore = ctx.suspends;
    transport.stopAll();
    await vi.advanceTimersByTimeAsync(9999);
    expect(ctx.suspends).toBe(suspendsBefore);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.suspends).toBe(suspendsBefore + 1);
  });

  it("drops its idle timer when the browser suspends the context itself", async () => {
    const { transport, ctx } = await startTransport();
    await play(transport, makeTrack());
    transport.stopAll();
    await vi.advanceTimersByTimeAsync(2000);
    // An interruption outside the transport (an OS or WebKit audio session) suspends the context.
    ctx.state = "suspended";
    ctx.onstatechange?.();
    let release!: () => void;
    resumeGate = new Promise((resolve) => (release = resolve));
    const playing = play(transport, makeTrack());
    await vi.advanceTimersByTimeAsync(9000);
    release();
    await playing;
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.state).toBe("running");
  });

  it("anchors a decoded Play to the time read after the wake", async () => {
    const { transport } = await startTransport();
    let now = 10;
    let release!: () => void;
    resumeGate = new Promise((resolve) => (release = resolve));
    const gen = transport.startGeneration();
    const pending = transport.schedulePlayback(
      makeTrack(),
      {} as AudioBuffer,
      0,
      0,
      () => now,
      1,
      gen,
    );
    now = 10.25;
    release();
    expect(await pending).not.toBeNull();
    expect(transport.getTime()).toBeCloseTo(10.25, 6);
  });

  it("keeps no reference to a captured track once it stops playing", async () => {
    const { transport } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    transport.stopAll();
    setTrackPlaying(el, true);
    setTrackPlaying(el, false);
    el.remove();
    const holders = Object.values(transport).filter((v) => v instanceof Set && v.has(el));
    expect(holders).toHaveLength(0);
  });

  it("suspends a context opened by a second init() after destroy()", async () => {
    const { transport } = await startTransport();
    transport.destroy();
    await transport.init();
    await idle();
    expect(contexts[contexts.length - 1]!.state).toBe("suspended");
  });

  it("tries again on the next Pause after a suspend that failed", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    suspendFails = true;
    transport.stopAll();
    await idle();
    expect(ctx.state).toBe("running");
    suspendFails = false;
    transport.stopAll();
    await idle();
    expect(ctx.state).toBe("suspended");
  });
  it("suspends on the next Pause after a playing track stopped with no pause event", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    transport.stopAll();
    setTrackPlaying(el, true);
    await idle();
    // The load algorithm (el.load(), a src swap) clears playback without firing "pause".
    Object.defineProperty(el, "paused", { configurable: true, get: () => true });
    transport.stopAll();
    await idle();
    expect(ctx.state).toBe("suspended");
  });

  it("suspends after a playing track is emptied by a reload, with no further Pause", async () => {
    const { transport, ctx } = await startTransport();
    const el = makeTrack();
    await play(transport, el);
    transport.stopAll();
    setTrackPlaying(el, true);
    await idle();
    Object.defineProperty(el, "paused", { configurable: true, get: () => true });
    el.dispatchEvent(new Event("emptied"));
    await idle();
    expect(ctx.state).toBe("suspended");
  });
});
