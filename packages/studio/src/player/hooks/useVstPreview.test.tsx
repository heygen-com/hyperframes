// @vitest-environment happy-dom
//
// Integration tests use the REAL `useVstHost` (Task 12) driven through its
// documented test seam (`__setSocketFactoryForTests` + a hand-rolled
// `FakeSocket`, the same technique `useVstHost.test.tsx` uses) rather than
// mocking the module — this exercises the actual wiring between the two
// hooks instead of a hand-built stand-in.
//
// The browser has no Web Audio implementation in this test environment
// (jsdom/happy-dom ship no AudioContext/AudioWorkletNode at all), so this
// file stubs minimal fakes for those two globals, scoped to what
// useVstPreview actually calls (constructor, `.audioWorklet.addModule`,
// `.connect`, `.port.postMessage`, `.close`). It does NOT — and cannot —
// exercise the real vst-stream AudioWorkletProcessor (vstStreamWorklet.js);
// that requires a real browser audio-rendering thread. See the task report
// for what manual/browser verification covers instead.

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import { mountReactHarness } from "../../hooks/domSelectionTestHarness";
import { __setSocketFactoryForTests, type VstSocketLike } from "../../hooks/useVstHost";
import { usePlayerStore } from "../store/playerStore";
import { decodePcmFrame, useVstPreview } from "./useVstPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fake WebSocket (mirrors useVstHost.test.tsx's FakeSocket) ────────────────

class FakeSocket implements VstSocketLike {
  static instances: FakeSocket[] = [];
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.onclose?.(new CloseEvent("close"));
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  emitJson(payload: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  emitBinary(buf: ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data: buf }));
  }
}

