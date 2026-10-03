import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

type GraphNode = {
  kind: string;
  outputs: Set<GraphNode>;
  gain?: { value: number };
  connect(dest: GraphNode): GraphNode;
  disconnect(dest?: GraphNode): void;
};

function makeParam(value: number) {
  return {
    value,
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
  };
}

function makeNode(kind: string, extra: Partial<GraphNode> = {}): GraphNode {
  const node: GraphNode = {
    kind,
    outputs: new Set(),
    connect(dest) {
      node.outputs.add(dest);
      return dest;
    },
    disconnect(dest) {
      if (dest) node.outputs.delete(dest);
      else node.outputs.clear();
    },
    ...extra,
  };
  return node;
}

const sources = new Map<HTMLMediaElement, GraphNode>();

class GraphAudioContext {
  state = "running";
  currentTime = 0;
  destination = makeNode("destination");
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createGain() {
    return makeNode("gain", { gain: makeParam(1) });
  }
  createMediaElementSource(el: HTMLMediaElement) {
    const node = makeNode("media-element");
    sources.set(el, node);
    return node;
  }
}

function createTimeline(duration: number): RuntimeTimelineLike {
  const s = { time: 0, paused: true };
  return {
    play: () => void (s.paused = false),
    pause: () => void (s.paused = true),
    seek: (t?: number) => (t === undefined ? s.time : (s.time = t)),
    totalTime: (t?: number) => (t === undefined ? s.time : (s.time = t)),
    time: () => s.time,
    duration: () => duration,
    add: () => {},
    paused: (v?: boolean) => (typeof v === "boolean" ? (s.paused = v) : s.paused),
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

function mount(bodyHtml: string): void {
  document.body.innerHTML =
    `<div data-composition-id="main" data-root="true" data-start="0" data-duration="10"` +
    ` data-width="1920" data-height="1080">${bodyHtml}</div>`;
  for (const el of document.querySelectorAll("audio")) {
    el.load = () => {};
    el.play = vi.fn(() => Promise.resolve());
    el.pause = vi.fn();
    for (const [key, value] of Object.entries({ paused: true, readyState: 4, currentTime: 0 })) {
      Object.defineProperty(el, key, { value, writable: true, configurable: true });
    }
  }
  window.__timelines = { main: createTimeline(10) };
}

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

let frameCallbacks: FrameRequestCallback[] = [];
let nowMs = 0;
function stepFrames(count: number) {
  for (let i = 0; i < count; i++) {
    nowMs += 1000 / 60;
    const pending = frameCallbacks;
    frameCallbacks = [];
    for (const cb of pending) cb(nowMs);
  }
}

const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
const originalRaf = window.requestAnimationFrame;
const originalCaf = window.cancelAnimationFrame;

beforeEach(() => {
  sources.clear();
  nowMs = 0;
  frameCallbacks = [];
  (globalThis as Record<string, unknown>).AudioContext = GraphAudioContext;
  (globalThis as typeof globalThis & { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
  globalThis.CSS.escape ??= (v: string) => v;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  window.__timelines = {} as Record<string, RuntimeTimelineLike>;
  delete window.__player;
  delete window.__hf;
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
});

describe("the audio the playhead follows", () => {
  it("keeps following a playing voice when a clip earlier in the page starts late", async () => {
    mount(
      `<audio id="sfx" data-start="1" data-duration="2" src="/assets/sfx.mp3"></audio>` +
        `<audio id="vo" data-start="0" data-duration="10" src="/assets/vo.mp3"></audio>`,
    );
    const sfx = document.getElementById("sfx") as HTMLAudioElement;
    const vo = document.getElementById("vo") as HTMLAudioElement;
    initSandboxRuntimeModular();
    await flush();
    window.__player?.play();
    await flush();
    const playedAt = nowMs;
    Object.assign(vo, { paused: false });
    let lastTime = 0;
    for (let frame = 0; frame < 90; frame++) {
      stepFrames(1);
      const t = (nowMs - playedAt) / 1000;
      vo.currentTime = t; // the voice plays in step with the wall clock
      if (t >= 1) Object.assign(sfx, { paused: false, currentTime: 0 }); // started, not moving yet
      const time = window.__player!.getTime();
      expect(time).toBeGreaterThanOrEqual(lastTime);
      lastTime = time;
    }
    expect(lastTime).toBeGreaterThan(1.4);
  });

  it("follows the music across cuts between short clips earlier in the page", async () => {
    mount(
      `<audio id="shot1" data-start="0" data-duration="1" src="/assets/a.mp4"></audio>` +
        `<audio id="shot2" data-start="1" data-duration="1" src="/assets/b.mp4"></audio>` +
        `<audio id="shot3" data-start="2" data-duration="1" src="/assets/c.mp4"></audio>` +
        `<audio id="music" data-start="0" data-duration="10" src="/assets/music.wav"></audio>`,
    );
    const shots = ["shot1", "shot2", "shot3"].map(
      (id) => document.getElementById(id) as HTMLAudioElement,
    );
    const music = document.getElementById("music") as HTMLAudioElement;
    let musicTime = 0;
    const musicSeeks: number[] = [];
    Object.defineProperty(music, "currentTime", {
      configurable: true,
      get: () => musicTime,
      set: (value: number) => {
        musicSeeks.push(value);
        musicTime = value;
      },
    });
    initSandboxRuntimeModular();
    await flush();
    window.__player?.play();
    await flush();
    const coldStartLagSeconds = 0.25; // how late each shot's sound starts, as a cold clip does at a cut
    const playedAt = nowMs;
    musicSeeks.length = 0; // Play itself lands every clip on the playhead
    Object.assign(music, { paused: false });
    for (let frame = 1; frame <= 170; frame++) {
      const t = (nowMs + 1000 / 60 - playedAt) / 1000;
      musicTime = t;
      shots.forEach((shot, i) => {
        if (t < i) return;
        Object.assign(shot, {
          paused: t >= i + 1,
          currentTime: Math.max(0, t - i - coldStartLagSeconds),
        });
      });
      stepFrames(1);
      expect(window.__player!.getTime()).toBeCloseTo(t, 3);
    }
    expect(musicSeeks).toEqual([]);
  });

  it("follows the next clip when one earlier in the page failed to load", async () => {
    mount(
      `<audio id="broken" data-start="0" data-duration="10" src="/assets/missing.mp3"></audio>` +
        `<audio id="vo" data-start="0" data-duration="10" src="/assets/vo.mp3"></audio>`,
    );
    const broken = document.getElementById("broken") as HTMLAudioElement;
    const vo = document.getElementById("vo") as HTMLAudioElement;
    initSandboxRuntimeModular();
    await flush();
    window.__player?.play();
    await flush();
    const playedAt = nowMs;
    Object.defineProperty(broken, "error", { value: { code: 4 } });
    Object.assign(broken, { paused: false, currentTime: 0 });
    Object.assign(vo, { paused: false });
    for (let frame = 0; frame < 90; frame++) {
      stepFrames(1);
      vo.currentTime = (nowMs - playedAt) / 1000 + 0.2; // ahead of the wall clock, so only the voice explains it
    }
    expect(window.__player!.getTime()).toBeGreaterThan((nowMs - playedAt) / 1000 + 0.1);
  });

  it("is not frozen by a clip that has no playable source", async () => {
    mount(
      `<audio id="empty" data-start="0" data-duration="10"></audio>` +
        `<audio id="vo" data-start="0" data-duration="10" src="/assets/vo.mp3"></audio>`,
    );
    const empty = document.getElementById("empty") as HTMLAudioElement;
    const vo = document.getElementById("vo") as HTMLAudioElement;
    initSandboxRuntimeModular();
    await flush();
    window.__player?.play();
    await flush();
    const playedAt = nowMs;
    // What Chrome reports for an <audio> with no source once play() is called on it.
    Object.defineProperty(empty, "networkState", { value: 0 });
    Object.defineProperty(empty, "readyState", { value: 0 });
    Object.assign(empty, { paused: false });
    Object.assign(vo, { paused: false });
    for (let frame = 0; frame < 90; frame++) {
      stepFrames(1);
      vo.currentTime = (nowMs - playedAt) / 1000;
    }
    expect(window.__player!.getTime()).toBeGreaterThan(1.4);
  });
});
