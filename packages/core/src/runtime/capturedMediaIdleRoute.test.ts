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
let destination: GraphNode;

let pendingResume: Promise<void> | null = null;
class GraphAudioContext {
  state = pendingResume ? "suspended" : "running";
  currentTime = 0;
  destination = (destination = makeNode("destination"));
  resume() {
    return pendingResume ?? Promise.resolve();
  }
  suspend() {
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

/** True when a signal entering `node` reaches the speakers through no silenced gain. */
function audible(node: GraphNode | undefined, seen = new Set<GraphNode>()): boolean {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (node === destination) return true;
  if (node.gain && node.gain.value <= 0) return false;
  for (const out of node.outputs) if (audible(out, seen)) return true;
  return false;
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
  pendingResume = null;
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

describe("an element Web Audio captured, outside a play", () => {
  it("stays audible to a paused scrub after the first Play/Pause, through one path only", async () => {
    mount(`<audio data-start="0" data-duration="10" src="/assets/music.mp3"></audio>`);
    const music = document.querySelector("audio")!;
    initSandboxRuntimeModular();
    await flush();

    window.__player?.play();
    await flush();
    const source = sources.get(music)!;
    expect(audible(source)).toBe(true);
    window.__player?.pause();

    // What studio/src/player/lib/timelineIframeHelpers.ts applyScrub does on a paused drag.
    window.__hf?.leasePausedMedia?.(music);
    music.muted = false;
    music.volume = 0.25;
    void music.play();
    expect(audible(source)).toBe(true);
    window.__hf?.releasePausedMedia?.(music);

    window.__player?.play();
    await flush();
    expect(audible(source)).toBe(true);
    expect(source.outputs.has(destination)).toBe(false);
  });

  it("does not let a track hidden while playing sound for a frame on its idle route", async () => {
    mount(`<audio data-start="0" data-duration="10" src="/assets/music.mp3"></audio>`);
    const music = document.querySelector("audio")!;
    initSandboxRuntimeModular();
    await flush();
    window.__player?.play();
    await flush();
    stepFrames(2);

    music.setAttribute("data-hidden", "");
    stepFrames(1);

    expect(music.volume).toBe(0);
  });

  it("does not mute a processed track whose capture a newer pass replaced", async () => {
    let release!: () => void;
    pendingResume = new Promise<void>((r) => (release = r));
    mount(
      `<audio id="vo" data-start="0" data-duration="10" data-playback-rate="1.5" data-fx-chain="[]" src="/assets/vo.mp3"></audio>` +
        `<audio id="sfx" data-start="0" data-duration="10" src="/assets/sfx.mp3"></audio>`,
    );
    const vo = document.getElementById("vo") as HTMLAudioElement;
    initSandboxRuntimeModular();
    await flush();
    window.__player?.play();
    await flush();

    // A hide reschedules every track while the first captures still wait on resume().
    document.getElementById("sfx")!.setAttribute("data-hidden", "");
    stepFrames(1);
    release();
    pendingResume = null;
    await flush();

    expect(vo.muted).toBe(false);
    expect(audible(sources.get(vo))).toBe(true);
  });
});
