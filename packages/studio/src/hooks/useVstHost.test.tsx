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

function okStartResponse(port: number): Response {
  return new Response(JSON.stringify({ port }), {
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
