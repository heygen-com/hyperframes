/**
 * React hook that lazily starts the VST sidecar (`POST /api/vst/start`,
 * built in Task 10) and manages a WebSocket connection to it, implementing
 * the `VstHostApi` interface `propertyPanelVstSection.tsx` (Task 11)
 * consumes but doesn't provide.
 *
 * The wire protocol (control-JSON parsing, binary-PCM passthrough, the
 * pending-request bookkeeping, and the `/api/vst/start` + WebSocket connect
 * sequence) lives in `vstHostWire.ts` — this file is just the React
 * lifecycle: refs, effects, and the `VstHostApi` methods built on top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LoadChainResult,
  VstHostApi,
  VstRegistryEntry,
} from "../components/editor/propertyPanelVstSection";
import type { ChainFileJson } from "../utils/vstChainFile";
import {
  connectVstSocket,
  DISCONNECTED_ERROR,
  parseServerEvent,
  applyServerEvent,
  pendingKey,
  requestVstStart,
  type PendingScanEntry,
  type PendingTrackEntry,
  type VstSocketLike,
} from "./vstHostWire";

export { __setSocketFactoryForTests, type VstSocketLike } from "./vstHostWire";

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
   * `assignNextTrackIndex` in vstHostWire.ts), so a consumer holding an
   * earlier index for `trackId` (e.g. `useVstPreview`, if the FX panel
   * reloads a chain it already streamed) must resync from this, not just its
   * own `loadChain` call's resolved value.
   */
  onChainLoaded: (cb: (trackId: string, trackIndex: number) => void) => () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVstHost(): UseVstHostResult {
  const [status, setStatus] = useState<VstHostStatus>("idle");
  const [installHint, setInstallHint] = useState<string | null>(null);

  const socketRef = useRef<VstSocketLike | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const handledDisconnectRef = useRef(false);
  // Set while this hook instance is unmounted — checked by `ensureStarted`'s
  // async attempt after its socket finishes connecting, so a connect that
  // resolves AFTER unmount closes the now-orphaned socket instead of leaving
  // it open. Without this, an unmounted instance's in-flight connection isn't
  // cancellable (a `useEffect` cleanup can't interrupt a promise already in
  // flight), so the socket stays open and keeps streaming from the sidecar
  // alongside whichever instance actually remounted — two live audio
  // pipelines mixing into the same output is what reads as "crackling, can't
  // tell which track" and a stream that never recovers.
  //
  // React StrictMode (dev mode) double-invokes this effect on the SAME
  // component instance — mount, cleanup, mount again — not a fresh instance
  // with a fresh ref. The reset at the top of the effect body is required:
  // without it, StrictMode's own diagnostic cleanup pass permanently flips
  // this to `true` and every later `ensureStarted()` call for the rest of
  // the component's real lifetime sees a stale "unmounted" flag and closes
  // its own socket immediately — READING AS A PERMANENT, UNRECOVERABLE
  // "VST host disconnected" even on a freshly loaded page.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      socketRef.current?.close();
    };
  }, []);

  // Mutated in place (never reassigned) so any `api` snapshot handed to a
  // caller keeps seeing fresh contents after `scan()` resolves, matching how
  // propertyPanelVstSection.tsx re-reads `vstHost.registry` after awaiting scan.
  const registryRef = useRef<VstRegistryEntry[]>([]);

  const pendingScanRef = useRef<PendingScanEntry | null>(null);
  const pendingTrackRef = useRef<Map<string, PendingTrackEntry>>(new Map());

  // Mirrors the sidecar's `self._tracks` insertion order (see
  // `assignNextTrackIndex` in vstHostWire.ts) — mutated in place, never
  // reassigned, same rationale as `registryRef` above.
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

    // A WebSocket close/error does NOT imply the sidecar process (and its
    // server-side `_tracks` dict) was torn down. `startVstSidecar`
    // (packages/studio-server/src/vstSidecar.ts) is a singleton — "Only one
    // sidecar runs per host process... a second call while one is already
    // running returns the same instance" — and it's only ever killed by an
    // explicit `stopVstSidecar()` tied to CLI shutdown, never by an
    // individual socket closing. A plain WS disconnect (network blip,
    // dev-server hiccup) leaves that process, and every track it already
    // holds in `_tracks`, running and untouched in the common case.
    //
    // So `trackIndexRef` is deliberately left as-is here instead of reset to
    // an assumed-empty map: clearing it would make this client recompute
    // indices from a false "fresh sidecar" premise while the server (in that
    // common same-process-reconnect case) is still working from its real,
    // non-empty dict — exactly the mismatch that let two tracks silently
    // collide on the wire after a reconnect. Leaving the mirror untouched
    // keeps it accurate in that common case; on the rarer path where the
    // process really was restarted (e.g. it crashed and exited), the mirror
    // can still end up stale either way, so this alone is not a full
    // guarantee.
    //
    // `useVstPreview` (a separate consumer of this hook, alongside the FX
    // property panel) does not rely on this mirror staying correct at all
    // post-disconnect: rather than trying to keep recomputing a trustworthy
    // index for tracks it already streamed, it permanently stops issuing
    // `load-chain` for ANYTHING — old or new — the first time it observes
    // any disconnect (see its `suspendedRef`). This mirror is kept as-is
    // here as forward-defensive infrastructure, not because some other
    // active caller depends on it: grepping propertyPanelVstSection.tsx (the
    // FX property panel) shows it never calls `loadChain` — only
    // `useVstPreview` does — and that hook's doc-comment already notes the
    // "FX panel calls loadChain post-reconnect" scenario this comment used to
    // describe was aspirational, not real (see useVstPreview.ts's crash-
    // fallback doc-comment). If a future caller of this shared `useVstHost()`
    // connection ever does call `loadChain` directly (not through
    // `useVstPreview`), this mirror staying accurate across a same-process
    // reconnect is what makes that safe.

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

      const socket = await connectVstSocket(outcome.port, outcome.token, {
        onMessage: handleMessage,
        onReady: () => setStatus("ready"),
        onDisconnect: handleDisconnect,
      });
      // This attempt was started before an unmount (StrictMode's dev-mode
      // phantom mount/unmount included) but only finished connecting after
      // it — the unmount's cleanup already ran and can't be re-run to close
      // a socket that didn't exist yet. Close it here instead of handing it
      // to a component that's gone; otherwise it keeps streaming from the
      // sidecar alongside whatever instance actually remounted.
      if (unmountedRef.current) {
        socket.close();
        return;
      }
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

  const setParam = useCallback(
    (trackId: string, pluginIndex: number, param: string, value: number): void => {
      sendJson({ cmd: "set-param", trackId, pluginIndex, param, value });
    },
    [sendJson],
  );

  // Supersede semantics are per-KIND (see `pendingKey`): a newer load-chain
  // replaces an older load-chain for the same track, and likewise for
  // get-state — but the two kinds never clobber each other. They're issued
  // concurrently for the same track by different consumers of this shared
  // connection (useVstPreview loads while the FX panel polls state).
  const loadChain = useCallback(
    (trackId: string, chain: ChainFileJson, wavUrl: string): Promise<LoadChainResult> => {
      return new Promise<LoadChainResult>((resolve, reject) => {
        const key = pendingKey("load-chain", trackId);
        const previous = pendingTrackRef.current.get(key);
        previous?.reject(
          new Error(`load-chain superseded by a new request for track "${trackId}"`),
        );
        pendingTrackRef.current.set(key, { kind: "load-chain", resolve, reject });
        sendJson({ cmd: "load-chain", trackId, chainJson: chain, wavPath: wavUrl });
      });
    },
    [sendJson],
  );

  const getState = useCallback(
    (trackId: string): Promise<string[]> => {
      return new Promise<string[]>((resolve, reject) => {
        const key = pendingKey("get-state", trackId);
        const previous = pendingTrackRef.current.get(key);
        previous?.reject(new Error(`get-state superseded by a new request for track "${trackId}"`));
        pendingTrackRef.current.set(key, { kind: "get-state", resolve, reject });
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
      setParam,
      loadChain,
      getState,
    }),
    [scan, openEditor, setParam, loadChain, getState],
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
