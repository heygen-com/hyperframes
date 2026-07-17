/**
 * Pure wire-protocol helpers for `useVstHost.ts`: the injectable socket
 * factory seam, control-JSON event parsing, pending-request bookkeeping (the
 * `pendingKey` composite-key scheme), and the `/api/vst/start` + WebSocket
 * connect sequence. Nothing here holds React state — it's all plain
 * functions and module-level helpers the hook wires into refs/effects.
 *
 * Protocol (see `packages/vst-host/src/hyperframes_vst/server.py`): JSON text
 * frames for control commands/events, raw binary `ArrayBuffer` frames for
 * interleaved-stereo PCM (`u32 trackIndex` + `f64 samplePos` + `f32` samples)
 * that the hook forwards unopened to `onPcmFrame` subscribers — decoding is
 * Task 13's job.
 */
import type {
  LoadChainResult,
  VstRegistryEntry,
} from "../components/editor/propertyPanelVstSection";
import { isRecord } from "../utils/vstChainFile";

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

// ── Server → client event parsing ─────────────────────────────────────────────

function isRegistryEntry(value: unknown): value is VstRegistryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.format === "string"
  );
}

export type ParsedServerEvent =
  | { kind: "registry"; plugins: VstRegistryEntry[] }
  | { kind: "chain-loaded"; trackId: string; sampleRate: number; stable: boolean }
  | { kind: "state"; trackId: string; plugins: string[] }
  | { kind: "error"; code: string; plugin: string | null; trackId: string | null };

