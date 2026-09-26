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
});
