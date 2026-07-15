/**
 * React hook that lazily starts the VST sidecar (`POST /api/vst/start`,
 * built in Task 10) and manages a WebSocket connection to it, implementing
 * the `VstHostApi` interface `propertyPanelVstSection.tsx` (Task 11)
 * consumes but doesn't provide.
 *
 * Protocol (see `packages/vst-host/src/hyperframes_vst/server.py`): JSON text
 * frames for control commands/events, raw binary `ArrayBuffer` frames for
 * interleaved-stereo PCM (`u32 trackIndex` + `f64 samplePos` + `f32` samples)
 * that this hook forwards unopened to `onPcmFrame` subscribers — decoding is
 * Task 13's job.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { VstHostApi, VstRegistryEntry } from "../components/editor/propertyPanelVstSection";
import { isRecord, type ChainFileJson } from "../utils/vstChainFile";

// ── Socket injection seam ─────────────────────────────────────────────────────
// Production code just calls `new WebSocket(url)`. Tests substitute a fake via
// `__setSocketFactoryForTests` (module-level override) instead of requiring
// every caller to thread a WebSocket implementation through the hook's API.
// `VstSocketLike` is a `Pick` of the real DOM `WebSocket` type, so a real
// `WebSocket` instance is always assignable to it and a hand-written fake only
// needs to match these members (see useVstHost.test.tsx's `FakeSocket`).

export type VstSocketLike = Pick<
  WebSocket,
  "binaryType" | "onopen" | "onclose" | "onerror" | "onmessage" | "send" | "close"
>;

type SocketFactory = (url: string) => VstSocketLike;

let createSocket: SocketFactory = (url) => new WebSocket(url);

/** Test-only: override (or, passed `null`, restore) the socket constructor. */
export function __setSocketFactoryForTests(factory: SocketFactory | null): void {
  createSocket = factory ?? ((url) => new WebSocket(url));
}

// ── Public types ──────────────────────────────────────────────────────────────

export type VstHostStatus = "idle" | "starting" | "ready" | "failed";

/** Mirrors the sidecar's `{"cmd":"transport",...}` command (see server.py's `_transport`). */
export type TransportMsg =
  | { action: "play"; timeSec?: number; rate?: number }
  | { action: "pause" }
  | { action: "seek"; timeSec: number };

export interface UseVstHostResult {
  api: VstHostApi | null;
  status: VstHostStatus;
  installHint: string | null;
  /** Idempotent: posts `/api/vst/start` and opens the WS at most once per connection attempt. */
  ensureStarted: () => Promise<void>;
  onPcmFrame: (cb: (frame: ArrayBuffer) => void) => () => void;
  sendTransport: (msg: TransportMsg) => void;
  onDisconnect: (cb: () => void) => () => void;
  /**
   * Broadcasts every `chain-loaded` event this connection sees, regardless of
   * which caller's `loadChain()` triggered it — the sidecar reassigns a
   * track's numeric wire `trackIndex` on every reload (see
   * `assignNextTrackIndex` below), so a consumer holding an earlier index for
   * `trackId` (e.g. `useVstPreview`, if the FX panel reloads a chain it
   * already streamed) must resync from this, not just its own `loadChain`
   * call's resolved value.
   */
  onChainLoaded: (cb: (trackId: string, trackIndex: number) => void) => () => void;
}

// ── Server → client event parsing ─────────────────────────────────────────────

function isRegistryEntry(value: unknown): value is VstRegistryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.format === "string"
  );
}

type ParsedServerEvent =
  | { kind: "registry"; plugins: VstRegistryEntry[] }
  | { kind: "chain-loaded"; trackId: string }
  | { kind: "state"; trackId: string; plugins: string[] }
  | { kind: "error"; code: string; plugin: string | null; trackId: string | null };

// fallow-ignore-next-line complexity
function parseServerEvent(raw: string): ParsedServerEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  if (parsed.event === "registry") {
    const rawPlugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
    return { kind: "registry", plugins: rawPlugins.filter(isRegistryEntry) };
  }
  if (parsed.event === "chain-loaded" && typeof parsed.trackId === "string") {
    return { kind: "chain-loaded", trackId: parsed.trackId };
  }
  if (parsed.event === "state" && typeof parsed.trackId === "string") {
    const rawPlugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
    return {
      kind: "state",
      trackId: parsed.trackId,
      plugins: rawPlugins.filter((p): p is string => typeof p === "string"),
    };
  }
  if (parsed.event === "error") {
    return {
      kind: "error",
      code: typeof parsed.code === "string" ? parsed.code : "unknown",
      plugin: typeof parsed.plugin === "string" ? parsed.plugin : null,
      trackId: typeof parsed.trackId === "string" ? parsed.trackId : null,
    };
  }
  return null;
}

