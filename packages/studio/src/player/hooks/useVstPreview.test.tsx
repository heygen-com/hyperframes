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
import { __setSocketFactoryForTests, useVstHost } from "../../hooks/useVstHost";
import { FakeSocket, required } from "../../hooks/vstSocketTestFixture";
import { liveTime, usePlayerStore } from "../store/playerStore";
import { decodePcmFrame, useVstPreview } from "./useVstPreview";

vi.mock("../../components/editor/manualEditingAvailability", () => ({
  STUDIO_VST_ENABLED: true,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  // Real browsers start every new AudioContext "suspended" under the
  // autoplay policy — resume() (called at the transport play transition,
  // see useVstPreview.ts's resumeSuspendedContexts) is what makes PCM
  // audible instead of silently dropped.
  state: "suspended" | "running" = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  constructor(public options?: { sampleRate?: number }) {
    FakeAudioContext.instances.push(this);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

async function flushAsyncWork(): Promise<void> {
  // 30, not 10: loadVstTrack now awaits an extra fetch (resolveLocalWavPath)
  // before api.loadChain, adding another real microtask hop per track.
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

/** Opens the first fake socket and flushes surrounding async work. Call inside `act()`. */
async function openFirstSocket(): Promise<void> {
  await flushAsyncWork();
  required(FakeSocket.instances[0], "socket").open();
  await flushAsyncWork();
}

/** Emits a chain-loaded event on the first fake socket and flushes surrounding async work. Call inside `act()`. */
async function emitChainLoaded(payload: {
  trackId: string;
  sampleRate: number;
  stable?: boolean;
}): Promise<void> {
  await flushAsyncWork();
  required(FakeSocket.instances[0], "socket").emitJson({ event: "chain-loaded", ...payload });
  await flushAsyncWork();
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
    if (url === "/api/vst/start") return okJsonResponse({ port: 4321, token: "test-token" });
    if (url.includes("/vst/wav-path")) {
      const subPath = new URL(url, "http://localhost").searchParams.get("path");
      return okJsonResponse({ path: `/abs/project/${subPath}` });
    }
    if (url.includes("/files/")) return okJsonResponse({ content: JSON.stringify(chainJson) });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** Finds the worklet node's most recent "reset" postMessage call — the
 *  shared lookup the ring-realignment tests below need. */
function findResetCall(
  node: FakeAudioWorkletNode,
): { type?: string; samplePos?: number } | undefined {
  return node.port.postMessage.mock.calls
    .map((c) => c[0] as { type?: string; samplePos?: number })
    .find((m) => m && m.type === "reset");
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
    audioEl.setAttribute("src", `/api/projects/${projectId ?? "proj-1"}/preview/dry.wav`);
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

/** Opens the first fake socket (inside `act()`) and returns it — the shared
 *  "connect, then grab the socket instance" step every loaded-preview setup
 *  below needs. */
async function connectAndGetSocket(): Promise<FakeSocket> {
  await act(async () => {
    await openFirstSocket();
  });
  return required(FakeSocket.instances[0], "socket");
}

/** Drives a mounted harness to a fully loaded (ready + chain loaded) state. */
async function setupLoadedPreview(): Promise<Harnessed & { socket: FakeSocket }> {
  const harness = mountHarness("proj-1", { version: 1, plugins: [] });
  const socket = await connectAndGetSocket();

  await act(async () => {
    await emitChainLoaded({ trackId: "track-1", sampleRate: 48000 });
  });

  return { ...harness, socket };
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

  it("retries a load whose effect run was cancelled mid-flight instead of stranding the track", async () => {
    // Live-repro'd race: effect run A starts the async load; before the
    // sidecar replies `chain-loaded`, a dependency churn (elements /
    // vstChainRevision — routine right after mount) re-runs the effect. Run B
    // scans, sees A's load still pending (`pendingTrackIdsRef` guard), and
    // skips the track. A then resolves, sees itself cancelled, and tears the
    // freshly wired track down — with `trackOrderRef` still holding the
    // "already attempted" reservation, NOTHING ever retried: chain loaded
    // server-side, zero tracks client-side, transport forever seeing
    // `loaded: 0` (music silent from the first play).
    const { root, audioEl } = mountHarness("proj-1", { version: 1, plugins: [] });

    // Let run A get as far as sending `load-chain` (its promise now pending
    // on the chain-loaded reply we haven't emitted yet).
    await act(async () => {
      await openFirstSocket();
    });
    const socket = required(FakeSocket.instances[0], "socket");
    expect(socket.sent.filter((m) => m.includes('"cmd":"load-chain"'))).toHaveLength(1);

    // Mid-flight: re-run the load effect (run B) while A's load is pending.
    await act(async () => {
      usePlayerStore.getState().bumpVstChainRevision();
      await flushAsyncWork();
    });

    // NOW the sidecar replies — resolving A's load inside a cancelled run.
    await act(async () => {
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
      await flushAsyncWork();
    });

    // The retry (run C, poked by the cancellation handler) re-issues
    // load-chain; answer it and let it settle.
    await act(async () => {
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
      await flushAsyncWork();
    });

    expect(socket.sent.filter((m) => m.includes('"cmd":"load-chain"'))).toHaveLength(2);
    expect(audioEl.muted).toBe(true); // track actually loaded, not stranded dry

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
  it("sends a play transport message with the live playhead time + playbackRate when isPlaying flips true", async () => {
    const { root, socket } = await setupLoadedPreview();

    act(() => {
      // The real, continuously-updating playhead — see useVstPreview.ts's
      // liveTimeRef doc-comment for why this reads `liveTime`, not the
      // Zustand store's `currentTime` (the RAF loop only syncs that "once
      // at end", so it stays stale/frozen for the entire duration of a
      // fresh play from the start).
      liveTime.notify(4.5);
      usePlayerStore.getState().setPlaybackRate(1.5);
      usePlayerStore.getState().setIsPlaying(true);
    });

    const playMsg = socket.sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((msg) => msg.cmd === "transport" && msg.action === "play");
    expect(playMsg).toMatchObject({ action: "play", timeSec: 4.5, rate: 1.5 });

    act(() => root.unmount());
  });

  it("resumes the track's suspended AudioContext when isPlaying flips true", async () => {
    const { root } = await setupLoadedPreview();
    const ctx = required(FakeAudioContext.instances[0], "audio context");
    expect(ctx.state).toBe("suspended"); // real browsers start every context suspended

    act(() => usePlayerStore.getState().setIsPlaying(true));

    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.state).toBe("running");

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

  it("flushes the worklet ring on pause so the buffered lead cushion doesn't keep playing", async () => {
    // The sidecar streams ~0.5s AHEAD of the playhead (its _PUMP_LEAD_SEC
    // jitter cushion), all buffered in the worklet ring. Pause only stops the
    // pump — without an explicit ring reset the cushion audibly drains for
    // up to a second after the pause click.
    const { root } = await setupLoadedPreview();
    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");

    act(() => {
      liveTime.notify(3);
      usePlayerStore.getState().setIsPlaying(true);
    });
    node.port.postMessage.mockClear();

    act(() => {
      liveTime.notify(3.4);
      usePlayerStore.getState().setIsPlaying(false);
    });

    expect(node.port.postMessage).toHaveBeenCalledWith({
      type: "reset",
      samplePos: Math.floor(3.4 * 48000),
    });

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

  it("floors a fractional seek time to an integer sample position when resetting the worklet", async () => {
    const { root } = await setupLoadedPreview();
    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");

    act(() => usePlayerStore.getState().requestSeek(1.234567));

    // The sidecar streams integer sample positions (`int(timeSec * sr)`), and
    // the ring accepts a block only if its samplePos matches exactly. A
    // fractional reset target (`1.234567 * 48000 = 59259.216`) could never
    // match, so every frame would be rejected and the ring would starve.
    const resetCall = findResetCall(node);
    expect(resetCall?.samplePos).toBe(Math.floor(1.234567 * 48000));
    expect(Number.isInteger(resetCall?.samplePos)).toBe(true);

    act(() => root.unmount());
  });

  it("resets the worklet to the floored live playhead when playback starts", async () => {
    const { root } = await setupLoadedPreview();
    const node = required(FakeAudioWorkletNode.instances[0], "worklet node");
    node.port.postMessage.mockClear();

    // A stale worklet ring from a previous run would reject every new frame;
    // starting playback must realign it to the integer position the sidecar
    // begins streaming from (see the play-path reseek in useVstPreview).
    act(() => {
      liveTime.notify(4.321);
      usePlayerStore.getState().setIsPlaying(true);
    });

    const resetCall = findResetCall(node);
    expect(resetCall?.samplePos).toBe(Math.floor(4.321 * 48000));

    act(() => root.unmount());
  });
});

// ── PCM frame routing ─────────────────────────────────────────────────────────

describe("useVstPreview — incompatible plugin guard", () => {
  it("keeps the track on dry audio and warns when the sidecar reports the chain unstable", async () => {
    const harness = mountHarness("proj-1", {
      version: 1,
      plugins: [
        {
          format: "vst3",
          path: "/x.vst3",
          pluginName: "Weird FX",
          name: "Weird FX",
          stateB64: null,
        },
      ],
    });

    await act(async () => {
      await openFirstSocket();
    });
    await act(async () => {
      await emitChainLoaded({ trackId: "track-1", sampleRate: 48000, stable: false });
    });

    // Dry: the element is never muted and no playback node is created.
    expect(harness.audioEl.muted).toBe(false);
    expect(FakeAudioWorkletNode.instances.length).toBe(0);
    // Warned, naming the offending plugin.
    expect(harness.showToast).toHaveBeenCalledWith(expect.stringContaining("Weird FX"), "error");
    expect(harness.showToast.mock.calls[0]?.[0]).toContain("isn't compatible");

    act(() => harness.root.unmount());
  });
});

describe("useVstPreview — chain removal reconciliation", () => {
  it("tears down the track and unmutes the dry element when its chain is removed", async () => {
    const { root, audioEl } = await setupLoadedPreview();
    // Loaded → the hook muted the dry element to play the wet stream instead.
    expect(audioEl.muted).toBe(true);

    // Simulate the FX panel removing the chain: the attribute is gone from the
    // preview DOM and the elements store refreshes (handleDomAttributeCommit's
    // refreshAfter). The load effect must reconcile — without this it left the
    // element muted forever (silent), and never reloaded a replacement chain.
    await act(async () => {
      audioEl.removeAttribute("data-vst-chain");
      usePlayerStore.getState().setElements([]);
      await flushAsyncWork();
    });

    expect(audioEl.muted).toBe(false); // dry audio restored
    act(() => root.unmount());
  });

  it("re-binds to the fresh element and mutes it after a preview reload replaces the DOM node", async () => {
    const { root, audioEl } = await setupLoadedPreview();
    expect(audioEl.muted).toBe(true);

    // A preview reload replaces the composition DOM: the old <audio> node is
    // gone, a NEW node with the same id/chain takes its place. The old track
    // is now orphaned — it muted the dead node, so the fresh (unmuted) one
    // would play dry. NLEContext bumps vstChainRevision on iframe load to make
    // this reconcile happen; simulate that here.
    audioEl.remove();
    const fresh = document.createElement("audio");
    fresh.id = "track-1";
    fresh.setAttribute("data-vst-chain", "fx/track-1.vstchain.json");
    fresh.setAttribute("src", "/api/projects/proj-1/preview/dry.wav");
    document.body.append(fresh);

    await act(async () => {
      usePlayerStore.getState().bumpVstChainRevision();
      await emitChainLoaded({ trackId: "track-1", sampleRate: 48000, stable: true });
    });

    // The FRESH element is now muted (VST pipeline owns its audio); the old
    // detached node no longer matters. Without the reload reconcile the fresh
    // node stayed unmuted → dry bleed.
    expect(fresh.muted).toBe(true);
    act(() => root.unmount());
  });
});

describe("useVstPreview — chain content swap", () => {
  it("reloads the track when the chain FILE contents change, not the first-loaded effect", async () => {
    // Same element + same data-vst-chain path, but the file's CONTENTS change
    // (the FX panel rewrites it on swap). Element identity is unchanged, so
    // this is caught only by comparing chain contents — the bug was the
    // first-loaded effect streaming forever.
    const chainObj = {
      version: 1,
      plugins: [
        { format: "builtin", path: "Delay", pluginName: null, name: "Delay", stateB64: null },
      ],
    };
    const harness = mountHarness("proj-1", chainObj);

    await act(async () => {
      await openFirstSocket();
    });
    await act(async () => {
      await emitChainLoaded({ trackId: "track-1", sampleRate: 48000, stable: true });
    });
    expect(FakeAudioWorkletNode.instances.length).toBe(1);

    // Swap the effect (rewrite the same file's contents), then re-run the load
    // effect. The old track must be torn down and reloaded from the new chain.
    chainObj.plugins = [
      { format: "builtin", path: "Reverb", pluginName: null, name: "Reverb", stateB64: null },
    ];
    await act(async () => {
      // The real trigger: the FX panel bumps this after rewriting the chain
      // file (a same-path rewrite is invisible to the `elements` signal).
      usePlayerStore.getState().bumpVstChainRevision();
      await emitChainLoaded({ trackId: "track-1", sampleRate: 48000, stable: true });
    });

    // A SECOND worklet node proves the track reloaded (torn down + rebuilt),
    // rather than the first-loaded Delay persisting.
    expect(FakeAudioWorkletNode.instances.length).toBe(2);

    act(() => harness.root.unmount());
  });
});

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

/** Asserts both tracks reverted to unmuted dry playback and a toast fired
 *  naming `messageSubstring` — the shared "both tracks reverted" outcome
 *  several tests below check for (a routing collision, or a disconnect). */
function expectBothTracksRevertedWithToast(
  audioEl1: HTMLAudioElement,
  audioEl2: HTMLAudioElement,
  showToast: ReturnType<typeof vi.fn>,
  messageSubstring: string,
): void {
  expect(audioEl1.muted).toBe(false);
  expect(audioEl2.muted).toBe(false);
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining(messageSubstring), "error");
}

/** Loads two vst-chain tracks (track-1 → index 0, track-2 → index 1) through one shared connection. */
async function setupTwoLoadedTracks(): Promise<TwoTrackHarness> {
  const audioEl1 = document.createElement("audio");
  audioEl1.id = "track-1";
  audioEl1.setAttribute("data-vst-chain", "fx/track-1.vstchain.json");
  audioEl1.setAttribute("src", "/api/projects/proj-1/preview/dry1.wav");
  document.body.append(audioEl1);

  const audioEl2 = document.createElement("audio");
  audioEl2.id = "track-2";
  audioEl2.setAttribute("data-vst-chain", "fx/track-2.vstchain.json");
  audioEl2.setAttribute("src", "/api/projects/proj-1/preview/dry2.wav");
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
  const socket = await connectAndGetSocket();

  await act(async () => {
    await emitChainLoaded({ trackId: "track-1", sampleRate: 48000 });
    await emitChainLoaded({ trackId: "track-2", sampleRate: 48000 });
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
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
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
      socket.emitJson({ event: "chain-loaded", trackId: "track-2", sampleRate: 48000 });
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
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
      await flushAsyncWork();
    });

    // Both tracks reverted to their original (unmuted) dry playback rather
    // than one silently stealing the other's processed audio stream.
    expectBothTracksRevertedWithToast(audioEl1, audioEl2, showToast, "routing conflict");

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

    expectBothTracksRevertedWithToast(audioEl1, audioEl2, showToast, "disconnected");

    // A brand-new track appears in the DOM AFTER the disconnect — one this
    // hook never attempted to load and that was never held by
    // loadedTracksRef, trackOrderRef, OR round 2's (now-removed)
    // unsafeAfterDisconnectRef. Under round 2's narrower per-track tracking
    // this track wouldn't be excluded by anything and would have been
    // blindly loaded once the sidecar reconnected.
    const audioEl3 = document.createElement("audio");
    audioEl3.id = "track-3";
    audioEl3.setAttribute("data-vst-chain", "fx/track-3.vstchain.json");
    audioEl3.setAttribute("src", "/api/projects/proj-1/preview/dry3.wav");
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
      await openFirstSocket();
    });
    const socket = required(FakeSocket.instances[0], "socket");

    await act(async () => {
      await emitChainLoaded({ trackId: "track-1", sampleRate: 48000 });
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
