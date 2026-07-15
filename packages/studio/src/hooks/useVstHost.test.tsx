// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import type { ChainFileJson } from "../utils/vstChainFile";
import { mountReactHarness } from "./domSelectionTestHarness";
import { __setSocketFactoryForTests, useVstHost, type VstSocketLike } from "./useVstHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fake WebSocket ────────────────────────────────────────────────────────────
// The hook is injected a socket factory (module-level override, see
// __setSocketFactoryForTests) rather than requiring callers to pass a
// WebSocket implementation — production code just calls `new WebSocket(url)`.

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

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Narrows away `null`/`undefined` without a `!` assertion (repo convention). */
function required<T>(value: T | null | undefined, label = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} was unexpectedly missing`);
  }
  return value;
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

type HookResult = ReturnType<typeof useVstHost>;

function renderVstHost(onReady: (result: HookResult) => void): Root {
  function Harness() {
    const result = useVstHost();
    onReady(result);
    return null;
  }
  return mountReactHarness(<Harness />);
}

const TEST_TOKEN = "test-token-abc123";

function okStartResponse(port: number, token: string = TEST_TOKEN): Response {
  return new Response(JSON.stringify({ port, token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function setupReadyHost(): Promise<{
  getState: () => HookResult;
  socket: FakeSocket;
  root: Root;
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const fetchMock = vi.fn(async () => okStartResponse(4321));
  vi.stubGlobal("fetch", fetchMock);

  let latest: HookResult | null = null;
  const root = renderVstHost((r) => {
    latest = r;
  });

  await act(async () => {
    const startPromise = required<HookResult>(latest, "hook result").ensureStarted();
    await flushAsyncWork();
    required<FakeSocket>(FakeSocket.instances[0], "socket instance").open();
    await startPromise;
  });

  return {
    getState: () => required<HookResult>(latest, "hook result"),
    socket: required<FakeSocket>(FakeSocket.instances[0], "socket instance"),
    root,
    fetchMock,
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
  __setSocketFactoryForTests((url) => new FakeSocket(url));
});

afterEach(() => {
  document.body.innerHTML = "";
  __setSocketFactoryForTests(null);
  vi.unstubAllGlobals();
});

// ── ensureStarted ─────────────────────────────────────────────────────────────

describe("useVstHost — ensureStarted", () => {
  it("posts to /api/vst/start once and opens a socket to the returned port", async () => {
    const { getState, socket, root, fetchMock } = await setupReadyHost();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/vst/start");
    expect(socket.url).toContain(":4321");
    expect(getState().status).toBe("ready");
    expect(getState().api).not.toBeNull();

    // A second call while already ready must not re-POST.
    await act(async () => {
      await getState().ensureStarted();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  // Finding 2 (final whole-branch review): the sidecar requires a
  // shared-secret token (see server.py's `_authenticate`) on every
  // connection — `/vst/start` relays it, and the client must thread it into
  // the WS URL as a `?token=` query param or the sidecar's handshake hook
  // rejects the upgrade before any command can be sent.
  it("connects with the token from /api/vst/start as a ?token= query param", async () => {
    const { socket, root } = await setupReadyHost();

    expect(socket.url).toContain(`token=${TEST_TOKEN}`);

    act(() => root.unmount());
  });

  it("fails to start when the response is missing a token", async () => {
    // A response body missing `token` entirely (not just empty) — simulates
    // a studio-server build that hasn't relayed it yet.
    const missingTokenResponse = new Response(JSON.stringify({ port: 4321 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi.fn(async () => missingTokenResponse);
    vi.stubGlobal("fetch", fetchMock);

    let latest: HookResult | null = null;
    const root = renderVstHost((r) => {
      latest = r;
    });

    await act(async () => {
      await required<HookResult>(latest, "hook result")
        .ensureStarted()
        .catch(() => {});
    });

    expect(required<HookResult>(latest, "hook result").status).toBe("failed");
    expect(required<HookResult>(latest, "hook result").api).toBeNull();
    // No socket should ever have been opened without a valid token.
    expect(FakeSocket.instances).toHaveLength(0);

    act(() => root.unmount());
  });

  it("sets status to failed and surfaces installHint when the start request fails", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "no uv", installHint: "install uv" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let latest: HookResult | null = null;
    const root = renderVstHost((r) => {
      latest = r;
    });

    await act(async () => {
      await required<HookResult>(latest, "hook result")
        .ensureStarted()
        .catch(() => {});
    });

    expect(required<HookResult>(latest, "hook result").status).toBe("failed");
    expect(required<HookResult>(latest, "hook result").installHint).toBe("install uv");
    expect(required<HookResult>(latest, "hook result").api).toBeNull();

    act(() => root.unmount());
  });
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe("useVstHost — scan", () => {
  it("resolves when a registry event arrives and updates api.registry", async () => {
    const { getState, socket, root } = await setupReadyHost();

    let scanPromise: Promise<void> | null = null;
    await act(async () => {
      const api = required(getState().api, "api");
      scanPromise = api.scan();
      await flushAsyncWork();
      socket.emitJson({
        event: "registry",
        plugins: [{ path: "/plugins/Reverb.vst3", name: "Reverb", format: "vst3" }],
      });
      await required(scanPromise, "scan promise");
    });

    expect(required(getState().api, "api").registry).toEqual([
      { path: "/plugins/Reverb.vst3", name: "Reverb", format: "vst3" },
    ]);

    act(() => root.unmount());
  });
});

// ── loadChain ─────────────────────────────────────────────────────────────────

describe("useVstHost — loadChain", () => {
  it("rejects with the plugin name on a plugin_missing error for that trackId", async () => {
    const { getState, socket, root } = await setupReadyHost();
    const chain: ChainFileJson = { version: 1, plugins: [] };

    let rejection: unknown;
    await act(async () => {
      const api = required(getState().api, "api");
      const loadPromise = api.loadChain("track-1", chain, "/abs/dry.wav");
      await flushAsyncWork();
      socket.emitJson({
        event: "error",
        code: "plugin_missing",
        plugin: "Missing FX",
        trackId: "track-1",
      });
      await loadPromise.catch((err: unknown) => {
        rejection = err;
      });
    });

    expect(rejection).toBeInstanceOf(Error);
    if (rejection instanceof Error) {
      expect(rejection.message).toBe("Missing FX");
    }

    const sentLoadChain = socket.sent.find((raw) => raw.includes('"cmd":"load-chain"'));
    expect(sentLoadChain).toBeDefined();
    expect(sentLoadChain).toContain('"wavPath":"/abs/dry.wav"');

    act(() => root.unmount());
  });

  it("rejects the first call's promise as superseded when a second loadChain for the same trackId is issued first", async () => {
    const { getState, socket, root } = await setupReadyHost();
    const chain: ChainFileJson = { version: 1, plugins: [] };

    const firstOutcome: { settled: boolean; rejected: boolean; err: unknown } = {
      settled: false,
      rejected: false,
      err: null,
    };
    let secondResolved = false;

    await act(async () => {
      const api = required(getState().api, "api");
      const firstPromise = api.loadChain("track-1", chain, "/abs/dry1.wav");
      await flushAsyncWork();
      const secondPromise = api.loadChain("track-1", chain, "/abs/dry2.wav");
      await flushAsyncWork();

      // Only the second request gets a server reply.
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });

      await secondPromise.then(() => {
        secondResolved = true;
      });

      // The first promise must settle (reject) on its own — it never gets a
      // matching server reply. Race it against a short timer so an unfixed
      // hang fails the test instead of hanging the whole run.
      await Promise.race([
        firstPromise.then(
          () => {
            firstOutcome.settled = true;
          },
          (err: unknown) => {
            firstOutcome.settled = true;
            firstOutcome.rejected = true;
            firstOutcome.err = err;
          },
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
    });

    expect(secondResolved).toBe(true);
    // If this is false, the first promise never settled within 100ms — i.e. it hung.
    expect(firstOutcome.settled).toBe(true);
    expect(firstOutcome.rejected).toBe(true);
    expect(firstOutcome.err).toBeInstanceOf(Error);
    if (firstOutcome.err instanceof Error) {
      expect(firstOutcome.err.message).toMatch(/superseded/);
    }

    act(() => root.unmount());
  });
});

// ── getState ──────────────────────────────────────────────────────────────────

describe("useVstHost — getState", () => {
  it("resolves with the plugin list from a matching state event", async () => {
    const { getState, socket, root } = await setupReadyHost();

    let result: string[] | null = null;
    await act(async () => {
      const api = required(getState().api, "api");
      const statePromise = api.getState("track-1");
      await flushAsyncWork();
      socket.emitJson({ event: "state", trackId: "track-1", plugins: ["Reverb.vst3"] });
      result = await statePromise;
    });

    expect(result).toEqual(["Reverb.vst3"]);

    act(() => root.unmount());
  });

  it("rejects the first call's promise as superseded when a second getState for the same trackId is issued first", async () => {
    const { getState, socket, root } = await setupReadyHost();

    const firstOutcome: { settled: boolean; rejected: boolean; err: unknown } = {
      settled: false,
      rejected: false,
      err: null,
    };
    let secondResult: string[] | null = null;

    await act(async () => {
      const api = required(getState().api, "api");
      const firstPromise = api.getState("track-1");
      await flushAsyncWork();
      const secondPromise = api.getState("track-1");
      await flushAsyncWork();

      // Only the second request gets a server reply.
      socket.emitJson({ event: "state", trackId: "track-1", plugins: ["Reverb.vst3"] });

      secondResult = await secondPromise;

      // The first promise must settle (reject) on its own — it never gets a
      // matching server reply. Race it against a short timer so an unfixed
      // hang fails the test instead of hanging the whole run.
      await Promise.race([
        firstPromise.then(
          () => {
            firstOutcome.settled = true;
          },
          (err: unknown) => {
            firstOutcome.settled = true;
            firstOutcome.rejected = true;
            firstOutcome.err = err;
          },
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
    });

    expect(secondResult).toEqual(["Reverb.vst3"]);
    // If this is false, the first promise never settled within 100ms — i.e. it hung.
    expect(firstOutcome.settled).toBe(true);
    expect(firstOutcome.rejected).toBe(true);
    expect(firstOutcome.err).toBeInstanceOf(Error);
    if (firstOutcome.err instanceof Error) {
      expect(firstOutcome.err.message).toMatch(/superseded/);
    }

    act(() => root.unmount());
  });
});

// ── trackIndex mirroring + onChainLoaded ───────────────────────────────────────

describe("useVstHost — trackIndex mirroring", () => {
  it("resolves loadChain with the sidecar's assigned trackIndex per trackId", async () => {
    const { getState, socket, root } = await setupReadyHost();
    const chain: ChainFileJson = { version: 1, plugins: [] };

    let indexTrack1 = -1;
    let indexTrack2 = -1;
    await act(async () => {
      const api = required(getState().api, "api");
      const p1 = api.loadChain("track-1", chain, "/abs/dry1.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
      indexTrack1 = await p1;

      const p2 = api.loadChain("track-2", chain, "/abs/dry2.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-2" });
      indexTrack2 = await p2;
    });

    expect(indexTrack1).toBe(0);
    expect(indexTrack2).toBe(1);

    act(() => root.unmount());
  });

  it("mirrors the server's pop-then-reinsert rule: reloading an earlier track can reuse a later track's index", async () => {
    // Mirrors stream.py's server-side rule exactly (see assignNextTrackIndex's
    // doc-comment): `self._tracks.pop(track_id, None)` then
    // `TrackStream(len(self._tracks), ...)`. Two tracks loaded in order get
    // indices 0 and 1; reloading the FIRST one pops it (leaving one entry),
    // so it's reassigned `len == 1` — the same index track-2 already holds.
    // This is the real collision the sidecar's own design can produce, not a
    // client-side bug — the assertion below documents that faithfully
    // mirroring the server surfaces the same number, so a subscriber can at
    // least detect it (see useVstPreview's onChainLoaded handler).
    const { getState, socket, root } = await setupReadyHost();
    const chain: ChainFileJson = { version: 1, plugins: [] };

    const seenIndexes: Record<string, number> = {};
    await act(async () => {
      const api = required(getState().api, "api");
      getState().onChainLoaded((trackId, trackIndex) => {
        seenIndexes[trackId] = trackIndex;
      });

      const p1 = api.loadChain("track-1", chain, "/abs/dry1.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
      await p1;

      const p2 = api.loadChain("track-2", chain, "/abs/dry2.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-2" });
      await p2;

      // Reload track-1's chain (e.g. the FX panel adding/removing an effect).
      const p3 = api.loadChain("track-1", chain, "/abs/dry1.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-1" });
      await p3;
    });

    expect(seenIndexes["track-2"]).toBe(1);
    expect(seenIndexes["track-1"]).toBe(1); // reassigned — now collides with track-2

    act(() => root.unmount());
  });

  it("broadcasts a chain-loaded event to every onChainLoaded subscriber, not just the calling promise", async () => {
    const { getState, socket, root } = await setupReadyHost();

    const observed: Array<{ trackId: string; trackIndex: number }> = [];
    let unsubscribe: (() => void) | null = null;

    await act(async () => {
      unsubscribe = getState().onChainLoaded((trackId, trackIndex) => {
        observed.push({ trackId, trackIndex });
      });

      // Nobody is awaiting a loadChain promise here — the event still fires.
      socket.emitJson({ event: "chain-loaded", trackId: "track-9" });
      await flushAsyncWork();
    });

    expect(observed).toEqual([{ trackId: "track-9", trackIndex: 0 }]);

    required<() => void>(unsubscribe, "unsubscribe")();
    await act(async () => {
      socket.emitJson({ event: "chain-loaded", trackId: "track-9" });
      await flushAsyncWork();
    });
    expect(observed).toHaveLength(1); // no further notifications after unsubscribing

    act(() => root.unmount());
  });
});

// ── PCM frames ────────────────────────────────────────────────────────────────

describe("useVstHost — onPcmFrame", () => {
  it("forwards a raw binary frame to subscribers without decoding it", async () => {
    const { getState, socket, root } = await setupReadyHost();

    const received: ArrayBuffer[] = [];
    const unsubscribe = getState().onPcmFrame((frame) => received.push(frame));

    const buf = new ArrayBuffer(16);
    act(() => {
      socket.emitBinary(buf);
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(buf);

    unsubscribe();
    act(() => {
      socket.emitBinary(new ArrayBuffer(4));
    });
    expect(received).toHaveLength(1);

    act(() => root.unmount());
  });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe("useVstHost — disconnect", () => {
  it("fires onDisconnect subscribers and flips status to failed when the socket closes", async () => {
    const { getState, socket, root } = await setupReadyHost();

    const disconnects: number[] = [];
    getState().onDisconnect(() => disconnects.push(1));

    await act(async () => {
      socket.close();
      await flushAsyncWork();
    });

    expect(disconnects).toHaveLength(1);
    expect(getState().status).toBe("failed");
    expect(getState().api).toBeNull();

    act(() => root.unmount());
  });
});