// ── Pending request bookkeeping ───────────────────────────────────────────────

type PendingTrackEntry =
  | { kind: "load-chain"; resolve: (trackIndex: number) => void; reject: (err: Error) => void }
  | { kind: "get-state"; resolve: (states: string[]) => void; reject: (err: Error) => void };

interface PendingScanEntry {
  resolve: () => void;
  reject: (err: Error) => void;
}

const DISCONNECTED_ERROR = "VST sidecar disconnected";

interface EventDispatchRefs {
  registry: VstRegistryEntry[];
  pendingScan: { current: PendingScanEntry | null };
  pendingTrack: Map<string, PendingTrackEntry>;
  trackIndex: Map<string, number>;
  chainLoadedListeners: Set<(trackId: string, trackIndex: number) => void>;
}

/**
 * Mirrors the sidecar's exact index-assignment rule (server.py's `_dispatch`,
 * `cmd == "load-chain"`):
 *
 *   old = self._tracks.pop(track_id, None)          # drop any existing entry
 *   self._tracks[track_id] = TrackStream(len(self._tracks), ...)  # reinsert at the end
 *
 * A Python dict (like a JS `Map`) preserves insertion order and moves a
 * re-inserted key to the end, so replaying "delete-if-present, then set" with
 * `map.size` as the new index reproduces the server's numbering exactly —
 * including its one real flaw: reloading a track can hand it the same index
 * another still-loaded track already holds (the pop briefly shrinks the map
 * below that other track's assigned position). This function does not paper
 * over that; it exists so a client can detect a collision, since it now
 * assigns indices with the identical rule the server uses.
 */
function assignNextTrackIndex(map: Map<string, number>, trackId: string): number {
  map.delete(trackId);
  const index = map.size;
  map.set(trackId, index);
  return index;
}

/** Resolves/rejects the pending request a server event answers, keyed as described in the module doc. */
function applyServerEvent(parsed: ParsedServerEvent, refs: EventDispatchRefs): void {
  switch (parsed.kind) {
    case "registry":
      applyRegistryEvent(parsed.plugins, refs);
      return;
    case "chain-loaded":
      applyChainLoadedEvent(parsed.trackId, refs);
      return;
    case "state":
      applyStateEvent(refs.pendingTrack, parsed.trackId, parsed.plugins);
      return;
    case "error":
      applyErrorEvent(parsed, refs);
      return;
  }
}

function applyRegistryEvent(plugins: VstRegistryEntry[], refs: EventDispatchRefs): void {
  refs.registry.length = 0;
  refs.registry.push(...plugins);
  const scanPending = refs.pendingScan.current;
  refs.pendingScan.current = null;
  scanPending?.resolve();
}

/** `error` has no trackId when replying to `scan` (the only non-track-scoped command). */
function applyErrorEvent(
  parsed: Extract<ParsedServerEvent, { kind: "error" }>,
  refs: EventDispatchRefs,
): void {
  const message = parsed.plugin ?? parsed.code;
  if (parsed.trackId === null) {
    const scanPending = refs.pendingScan.current;
    refs.pendingScan.current = null;
    scanPending?.reject(new Error(message));
    return;
  }
  const entry = refs.pendingTrack.get(parsed.trackId);
  if (entry) {
    refs.pendingTrack.delete(parsed.trackId);
    entry.reject(new Error(message));
  }
}

/**
 * Always advances the mirrored index map and broadcasts to every
 * `onChainLoaded` subscriber — regardless of whether THIS connection's
 * pending map has a matching `load-chain` request — so a consumer who loaded
 * a track earlier (and isn't the caller of the reload that produced this
 * event) still hears about its new trackIndex.
 */
function applyChainLoadedEvent(trackId: string, refs: EventDispatchRefs): void {
  const trackIndex = assignNextTrackIndex(refs.trackIndex, trackId);

  const entry = refs.pendingTrack.get(trackId);
  if (entry?.kind === "load-chain") {
    refs.pendingTrack.delete(trackId);
    entry.resolve(trackIndex);
  }

  refs.chainLoadedListeners.forEach((cb) => cb(trackId, trackIndex));
}

