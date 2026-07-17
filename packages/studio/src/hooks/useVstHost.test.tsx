// @vitest-environment happy-dom

import React, { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import type { ChainFileJson } from "../utils/vstChainFile";
import { mountReactHarness } from "./domSelectionTestHarness";
import { __setSocketFactoryForTests, useVstHost } from "./useVstHost";
import { FakeSocket, required } from "./vstSocketTestFixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Test helpers ──────────────────────────────────────────────────────────────

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

/** Mounts the hook without driving `ensureStarted()` — the caller controls the fetch/socket sequence. */
function mountUnstartedHost(): { getLatest: () => HookResult | null; root: Root } {
  let latest: HookResult | null = null;
  const root = renderVstHost((r) => {
    latest = r;
  });
  return { getLatest: () => latest, root };
}

/**
 * Races `promise` against a short timer to prove it settles on its own
 * (rather than hanging forever) and, if so, whether it rejected. Used by the
 * "superseded" tests below to confirm a pre-empted pending command's promise
 * resolves instead of hanging.
 */
async function raceSettleOutcome(
  promise: Promise<unknown>,
): Promise<{ settled: boolean; rejected: boolean; err: unknown }> {
  const outcome: { settled: boolean; rejected: boolean; err: unknown } = {
    settled: false,
    rejected: false,
    err: null,
  };
  await Promise.race([
    promise.then(
      () => {
        outcome.settled = true;
      },
      (err: unknown) => {
        outcome.settled = true;
        outcome.rejected = true;
        outcome.err = err;
      },
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 100)),
  ]);
  return outcome;
}

/** Asserts a `raceSettleOutcome` result rejected with a "superseded" error. */
function expectSupersededRejection(outcome: {
  settled: boolean;
  rejected: boolean;
  err: unknown;
}): void {
  // If this is false, the promise never settled within 100ms — i.e. it hung.
  expect(outcome.settled).toBe(true);
  expect(outcome.rejected).toBe(true);
  expect(outcome.err).toBeInstanceOf(Error);
  if (outcome.err instanceof Error) {
    expect(outcome.err.message).toMatch(/superseded/);
  }
}

/** Stubs `fetch` with `fetchMock` and calls `ensureStarted()` on a freshly
 *  mounted (not-yet-started) host, swallowing its rejection — the shared
 *  "attempt a start that's expected to fail" shape the tests below need. */
