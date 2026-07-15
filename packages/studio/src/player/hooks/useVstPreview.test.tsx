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
import { __setSocketFactoryForTests, useVstHost, type VstSocketLike } from "../../hooks/useVstHost";
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
    const vstHost = useVstHost();
    useVstPreview(iframeRef, projectId, vstHost, showToast);
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

// ── trackIndex resync on an external chain reload ────────────────────────────
//
// Simulates the scenario Task 13b fixes: this hook and the FX property panel
// now share ONE useVstHost() connection (see the module doc-comment), so a
// `chain-loaded` event can arrive for a trackId this hook already streams
// without this hook having initiated the reload itself — e.g. the panel
// added/removed an effect. The fake socket is driven directly with a raw
// `chain-loaded` event (bypassing `api.loadChain`) to model exactly that:
// "some other caller on the shared connection reloaded this track".

interface TwoTrackHarness {
  root: Root;
  audioEl1: HTMLAudioElement;
  audioEl2: HTMLAudioElement;
  showToast: ReturnType<typeof vi.fn>;
  socket: FakeSocket;
}

/** Loads two vst-chain tracks (track-1 → index 0, track-2 → index 1) through one shared connection. */
async function setupTwoLoadedTracks(): Promise<TwoTrackHarness> {
  const audioEl1 = document.createElement("audio");
  audioEl1.id = "track-1";
  audioEl1.setAttribute("data-vst-chain", "fx/track-1.vstchain.json");
  audioEl1.setAttribute("src", "dry1.wav");
  document.body.append(audioEl1);

  const audioEl2 = document.createElement("audio");
  audioEl2.id = "track-2";
  audioEl2.setAttribute("data-vst-chain", "fx/track-2.vstchain.json");
  audioEl2.setAttribute("src", "dry2.wav");
  document.body.append(audioEl2);

  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentDocument", { configurable: true, value: document });
  const iframeRef = { current: iframe };

  vi.stubGlobal("fetch", buildFetchMock({ version: 1, plugins: [] }));
  const showToast = vi.fn();

  function Harness() {
    const vstHost = useVstHost();
    useVstPreview(iframeRef, "proj-1", vstHost, showToast);
    return null;
  }
  const root = mountReactHarness(<Harness />);

  await act(async () => {
    await flushAsyncWork();
    required(FakeSocket.instances[0], "socket").open();
    await flushAsyncWork();
  });
  const socket = required(FakeSocket.instances[0], "socket");

  await act(async () => {
    await flushAsyncWork();
    socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
    await flushAsyncWork();
    socket.emitJson({ event: "chain-loaded", trackId: "track-2" });
    await flushAsyncWork();
  });

  return { root, audioEl1, audioEl2, showToast, socket };
}