function applyStateEvent(
  pendingTrack: Map<string, PendingTrackEntry>,
  trackId: string,
  plugins: string[],
): void {
  const entry = pendingTrack.get(trackId);
  if (entry?.kind !== "get-state") return;
  pendingTrack.delete(trackId);
  entry.resolve(plugins);
}

// ── Start + connect (module-level so each stays a small, single-purpose unit) ──

type StartOutcome =
  | { ok: true; port: number }
  | { ok: false; installHint: string | null; message: string };

/** Parses `/api/vst/start`'s response body (see routes/vst.ts) into a `StartOutcome`. */
function parseStartResponse(response: Response, body: unknown): StartOutcome {
  if (!response.ok) {
    const hint = isRecord(body) && typeof body.installHint === "string" ? body.installHint : null;
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : "VST sidecar failed to start";
    return { ok: false, installHint: hint, message };
  }
  const port = isRecord(body) && typeof body.port === "number" ? body.port : null;
  if (port === null) {
    return { ok: false, installHint: null, message: "VST sidecar start response missing port" };
  }
  return { ok: true, port };
}

async function requestVstStart(): Promise<StartOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/vst/start", { method: "POST" });
  } catch (err) {
    return {
      ok: false,
      installHint: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const body: unknown = await response.json().catch(() => null);
  return parseStartResponse(response, body);
}

interface SocketHandlers {
  onMessage: (ev: MessageEvent) => void;
  onReady: () => void;
  onDisconnect: () => void;
}

/** Opens the sidecar WS and resolves once it's open (or rejects if it closes first). */
function connectVstSocket(port: number, handlers: SocketHandlers): Promise<VstSocketLike> {
  return new Promise<VstSocketLike>((resolve, reject) => {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const socket = createSocket(`ws://${host}:${port}`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      handlers.onReady();
      resolve(socket);
    };
    socket.onmessage = handlers.onMessage;
    socket.onclose = () => {
      handlers.onDisconnect();
      reject(new Error("VST sidecar socket closed before opening"));
    };
    socket.onerror = () => {
      handlers.onDisconnect();
    };
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVstHost(): UseVstHostResult {
  const [status, setStatus] = useState<VstHostStatus>("idle");
  const [installHint, setInstallHint] = useState<string | null>(null);

  const socketRef = useRef<VstSocketLike | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const handledDisconnectRef = useRef(false);

  // Mutated in place (never reassigned) so any `api` snapshot handed to a
  // caller keeps seeing fresh contents after `scan()` resolves, matching how
  // propertyPanelVstSection.tsx re-reads `vstHost.registry` after awaiting scan.
  const registryRef = useRef<VstRegistryEntry[]>([]);

  const pendingScanRef = useRef<PendingScanEntry | null>(null);
  const pendingTrackRef = useRef<Map<string, PendingTrackEntry>>(new Map());

  // Mirrors the sidecar's `self._tracks` insertion order (see
  // `assignNextTrackIndex`) — mutated in place, never reassigned, same
  // rationale as `registryRef` above.
  const trackIndexRef = useRef<Map<string, number>>(new Map());
  const chainLoadedListenersRef = useRef<Set<(trackId: string, trackIndex: number) => void>>(
    new Set(),
  );

  const pcmListenersRef = useRef<Set<(frame: ArrayBuffer) => void>>(new Set());
  const disconnectListenersRef = useRef<Set<() => void>>(new Set());

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    socketRef.current?.send(JSON.stringify(payload));
  }, []);

  const handleDisconnect = useCallback(() => {
    if (handledDisconnectRef.current) return;
    handledDisconnectRef.current = true;
    setStatus("failed");

    const scanPending = pendingScanRef.current;
    pendingScanRef.current = null;
    scanPending?.reject(new Error(DISCONNECTED_ERROR));

    for (const entry of pendingTrackRef.current.values()) {
      entry.reject(new Error(DISCONNECTED_ERROR));
    }
    pendingTrackRef.current.clear();

    // A reconnect starts a fresh sidecar process with an empty `_tracks`
    // dict (see `ensureStarted`'s `/api/vst/start` re-POST) — the mirrored
    // index map must reset with it, or a track loaded before the crash would
    // wrongly appear to already hold an index on the new connection.
    trackIndexRef.current.clear();

    disconnectListenersRef.current.forEach((cb) => cb());
  }, []);

  const handleMessage = useCallback((ev: MessageEvent) => {
    // `MessageEvent.data` is typed `any` in lib.dom — no cast needed to pass
    // it through to a `(frame: ArrayBuffer) => void` subscriber once the
    // `instanceof` check below confirms it's actually a binary frame.
    if (ev.data instanceof ArrayBuffer) {
      pcmListenersRef.current.forEach((cb) => cb(ev.data));
      return;
    }
    if (typeof ev.data !== "string") return;

    const parsed = parseServerEvent(ev.data);
    if (!parsed) return;

    applyServerEvent(parsed, {
      registry: registryRef.current,
      pendingScan: pendingScanRef,
      pendingTrack: pendingTrackRef.current,
      trackIndex: trackIndexRef.current,
      chainLoadedListeners: chainLoadedListenersRef.current,
    });
  }, []);

  // ── ensureStarted ───────────────────────────────────────────────────────────

  const ensureStarted = useCallback((): Promise<void> => {
    if (status === "ready" && socketRef.current) return Promise.resolve();
    if (startPromiseRef.current) return startPromiseRef.current;

    setStatus("starting");
    setInstallHint(null);
    handledDisconnectRef.current = false;

    const attempt = (async () => {
      const outcome = await requestVstStart();
      if (!outcome.ok) {
        setInstallHint(outcome.installHint);
        setStatus("failed");
        throw new Error(outcome.message);
      }

      const socket = await connectVstSocket(outcome.port, {
        onMessage: handleMessage,
        onReady: () => setStatus("ready"),
        onDisconnect: handleDisconnect,
      });
      socketRef.current = socket;
    })();

    const settled = attempt.finally(() => {
      startPromiseRef.current = null;
    });
    startPromiseRef.current = settled;
    return settled;
  }, [status, handleMessage, handleDisconnect]);

  // ── VstHostApi methods ──────────────────────────────────────────────────────

  const scan = useCallback((): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const previous = pendingScanRef.current;
      previous?.reject(new Error("scan superseded by a new scan"));
      pendingScanRef.current = { resolve, reject };
      sendJson({ cmd: "scan" });
    });
  }, [sendJson]);

  const openEditor = useCallback(
    (trackId: string, pluginIndex: number): void => {
      sendJson({ cmd: "open-editor", trackId, pluginIndex });
    },
    [sendJson],
  );

  const loadChain = useCallback(
    (trackId: string, chain: ChainFileJson, wavUrl: string): Promise<number> => {
      return new Promise<number>((resolve, reject) => {
        const previous = pendingTrackRef.current.get(trackId);
        previous?.reject(
          new Error(`load-chain superseded by a new request for track "${trackId}"`),
        );
        pendingTrackRef.current.set(trackId, { kind: "load-chain", resolve, reject });
        sendJson({ cmd: "load-chain", trackId, chainJson: chain, wavPath: wavUrl });
      });
    },
    [sendJson],
  );

  const getState = useCallback(
    (trackId: string): Promise<string[]> => {
      return new Promise<string[]>((resolve, reject) => {
        const previous = pendingTrackRef.current.get(trackId);
        previous?.reject(new Error(`get-state superseded by a new request for track "${trackId}"`));
        pendingTrackRef.current.set(trackId, { kind: "get-state", resolve, reject });
        sendJson({ cmd: "get-state", trackId });
      });
    },
    [sendJson],
  );

  const api = useMemo<VstHostApi>(
    () => ({
      registry: registryRef.current,
      scan,
      openEditor,
      loadChain,
      getState,
    }),
    [scan, openEditor, loadChain, getState],
  );

  // ── Transport + subscribers ──────────────────────────────────────────────────

  const sendTransport = useCallback(
    (msg: TransportMsg): void => {
      sendJson({ cmd: "transport", ...msg });
    },
    [sendJson],
  );

  const onPcmFrame = useCallback((cb: (frame: ArrayBuffer) => void): (() => void) => {
    pcmListenersRef.current.add(cb);
    return () => {
      pcmListenersRef.current.delete(cb);
    };
  }, []);

  const onDisconnect = useCallback((cb: () => void): (() => void) => {
    disconnectListenersRef.current.add(cb);
    return () => {
      disconnectListenersRef.current.delete(cb);
    };
  }, []);

  const onChainLoaded = useCallback(
    (cb: (trackId: string, trackIndex: number) => void): (() => void) => {
      chainLoadedListenersRef.current.add(cb);
      return () => {
        chainLoadedListenersRef.current.delete(cb);
      };
    },
    [],
  );

  return {
    api: status === "ready" ? api : null,
    status,
    installHint,
    ensureStarted,
    onPcmFrame,
    sendTransport,
    onDisconnect,
    onChainLoaded,
  };
}