// ── Fake Web Audio (this environment has none at all) ───────────────────────

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  port = { postMessage: vi.fn(), onmessage: null };
  connect = vi.fn();
  constructor(
    public context: unknown,
    public name: string,
    public options?: unknown,
  ) {
    FakeAudioWorkletNode.instances.push(this);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  audioWorklet = { addModule: vi.fn(async () => {}) };
  destination = {};
  close = vi.fn(async () => {});
  constructor(public options?: { sampleRate?: number }) {
    FakeAudioContext.instances.push(this);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function required<T>(value: T | null | undefined, label = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} was unexpectedly missing`);
  }
  return value;
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function buildFetchMock(chainJson: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/vst/start") return okJsonResponse({ port: 4321 });
    if (url.includes("/files/")) return okJsonResponse({ content: JSON.stringify(chainJson) });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

interface Harnessed {
  root: Root;
  audioEl: HTMLAudioElement;
  showToast: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
}

/** Mounts useVstPreview against a real <audio data-vst-chain> in `document`. */
function mountHarness(
  projectId: string | undefined,
  chainJson: unknown,
  includeAudio = true,
): Harnessed {
  const audioEl = document.createElement("audio");
  audioEl.id = "track-1";
  if (includeAudio) {
    audioEl.setAttribute("data-vst-chain", "fx/track-1.vstchain.json");
    audioEl.setAttribute("src", "dry.wav");
    document.body.append(audioEl);
  }

  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentDocument", { configurable: true, value: document });
  const iframeRef = { current: iframe };

  const fetchMock = buildFetchMock(chainJson);
  vi.stubGlobal("fetch", fetchMock);

  const showToast = vi.fn();

  function Harness() {
    useVstPreview(iframeRef, projectId, showToast);
    return null;
  }

  const root = mountReactHarness(<Harness />);
  return { root, audioEl, showToast, fetchMock };
}

/** Drives a mounted harness to a fully loaded (ready + chain loaded) state. */
async function setupLoadedPreview(): Promise<Harnessed & { socket: FakeSocket }> {
  const harness = mountHarness("proj-1", { version: 1, plugins: [] });

  await act(async () => {
    await flushAsyncWork();
    required(FakeSocket.instances[0], "socket").open();
    await flushAsyncWork();
  });

  await act(async () => {
    await flushAsyncWork();
    required(FakeSocket.instances[0], "socket").emitJson({
      event: "chain-loaded",
      trackId: "track-1",
    });
    await flushAsyncWork();
  });

  return { ...harness, socket: required(FakeSocket.instances[0], "socket") };
}

beforeEach(() => {
  FakeSocket.instances = [];
  FakeAudioContext.instances = [];
  FakeAudioWorkletNode.instances = [];
  __setSocketFactoryForTests((url) => new FakeSocket(url));
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
});

afterEach(() => {
  document.body.innerHTML = "";
  __setSocketFactoryForTests(null);
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
  vi.useRealTimers();
});

// ── decodePcmFrame ────────────────────────────────────────────────────────────

describe("decodePcmFrame", () => {
  function encodeFrame(
    trackIndex: number,
    samplePos: number,
    pairs: [number, number][],
  ): ArrayBuffer {
    const buf = new ArrayBuffer(12 + pairs.length * 2 * 4);
    const view = new DataView(buf);
    view.setUint32(0, trackIndex, true);
    view.setFloat64(4, samplePos, true);
    const interleaved = new Float32Array(buf, 12);
    pairs.forEach(([l, r], i) => {
      interleaved[2 * i] = l;
      interleaved[2 * i + 1] = r;
    });
    return buf;
  }

  it("decodes trackIndex and samplePos from the header", () => {
    const frame = decodePcmFrame(encodeFrame(3, 48000, [[0.5, -0.5]]));
    expect(frame.trackIndex).toBe(3);
    expect(frame.samplePos).toBe(48000);
  });

  it("de-interleaves stereo samples into separate left/right arrays", () => {
    const frame = decodePcmFrame(
      encodeFrame(0, 0, [
        [1, -1],
        [2, -2],
        [3, -3],
      ]),
    );
    expect(Array.from(frame.left)).toEqual([1, 2, 3]);
    expect(Array.from(frame.right)).toEqual([-1, -2, -3]);
  });

  it("handles a zero-sample frame (header only)", () => {
    const frame = decodePcmFrame(encodeFrame(1, 100, []));
    expect(frame.left.length).toBe(0);
    expect(frame.right.length).toBe(0);
  });

  it("round-trips a large trackIndex and fractional samplePos precisely", () => {
    const frame = decodePcmFrame(encodeFrame(4294967295, 123456.789, [[0.1, 0.2]]));
    expect(frame.trackIndex).toBe(4294967295);
    expect(frame.samplePos).toBeCloseTo(123456.789, 6);
  });
});

// ── Chain loading + muting ───────────────────────────────────────────────────

describe("useVstPreview — chain loading", () => {
  it("loads the chain and mutes the dry element once the sidecar is ready", async () => {
    const { root, audioEl, socket } = await setupLoadedPreview();

    expect(audioEl.muted).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]?.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining("vstStreamWorklet.js"),
    );
    expect(FakeAudioWorkletNode.instances).toHaveLength(1);
    expect(FakeAudioWorkletNode.instances[0]?.connect).toHaveBeenCalledWith(
      FakeAudioContext.instances[0]?.destination,
    );
    const loadChainMsg = socket.sent.find((raw) => raw.includes('"cmd":"load-chain"'));
    expect(loadChainMsg).toBeDefined();
    expect(loadChainMsg).toContain('"trackId":"track-1"');

    act(() => root.unmount());
  });

  it("does nothing when there is no data-vst-chain audio element in the DOM", async () => {
    const { root, fetchMock } = mountHarness("proj-1", { version: 1, plugins: [] }, false);

    await act(async () => {
      await flushAsyncWork();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(0);

    act(() => root.unmount());
  });

  it("does nothing when projectId is undefined", async () => {
    const { root, fetchMock, audioEl } = mountHarness(undefined, { version: 1, plugins: [] });

    await act(async () => {
      await flushAsyncWork();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(audioEl.muted).toBe(false);

    act(() => root.unmount());
  });
});

// ── Transport: play/pause/seek ───────────────────────────────────────────────

describe("useVstPreview — transport", () => {
  it("sends a play transport message with currentTime + playbackRate when isPlaying flips true", async () => {
    const { root, socket } = await setupLoadedPreview();

    act(() => {
      usePlayerStore.getState().setCurrentTime(4.5);
      usePlayerStore.getState().setPlaybackRate(1.5);
      usePlayerStore.getState().setIsPlaying(true);
    });

    const playMsg = socket.sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((msg) => msg.cmd === "transport" && msg.action === "play");
    expect(playMsg).toMatchObject({ action: "play", timeSec: 4.5, rate: 1.5 });

    act(() => root.unmount());
  });

  it("sends a bare pause transport message when isPlaying flips false", async () => {
    const { root, socket } = await setupLoadedPreview();

    act(() => usePlayerStore.getState().setIsPlaying(true));
    act(() => usePlayerStore.getState().setIsPlaying(false));

    const pauseMsg = socket.sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((msg) => msg.cmd === "transport" && msg.action === "pause");
    expect(pauseMsg).toEqual({ cmd: "transport", action: "pause" });

    act(() => root.unmount());
  });

  it("sends a seek transport message and resets the worklet node on requestSeek", async () => {
    const { root, socket } = await setupLoadedPreview();

    act(() => usePlayerStore.getState().requestSeek(2));

    const seekMsg = socket.sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((msg) => msg.cmd === "transport" && msg.action === "seek");
    expect(seekMsg).toMatchObject({ action: "seek", timeSec: 2 });

    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");
    expect(node.port.postMessage).toHaveBeenCalledWith({ type: "reset", samplePos: 2 * 48000 });

    act(() => root.unmount());
  });
});

// ── PCM frame routing ─────────────────────────────────────────────────────────

describe("useVstPreview — PCM routing", () => {
  it("routes a PCM frame matching the loaded track's index to its worklet node", async () => {
    const { root, socket } = await setupLoadedPreview();
    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");

    const buf = new ArrayBuffer(12 + 2 * 4);
    const view = new DataView(buf);
    view.setUint32(0, 0, true); // trackIndex 0 — the only loaded track
    view.setFloat64(4, 1000, true);
    new Float32Array(buf, 12)[0] = 0.25;
    new Float32Array(buf, 12)[1] = -0.25;

    act(() => socket.emitBinary(buf));

    expect(node.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pcm", samplePos: 1000 }),
      expect.any(Array),
    );

    act(() => root.unmount());
  });

  it("drops a PCM frame whose trackIndex has no loaded track", async () => {
    const { root, socket } = await setupLoadedPreview();
    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");
    node.port.postMessage.mockClear();

    const buf = new ArrayBuffer(12 + 2 * 4);
    const view = new DataView(buf);
    view.setUint32(0, 7, true); // no track loaded at index 7
    view.setFloat64(4, 1000, true);

    act(() => socket.emitBinary(buf));

    expect(node.port.postMessage).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});

// ── Crash fallback ────────────────────────────────────────────────────────────

describe("useVstPreview — crash fallback", () => {
  it("unmutes the dry element, shows a toast, and attempts one restart on disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, audioEl, showToast, fetchMock, socket } = await setupLoadedPreview();

    await act(async () => {
      socket.close();
      await flushAsyncWork();
    });

    expect(audioEl.muted).toBe(false);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("disconnected"), "error");

    function countStartCalls(): number {
      return fetchMock.mock.calls.filter((call: unknown[]) => call[0] === "/api/vst/start").length;
    }

    expect(countStartCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(countStartCalls()).toBe(2);

    act(() => root.unmount());
  });
});