describe("useVstPreview — trackIndex resync on an external chain reload", () => {
  it("keeps routing correctly when a solo track is reloaded and its index doesn't change", async () => {
    const { root, audioEl, socket } = await setupLoadedPreview();
    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");
    node.port.postMessage.mockClear();

    // Only one track was ever loaded, so the sidecar's pop-then-reinsert rule
    // reassigns it the SAME index (0) — no collision, nothing to revert.
    await act(async () => {
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
      await flushAsyncWork();
    });

    expect(audioEl.muted).toBe(true); // still streaming through the worklet, not reverted to dry

    const buf = new ArrayBuffer(12 + 2 * 4);
    const view = new DataView(buf);
    view.setUint32(0, 0, true);
    view.setFloat64(4, 2000, true);
    act(() => socket.emitBinary(buf));

    expect(node.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pcm", samplePos: 2000 }),
      expect.any(Array),
    );

    act(() => root.unmount());
  });

  it("updates the local trackIndex mapping when an external reload reassigns an already-loaded track", async () => {
    const { root, socket } = await setupTwoLoadedTracks();
    const node1 = required(FakeAudioWorkletNode.instances[0], "track-1 worklet node");
    node1.port.postMessage.mockClear();

    // track-1 (index 0) and track-2 (index 1) are both loaded. Reload
    // track-2 — the MOST RECENTLY loaded track — which the server's rule
    // reassigns to the SAME index it already held (pop leaves one entry, so
    // `len(self._tracks)` is 1 again): no collision, but this hook must
    // still pick up the fresh index from the event rather than silently
    // keep routing on a value it never re-derived.
    await act(async () => {
      socket.emitJson({ event: "chain-loaded", trackId: "track-2" });
      await flushAsyncWork();
    });

    const buf = new ArrayBuffer(12 + 2 * 4);
    const view = new DataView(buf);
    view.setUint32(0, 0, true); // track-1's index — must still route to track-1 only
    view.setFloat64(4, 3000, true);
    act(() => socket.emitBinary(buf));

    expect(node1.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pcm", samplePos: 3000 }),
      expect.any(Array),
    );

    act(() => root.unmount());
  });

  it("reverts BOTH tracks to dry playback and warns instead of silently misrouting on an index collision", async () => {
    // Reloading track-1 (NOT the most recently loaded track) pops it, leaving
    // one entry (track-2), so the server's rule reassigns track-1 the same
    // index track-2 already holds (1) — a genuine collision the wire
    // protocol cannot disambiguate (see assignNextTrackIndex's doc-comment).
    const { root, audioEl1, audioEl2, showToast, socket } = await setupTwoLoadedTracks();
    const node1 = required(FakeAudioWorkletNode.instances[0], "track-1 worklet node");
    const node2 = required(FakeAudioWorkletNode.instances[1], "track-2 worklet node");
    node1.port.postMessage.mockClear();
    node2.port.postMessage.mockClear();

    expect(audioEl1.muted).toBe(true);
    expect(audioEl2.muted).toBe(true);

    await act(async () => {
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
      await flushAsyncWork();
    });

    // Both tracks reverted to their original (unmuted) dry playback rather
    // than one silently stealing the other's processed audio stream.
    expect(audioEl1.muted).toBe(false);
    expect(audioEl2.muted).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("routing conflict"), "error");

    // A PCM frame at the now-ambiguous index must be dropped for both, not
    // routed to whichever track happens to be first in iteration order.
    const buf = new ArrayBuffer(12 + 2 * 4);
    const view = new DataView(buf);
    view.setUint32(0, 1, true);
    view.setFloat64(4, 4000, true);
    act(() => socket.emitBinary(buf));

    expect(node1.port.postMessage).not.toHaveBeenCalled();
    expect(node2.port.postMessage).not.toHaveBeenCalled();

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

// ── Global suspend: ANY disconnect permanently stops ALL future streaming ───
//
// Task 13b (round 3) bug history: a WS disconnect does NOT imply the sidecar
// process (and its server-side `_tracks` dict) was torn down —
// `startVstSidecar` reuses the SAME running process in the common case (see
// useVstHost's handleDisconnect doc-comment). Round 1 mirrored the sidecar's
// index assignment client-side and detected collisions after the fact; round
// 2 snapshotted `loadedTracksRef`'s keys into an `unsafeAfterDisconnectRef`
// set right before a disconnect cleared it, to stop those SPECIFIC tracks
// from being silently reloaded. Round 2's review found a real gap: a track
// that was in `trackOrderRef` (i.e. had already reserved a server-side
// trackIndex via a successful `loadChain`) but not yet in `loadedTracksRef`
// (its local AudioContext/AudioWorkletNode wiring hadn't finished, or had
// thrown) was wiped from `trackOrderRef` on disconnect WITHOUT being marked
// unsafe — so it got blindly reloaded post-reconnect with zero collision
// detection. Enumerating every such in-flight state correctly has now failed
// twice, so this hook replaces all per-track tracking with one permanent,
// whole-hook `suspendedRef`: once ANY disconnect fires, NOTHING streams
// through this hook instance again — not a previously-loaded track, not a
// previously-attempted one, and not a track that only appears in the DOM
// for the first time after the disconnect. The test below specifically
// covers that last case (a track never seen by ANY tracker before the
// disconnect), since that's exactly what round 2's narrower mechanism missed.

describe("useVstPreview — global suspend after any disconnect", () => {
  it("never streams again after a disconnect — not even a track that never appeared in the DOM until after reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, audioEl1, audioEl2, showToast, socket } = await setupTwoLoadedTracks();

    expect(audioEl1.muted).toBe(true);
    expect(audioEl2.muted).toBe(true);

    // Disconnect — the crash-fallback effect immediately reverts both
    // tracks to dry, latches `suspendedRef` permanently, and schedules one
    // auto-reconnect.
    await act(async () => {
      socket.close();
      await flushAsyncWork();
    });

    expect(audioEl1.muted).toBe(false);
    expect(audioEl2.muted).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("disconnected"), "error");

    // A brand-new track appears in the DOM AFTER the disconnect — one this
    // hook never attempted to load and that was never held by
    // loadedTracksRef, trackOrderRef, OR round 2's (now-removed)
    // unsafeAfterDisconnectRef. Under round 2's narrower per-track tracking
    // this track wouldn't be excluded by anything and would have been
    // blindly loaded once the sidecar reconnected.
    const audioEl3 = document.createElement("audio");
    audioEl3.id = "track-3";
    audioEl3.setAttribute("data-vst-chain", "fx/track-3.vstchain.json");
    audioEl3.setAttribute("src", "dry3.wav");
    document.body.append(audioEl3);

    // Advance past the 2s auto-restart delay so the reconnect attempt opens
    // a new socket — representing the SAME still-running, stateful sidecar
    // (server-side `_tracks` for track-1/track-2 were never torn down by
    // this disconnect).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await flushAsyncWork();
    });

    const newSocket = required(FakeSocket.instances[1], "reconnected socket");
    await act(async () => {
      newSocket.open();
      await flushAsyncWork();
    });

    function loadChainCallsFor(trackId: string): string[] {
      return newSocket.sent.filter(
        (raw) => raw.includes('"cmd":"load-chain"') && raw.includes(`"trackId":"${trackId}"`),
      );
    }

    // The fix: NOTHING gets (re)loaded on the new connection post-disconnect
    // — previously-streamed tracks stay in dry fallback, and so does a track
    // that only showed up in the DOM after the disconnect.
    expect(loadChainCallsFor("track-1")).toHaveLength(0);
    expect(loadChainCallsFor("track-2")).toHaveLength(0);
    expect(loadChainCallsFor("track-3")).toHaveLength(0);
    expect(audioEl1.muted).toBe(false);
    expect(audioEl2.muted).toBe(false);
    expect(audioEl3.muted).toBe(false);

    act(() => root.unmount());
  });

  it("tears down a track whose local wiring was still in flight when the disconnect fired, instead of leaving it muted with no audio ever routed to it", async () => {
    // Controls the timing of `audioContext.audioWorklet.addModule()` so the
    // test can land the disconnect exactly between the sidecar's successful
    // `chain-loaded` reply (which resolves `api.loadChain`) and the local
    // AudioContext/AudioWorkletNode wiring finishing — the exact gap round
    // 2's per-track "unsafe" snapshot missed, because at that moment this
    // track is in neither `loadedTracksRef` nor `trackOrderRef` yet.
    let releaseAddModule: (() => void) | null = null;
    class GatedAudioContext extends FakeAudioContext {
      constructor(options?: { sampleRate?: number }) {
        super(options);
        this.audioWorklet = {
          addModule: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseAddModule = resolve;
              }),
          ),
        };
      }
    }
    vi.stubGlobal("AudioContext", GatedAudioContext);

    const { root, audioEl, showToast } = mountHarness("proj-1", { version: 1, plugins: [] });

    await act(async () => {
      await flushAsyncWork();
      required(FakeSocket.instances[0], "socket").open();
      await flushAsyncWork();
    });
    const socket = required(FakeSocket.instances[0], "socket");

    await act(async () => {
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
      await flushAsyncWork();
    });

    // Server-side load-chain succeeded, but local wiring is stuck awaiting
    // our gated `addModule()` — the track isn't muted yet and isn't loaded.
    expect(audioEl.muted).toBe(false);
    expect(releaseAddModule).not.toBeNull();

    await act(async () => {
      socket.close();
      await flushAsyncWork();
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("disconnected"), "error");

    // Now let the in-flight local wiring finish — AFTER the disconnect
    // already fired and latched suspendedRef.
    await act(async () => {
      required(releaseAddModule, "releaseAddModule")();
      await flushAsyncWork();
    });

    // Must be torn down to its original dry state, not left muted with a
    // worklet that will never receive another PCM frame.
    expect(audioEl.muted).toBe(false);
    expect(required(FakeAudioContext.instances[0], "gated audio context").close).toHaveBeenCalled();

    act(() => root.unmount());
  });
});
