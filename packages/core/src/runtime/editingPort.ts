/**
 * The editing channel between a preview frame and its parent: a MessagePort the
 * runtime hands the parent once, carrying typed requests and replies. The
 * runtime side is `editingAgent.ts`; `createEditingPortClient` is the parent
 * side. Both import their wire types from here, so they cannot drift apart.
 *
 * Playback transport (play, pause, seek, rate, mute, play range) stays on the
 * control protocol in `bridge.ts`. This channel carries the reads a parent
 * otherwise takes straight off the frame's window, which an opaque-origin
 * preview does not allow.
 */
import type { RuntimeTimelineMessage } from "./types";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";

export const EDITING_PROTOCOL_VERSION = 1 as const;
/** Parent to frame, on the window: asks the runtime for the port. */
export const EDITING_CONNECT = "editing-connect";
/** Frame to parent, on the window: carries the port in its transfer list. */
export const EDITING_PORT = "editing-port";

export const EDITING_REQUEST_KINDS = [
  "hello",
  "runtime-snapshot",
  "wait-for-seek",
  "set-loop-start",
] as const;
export type EditingRequestKind = (typeof EDITING_REQUEST_KINDS)[number];

export interface EditingRuntimeSnapshot {
  /** The runtime has installed its player API. */
  playerReady: boolean;
  /** Why the runtime failed to start, when it did. */
  startupError: string | null;
  /** The clip manifest the runtime last posted as its `timeline` message. */
  clipManifest: RuntimeTimelineMessage | null;
  /** `[childId, parentId]` for each nested clip in the runtime's clip tree. */
  clipParents: Array<[string, string]>;
}

type NoParams = Record<string, never>;
export interface EditingRequests {
  hello: {
    params: NoParams;
    result: { version: typeof EDITING_PROTOCOL_VERSION; kinds: string[] };
  };
  "runtime-snapshot": { params: NoParams; result: EditingRuntimeSnapshot };
  /** `waited` is false when the runtime has no seek-completion hook. */
  "wait-for-seek": { params: NoParams; result: { waited: boolean } };
  /** Where a looping playback wraps to; null stops looping from a custom start. */
  "set-loop-start": { params: { seconds: number | null }; result: { applied: boolean } };
}
export type EditingParams<K extends EditingRequestKind> = EditingRequests[K]["params"];
export type EditingResult<K extends EditingRequestKind> = EditingRequests[K]["result"];

export type EditingErrorCode =
  | "malformed"
  | "unsupported-version"
  | "unknown-kind"
  | "invalid-params"
  | "failed"
  | "timeout"
  | "disposed";

export type EditingReply =
  | { v: typeof EDITING_PROTOCOL_VERSION; id: number; ok: true; result: unknown }
  | {
      v: typeof EDITING_PROTOCOL_VERSION;
      id: number | null;
      ok: false;
      error: { code: EditingErrorCode; message: string };
    };

export type ParsedEditingRequest =
  | { ok: true; id: number; kind: EditingRequestKind; params: EditingParams<EditingRequestKind> }
  | { ok: false; id: number | null; code: EditingErrorCode; message: string };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

const noParams = (params: unknown): NoParams | null =>
  params === undefined || (isPlainRecord(params) && Object.keys(params).length === 0) ? {} : null;

const PARAM_PARSERS: {
  [K in EditingRequestKind]: (params: unknown) => EditingParams<K> | null;
} = {
  hello: noParams,
  "runtime-snapshot": noParams,
  "wait-for-seek": noParams,
  "set-loop-start": (params) => {
    if (!isPlainRecord(params) || Object.keys(params).join() !== "seconds") return null;
    const { seconds } = params;
    if (seconds === null) return { seconds };
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? { seconds }
      : null;
  },
};

/** Validates one request off the wire. Never throws: anything unusable becomes a typed error. */
export function parseEditingRequest(data: unknown): ParsedEditingRequest {
  if (!isPlainRecord(data) || !Number.isSafeInteger(data.id) || (data.id as number) < 0) {
    return { ok: false, id: null, code: "malformed", message: "request needs a numeric id" };
  }
  const id = data.id as number;
  if (data.v !== EDITING_PROTOCOL_VERSION) {
    return { ok: false, id, code: "unsupported-version", message: "unsupported version" };
  }
  const kind = EDITING_REQUEST_KINDS.find((known) => known === data.kind);
  if (!kind) return { ok: false, id, code: "unknown-kind", message: "unknown request kind" };
  const params = PARAM_PARSERS[kind](data.params);
  if (!params)
    return { ok: false, id, code: "invalid-params", message: `invalid params for ${kind}` };
  return { ok: true, id, kind, params };
}

export class EditingPortError extends Error {
  constructor(
    readonly code: EditingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EditingPortError";
  }
}