async function ensureStartedFailing(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<{ getLatest: () => HookResult | null; root: Root }> {
  vi.stubGlobal("fetch", fetchMock);
  const { getLatest, root } = mountUnstartedHost();
  await act(async () => {
    await required<HookResult>(getLatest(), "hook result")
      .ensureStarted()
      .catch(() => {});
  });
  return { getLatest, root };
}

async function setupReadyHost(): Promise<{
  getState: () => HookResult;
  socket: FakeSocket;
  root: Root;
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const fetchMock = vi.fn(async () => okStartResponse(4321));
  vi.stubGlobal("fetch", fetchMock);

  const { getLatest, root } = mountUnstartedHost();

  await act(async () => {
    const startPromise = required<HookResult>(getLatest(), "hook result").ensureStarted();
    await flushAsyncWork();
    required<FakeSocket>(FakeSocket.instances[0], "socket instance").open();
    await startPromise;
  });

  return {
    getState: () => required<HookResult>(getLatest(), "hook result"),
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
    const { getLatest, root } = await ensureStartedFailing(vi.fn(async () => missingTokenResponse));

    expect(required<HookResult>(getLatest(), "hook result").status).toBe("failed");
    expect(required<HookResult>(getLatest(), "hook result").api).toBeNull();
    // No socket should ever have been opened without a valid token.
    expect(FakeSocket.instances).toHaveLength(0);

    act(() => root.unmount());
  });

  it("sets status to failed and surfaces installHint when the start request fails", async () => {
    const { getLatest, root } = await ensureStartedFailing(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "no uv", installHint: "install uv" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    expect(required<HookResult>(getLatest(), "hook result").status).toBe("failed");
    expect(required<HookResult>(getLatest(), "hook result").installHint).toBe("install uv");
    expect(required<HookResult>(getLatest(), "hook result").api).toBeNull();

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

    let secondResolved = false;
    let firstOutcome: { settled: boolean; rejected: boolean; err: unknown } = {
      settled: false,
      rejected: false,
      err: null,
    };

    await act(async () => {
      const api = required(getState().api, "api");
      const firstPromise = api.loadChain("track-1", chain, "/abs/dry1.wav");
      await flushAsyncWork();
      const secondPromise = api.loadChain("track-1", chain, "/abs/dry2.wav");
      await flushAsyncWork();

      // Only the second request gets a server reply.
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });

      await secondPromise.then(() => {
        secondResolved = true;
      });

      // The first promise must settle (reject) on its own — it never gets a
      // matching server reply. Race it against a short timer so an unfixed
      // hang fails the test instead of hanging the whole run.
      firstOutcome = await raceSettleOutcome(firstPromise);
    });

    expect(secondResolved).toBe(true);
    expectSupersededRejection(firstOutcome);

    act(() => root.unmount());
  });

  it("a getState for the same track does NOT supersede an in-flight loadChain (different kinds, different consumers)", async () => {
    // Live-repro'd collision: useVstPreview's loadChain and the FX panel's
    // 400ms getState polling run concurrently for the SAME track over this
    // shared connection. With the pending map keyed by trackId alone, each
    // poll clobbered + spuriously rejected the in-flight loadChain
    // ("get-state superseded…"), so on a machine slow enough for the load to
    // still be pending when a poll landed, the track never loaded — silent
    // music, transport forever seeing zero loaded tracks.
    const { getState, socket, root } = await setupReadyHost();
    const chain: ChainFileJson = { version: 1, plugins: [] };

    let loadResult: unknown = null;
    let loadError: unknown = null;
    let stateResult: string[] | null = null;

    await act(async () => {
      const api = required(getState().api, "api");
      const loadPromise = api.loadChain("track-1", chain, "/abs/dry.wav");
      await flushAsyncWork();
      // Panel poll lands while the load is still in flight.
      const statePromise = api.getState("track-1");
      await flushAsyncWork();

      // Sidecar answers both commands, in order.
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
      socket.emitJson({ event: "state", trackId: "track-1", plugins: ["c3RhdGU="] });

      await loadPromise.then(
        (r) => {
          loadResult = r;
        },
        (err: unknown) => {
          loadError = err;
        },
      );
      stateResult = await statePromise;
    });

    expect(loadError).toBeNull(); // the poll must not have rejected the load
    expect(loadResult).toMatchObject({ sampleRate: 48000, stable: true });
    expect(stateResult).toEqual(["c3RhdGU="]);

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

    let secondResult: string[] | null = null;
    let firstOutcome: { settled: boolean; rejected: boolean; err: unknown } = {
      settled: false,
      rejected: false,
      err: null,
    };

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
      firstOutcome = await raceSettleOutcome(firstPromise);
    });

    expect(secondResult).toEqual(["Reverb.vst3"]);
    expectSupersededRejection(firstOutcome);

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
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
      indexTrack1 = (await p1).trackIndex;

      const p2 = api.loadChain("track-2", chain, "/abs/dry2.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-2", sampleRate: 48000 });
      indexTrack2 = (await p2).trackIndex;
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
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
      await p1;

      const p2 = api.loadChain("track-2", chain, "/abs/dry2.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-2", sampleRate: 48000 });
      await p2;

      // Reload track-1's chain (e.g. the FX panel adding/removing an effect).
      const p3 = api.loadChain("track-1", chain, "/abs/dry1.wav");
      await flushAsyncWork();
      socket.emitJson({ event: "chain-loaded", trackId: "track-1", sampleRate: 48000 });
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
      socket.emitJson({ event: "chain-loaded", trackId: "track-9", sampleRate: 48000 });
      await flushAsyncWork();
    });

    expect(observed).toEqual([{ trackId: "track-9", trackIndex: 0 }]);

    required<() => void>(unsubscribe, "unsubscribe")();
    await act(async () => {
      socket.emitJson({ event: "chain-loaded", trackId: "track-9", sampleRate: 48000 });
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

// ── unmount cleanup ───────────────────────────────────────────────────────────
// A genuine unmount (component removed from the tree for good) must close
// any open/in-flight socket — otherwise it keeps streaming from the sidecar
// alongside whatever else is running, which is what a live repro traced back
// to two competing live audio pipelines mixing into one output ("crackling,
// can't tell which track", never recovering).

describe("useVstHost — unmount cleanup", () => {
  it("closes an already-open socket when the hook unmounts", async () => {
    const { socket, root } = await setupReadyHost();

    expect(socket.closed).toBe(false);
    act(() => root.unmount());
    expect(socket.closed).toBe(true);
  });

  it("closes a connection that finishes AFTER unmount instead of leaking it", async () => {
    const fetchMock = vi.fn(async () => okStartResponse(4321));
    vi.stubGlobal("fetch", fetchMock);

    const { getLatest, root } = mountUnstartedHost();

    let ensureStartedPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      ensureStartedPromise = required<HookResult>(getLatest(), "hook result").ensureStarted();
      await flushAsyncWork();
    });

    const socket = required<FakeSocket>(FakeSocket.instances[0], "socket instance");
    // Unmount BEFORE the socket finishes connecting (`open()` never called
    // yet) — simulates a StrictMode phantom mount whose async attempt is
    // still in flight when React discards it.
    act(() => root.unmount());
    expect(socket.closed).toBe(false); // not open yet — nothing to close

    // The connection now resolves, after unmount already ran.
    await act(async () => {
      socket.open();
      await ensureStartedPromise;
    });

    expect(socket.closed).toBe(true);
  });
});

