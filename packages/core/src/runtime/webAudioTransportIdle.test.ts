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
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = makeNode();
  constructor() {
    contexts.push(this);
  }
  createGain() {
    return makeNode();
  }
  createMediaElementSource() {
    return makeNode();
  }
  suspends = 0;
  // Chrome applies suspend() and resume() in call order.
  private queue: Promise<void> = Promise.resolve();
  private enqueue(gate: Promise<void> | null, next: "running" | "suspended") {
    this.queue = this.queue.then(() => gate).then(() => void (this.state = next));
    return this.queue;
  }
  suspend() {
    this.suspends += 1;
    return this.enqueue(suspendGate, "suspended");
  }
  resume() {
    return this.enqueue(resumeGate, "running");
  }
  close() {
    return Promise.resolve();
  }
}

const idle = () => vi.advanceTimersByTimeAsync(5000);
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
});