export interface EditingPortClient {
  /** Settles when the frame's runtime has handed over its port. */
  readonly ready: Promise<void>;
  request<K extends EditingRequestKind>(
    kind: K,
    params: EditingParams<K>,
    options?: { timeoutMs?: number },
  ): Promise<EditingResult<K>>;
  /** Rejects every pending request with `disposed` and closes the port. */
  dispose(): void;
}

type Outcome = { result: unknown } | { error: EditingPortError };

/** A reply's result or typed error. Anything off-shape is `malformed`, never a throw. */
function replyOutcome(data: Record<string, unknown>): Outcome {
  if (data.v !== EDITING_PROTOCOL_VERSION) {
    return { error: new EditingPortError("unsupported-version", "reply version") };
  }
  if (data.ok === true && "result" in data) return { result: data.result };
  const error = isPlainRecord(data.error) ? data.error : null;
  if (data.ok !== false || typeof error?.code !== "string") {
    return { error: new EditingPortError("malformed", "malformed reply") };
  }
  const message = typeof error.message === "string" ? error.message : error.code;
  return { error: new EditingPortError(error.code as EditingErrorCode, message) };
}

/** The port this frame handed over, "ready" when its runtime came up, else null. */
function readHandoff(
  event: MessageEvent<unknown>,
  frame: Window | null,
): MessagePort | "ready" | null {
  const data = event.data;
  if (!frame || event.source !== frame || !isPlainRecord(data) || data.source !== "hf-preview") {
    return null;
  }
  if (data.type === "ready") return "ready";
  return data.type === EDITING_PORT && data.v === EDITING_PROTOCOL_VERSION
    ? onlyPort(event.ports)
    : null;
}

const onlyPort = (ports: readonly MessagePort[]): MessagePort | null =>
  ports.length === 1 ? (ports[0] ?? null) : null;

type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: EditingPortError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * The parent's end of the editing channel for one preview frame load. Asks for
 * the port at once and again on the runtime's `ready`, and takes the first port
 * that frame sends. Replies are data from the frame, so callers validate results.
 */
export function createEditingPortClient(options: {
  iframe: HTMLIFrameElement;
  timeoutMs?: number;
  host?: Window;
}): EditingPortClient {
  const { iframe, timeoutMs = 5_000, host = window } = options;
  const pending = new Map<number, Pending>();
  let port: MessagePort | null = null;
  let disposed = false;
  let lastId = 0;
  let resolveReady!: () => void;
  let rejectReady!: (error: EditingPortError) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});

  const settle = (id: number, outcome: Outcome) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    wallClearTimeout(entry.timer);
    if ("error" in outcome) entry.reject(outcome.error);
    else entry.resolve(outcome.result);
  };
  const onReply = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (isPlainRecord(data) && typeof data.id === "number") settle(data.id, replyOutcome(data));
  };
  const connect = () => {
    try {
      iframe.contentWindow?.postMessage(
        { source: "hf-parent", type: EDITING_CONNECT, v: EDITING_PROTOCOL_VERSION },
        "*",
      );
    } catch {
      // The frame is mid-navigation; its runtime's `ready` asks again.
    }
  };
  const onWindowMessage = (event: MessageEvent<unknown>) => {
    const handoff = readHandoff(event, iframe.contentWindow);
    if (handoff === "ready") return connect();
    if (!handoff) return;
    port = handoff;
    host.removeEventListener("message", onWindowMessage);
    port.onmessage = onReply;
    resolveReady();
  };
  host.addEventListener("message", onWindowMessage);
  connect();

  return {
    ready,
    request(kind, params, requestOptions) {
      if (disposed) return Promise.reject(new EditingPortError("disposed", "client disposed"));
      const id = ++lastId;
      const limit = requestOptions?.timeoutMs ?? timeoutMs;
      const result = new Promise<unknown>((resolve, reject) => {
        const timer = wallSetTimeout(
          () => settle(id, { error: new EditingPortError("timeout", `${kind} timed out`) }),
          limit,
        );
        pending.set(id, { resolve, reject, timer });
      });
      const send = () => {
        if (!pending.has(id)) return;
        try {
          port?.postMessage({ v: EDITING_PROTOCOL_VERSION, id, kind, params });
        } catch (err) {
          settle(id, { error: new EditingPortError("failed", String(err)) });
        }
      };
      // A ready that rejects was disposed, which has already rejected this request.
      ready.then(send, () => {});
      return result as Promise<EditingResult<typeof kind>>;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener("message", onWindowMessage);
      port?.close();
      rejectReady(new EditingPortError("disposed", "client disposed"));
      for (const id of [...pending.keys()]) {
        settle(id, { error: new EditingPortError("disposed", "client disposed") });
      }
    },
  };
}