// ── StrictMode double-invoke ──────────────────────────────────────────────────
// React StrictMode (enabled in packages/studio/src/main.tsx, dev-mode only)
// double-invokes effects on mount: mount, cleanup, mount again — on the SAME
// component instance and the SAME refs, not a fresh remount with fresh state.
// A regression here: the unmount-cleanup effect above sets `unmountedRef` to
// `true` unconditionally and nothing ever reset it back to `false` for the
// real, surviving mount — so StrictMode's own diagnostic cleanup pass
// permanently poisoned every later `ensureStarted()` call for the rest of the
// component's real lifetime, closing its own socket immediately after
// connecting. That read as a permanent, unrecoverable "VST host disconnected"
// even on a freshly loaded page — caught only by actually running the hook
// under a real `<StrictMode>` wrapper, not by unmount/remount tests using two
// separate root instances (those don't share refs, so they can't reproduce
// same-instance state leaking across the double-invoke).

describe("useVstHost — StrictMode double-invoke", () => {
  it("still connects successfully after StrictMode's mount/cleanup/mount on the same instance", async () => {
    const fetchMock = vi.fn(async () => okStartResponse(4321));
    vi.stubGlobal("fetch", fetchMock);

    const state: { latest: HookResult | null } = { latest: null };
    function Harness() {
      const result = useVstHost();
      state.latest = result;
      return null;
    }
    const root = mountReactHarness(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    await act(async () => {
      const startPromise = required<HookResult>(state.latest, "hook result").ensureStarted();
      await flushAsyncWork();
      required<FakeSocket>(FakeSocket.instances[0], "socket instance").open();
      await startPromise;
    });

    // The connection StrictMode's phantom cleanup pass may have closed is a
    // separate, expected socket instance — what matters is the CURRENT state
    // the component ends up in after settling.
    expect(state.latest?.status).toBe("ready");
    expect(state.latest?.api).not.toBeNull();

    act(() => root.unmount());
  });
});