// fallow-ignore-next-line complexity
export function parseServerEvent(raw: string): ParsedServerEvent | null {
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
  if (
    parsed.event === "chain-loaded" &&
    typeof parsed.trackId === "string" &&
    typeof parsed.sampleRate === "number"
  ) {
    // `stable` absent (older sidecar) is treated as stable — the guard only
    // ever downgrades a track to dry, never the reverse.
    const stable = typeof parsed.stable === "boolean" ? parsed.stable : true;
    return { kind: "chain-loaded", trackId: parsed.trackId, sampleRate: parsed.sampleRate, stable };
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

export type PendingTrackEntry =
  | { kind: "load-chain"; resolve: (result: LoadChainResult) => void; reject: (err: Error) => void }
  | { kind: "get-state"; resolve: (states: string[]) => void; reject: (err: Error) => void };

/**
 * Pending-map key. Keyed by (kind, trackId) — NOT trackId alone — because the
 * two request kinds are issued by two INDEPENDENT consumers of this shared
 * connection for the same track at the same time: `useVstPreview` calls
 * `loadChain` while the FX panel's param-seed effect polls `getState` every
 * 400ms (propertyPanelVstSection.tsx). With trackId-only keys, each poll
 * clobbered — and spuriously rejected as "superseded" — the in-flight
 * `loadChain` sharing its slot, so on any machine slow enough for the load
 * to still be pending when a poll landed, the track never finished loading
 * (live-traced: `loadChain-rejected: get-state superseded...` twice, then
 * `transport loaded: 0` forever — silent music). Supersede semantics only
 * make sense WITHIN a kind: a newer get-state replaces an older get-state,
 * never a load-chain.
 */
export function pendingKey(kind: PendingTrackEntry["kind"], trackId: string): string {
  return `${kind}:${trackId}`;
}

export interface PendingScanEntry {
  resolve: () => void;
  reject: (err: Error) => void;
}

export const DISCONNECTED_ERROR = "VST sidecar disconnected";

export interface EventDispatchRefs {
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
export function applyServerEvent(parsed: ParsedServerEvent, refs: EventDispatchRefs): void {
  switch (parsed.kind) {
    case "registry":
      applyRegistryEvent(parsed.plugins, refs);
      return;
    case "chain-loaded":
      applyChainLoadedEvent(parsed.trackId, parsed.sampleRate, parsed.stable, refs);
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
  // The error event carries a trackId but not which command failed — reject
  // whichever request kinds are pending for that track (conservative: an
  // error for either kills both, rather than leaving one hanging forever).
  for (const kind of ["load-chain", "get-state"] as const) {
    const key = pendingKey(kind, parsed.trackId);
    const entry = refs.pendingTrack.get(key);
    if (entry) {
      refs.pendingTrack.delete(key);
      entry.reject(new Error(message));
    }
  }
}

/**
 * Always advances the mirrored index map and broadcasts to every
 * `onChainLoaded` subscriber — regardless of whether THIS connection's
 * pending map has a matching `load-chain` request — so a consumer who loaded
 * a track earlier (and isn't the caller of the reload that produced this
 * event) still hears about its new trackIndex.
 */
function applyChainLoadedEvent(
  trackId: string,
  sampleRate: number,
  stable: boolean,
  refs: EventDispatchRefs,
): void {
  const trackIndex = assignNextTrackIndex(refs.trackIndex, trackId);

  const key = pendingKey("load-chain", trackId);
  const entry = refs.pendingTrack.get(key);
  if (entry?.kind === "load-chain") {
    refs.pendingTrack.delete(key);
    entry.resolve({ trackIndex, sampleRate, stable });
  }

  refs.chainLoadedListeners.forEach((cb) => cb(trackId, trackIndex));
}

function applyStateEvent(
  pendingTrack: Map<string, PendingTrackEntry>,
  trackId: string,
  plugins: string[],
): void {
  const key = pendingKey("get-state", trackId);
  const entry = pendingTrack.get(key);
  if (entry?.kind !== "get-state") return;
  pendingTrack.delete(key);
  entry.resolve(plugins);
}

// ── Start + connect (module-level so each stays a small, single-purpose unit) ──

export type StartOutcome =
  | { ok: true; port: number; token: string }
  | { ok: false; installHint: string | null; message: string };

interface StartResponseBody {
  port: number;
  token: string;
}

/** Type guard for `/api/vst/start`'s success-path body shape (see routes/vst.ts). */
function isStartResponseBody(body: unknown): body is StartResponseBody {
  return isRecord(body) && typeof body.port === "number" && typeof body.token === "string";
}

/** Names which field `isStartResponseBody` rejected on, for a specific error message. */
function missingStartField(body: unknown): "port" | "token" {
  return isRecord(body) && typeof body.port === "number" ? "token" : "port";
}

/**
 * Parses `/api/vst/start`'s response body (see routes/vst.ts) into a
 * `StartOutcome`. The sidecar requires every WebSocket connection to present
 * a shared-secret `token` (see server.py's `_authenticate`) before any
 * command is processed — `/vst/start` relays it alongside the port, so a
 * response missing it is treated the same as one missing the port: a
 * connection couldn't be safely established from it.
 */
function parseStartResponse(response: Response, body: unknown): StartOutcome {
  if (!response.ok) {
    const hint = isRecord(body) && typeof body.installHint === "string" ? body.installHint : null;
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : "VST sidecar failed to start";
    return { ok: false, installHint: hint, message };
  }
  if (!isStartResponseBody(body)) {
    return {
      ok: false,
      installHint: null,
      message: `VST sidecar start response missing ${missingStartField(body)}`,
    };
  }
  return { ok: true, port: body.port, token: body.token };
}

export async function requestVstStart(): Promise<StartOutcome> {
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

export interface SocketHandlers {
  onMessage: (ev: MessageEvent) => void;
  onReady: () => void;
  onDisconnect: () => void;
}

/**
 * Opens the sidecar WS and resolves once it's open (or rejects if it closes
 * first). `token` is sent as a `?token=` query param — the sidecar's
 * `process_request` handshake hook (server.py's `_authenticate`) rejects the
 * HTTP upgrade before any command can be sent if it's missing or wrong.
 */
export function connectVstSocket(
  port: number,
  token: string,
  handlers: SocketHandlers,
): Promise<VstSocketLike> {
  return new Promise<VstSocketLike>((resolve, reject) => {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const socket = createSocket(`ws://${host}:${port}/?token=${encodeURIComponent(token)}`);
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
