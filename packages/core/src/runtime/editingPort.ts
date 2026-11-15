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
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  type EditingElementDescription,
  type EditingElementHandle,
  type EditingElementHit,
  type EditingElementMatch,
} from "./editingElement";
import type { EditingElementBox, EditingElementGeometry } from "./editingGeometry";
import type { EditingGestureStart } from "./editingGestureStart";
import type { EditingLayer } from "./editingLayers";
import type { RuntimeTimelineMessage } from "./types";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";

export {
  buildStableSelector,
  escapeCssString,
  getPreferredClassSelector,
  readElementSource,
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_POINT_STACK,
  MAX_QUERY_MATCHES,
  MAX_SOURCE_GROUPS,
  type EditingElementDescription,
  type EditingElementHandle,
  type EditingElementHit,
  type EditingElementMatch,
  type EditingElementSource,
  type EditingRect,
} from "./editingElement";
export {
  elementCornerPoints,
  isElementVisibleThroughAncestors,
  readElementTransformSnapshot,
  rotationDegreesFromMatrix,
  snapCandidates,
  MAX_GEOMETRY_CHILDREN,
  MAX_SNAP_TARGETS,
  ROTATION_GATE_EPSILON_DEG,
  type EditingCorner,
  type EditingCorners,
  type EditingElementBox,
  type EditingElementGeometry,
  type ElementTransformSnapshot,
} from "./editingGeometry";
export type { EditingGestureStart } from "./editingGestureStart";
export {
  compositionPoint,
  coversComposition,
  isDomLayerElement,
  isInspectableLayerElement,
  pointerTarget,
  pointerTargets,
  resolveAllVisualDomEditTargets,
  resolveLayerSelector,
  type EditingLocalPointer,
  type EditingViewport,
} from "./editingTargets";
export {
  elementZIndex,
  hasOnlyFormattingChildren,
  isCompositionHost,
  layerKindOf,
  type EditingLayer,
  type LayerKind,
} from "./editingLayers";
export {
  composeElementTransform,
  individualRotateDegrees,
  type PlanarTransformOps,
} from "./elementTransform";

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
  "computed-styles",
  "elements-at-point",
  "pointer-targets",
  "describe",
  "ancestors",
  "query",
  "geometry",
  "layers",
  "draft",
  "gesture-start",
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

export const MAX_DRAFT_PX = 100_000;

/** A gesture's draft on one element: null puts that part back; `end` keeps what is drawn or restores. */
export type EditingDraft =
  | {
      handle: EditingElementHandle;
      translate: { x: number; y: number } | null;
      size: { width: number; height: number } | null;
    }
  | { handle: EditingElementHandle; end: "keep" | "restore" };

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
  /** The element `selector` first matches, or `handle` names. `styles` is null for none; empty values are left out. */
  "computed-styles": {
    params: ({ selector: string } | { handle: EditingElementHandle }) & { properties: string[] };
    result: { styles: Record<string, string> | null };
  };
  /** The stack under a viewport point, topmost first, up to MAX_POINT_STACK. Describe one to keep. */
  "elements-at-point": {
    params: { x: number; y: number };
    result: { elements: EditingElementHit[] };
  };
  /** The pick at fractions `x`, `y` of the root's box, and the stack a press cycles, MAX_POINT_STACK. */
  "pointer-targets": {
    params: { x: number; y: number };
    result: { target: EditingElementHit | null; stack: EditingElementHit[] };
  };
  /** One entry per handle, in order; null for an unknown or removed element. */
  describe: {
    params: { handles: EditingElementHandle[] };
    result: { elements: Array<EditingElementDescription | null> };
  };
  /** Each handle's ancestors, parent first, up to MAX_DESCRIBE_HANDLES; null as in `describe`. */
  ancestors: {
    params: { handles: EditingElementHandle[] };
    result: { ancestors: Array<EditingElementHandle[] | null> };
  };
  /** The matches of `selector` in document order, up to MAX_QUERY_MATCHES; an invalid one fails. */
  query: {
    params: { selector: string };
    result: { matches: EditingElementMatch[]; truncated: boolean };
  };
  /** Each handle's overlay geometry, null as in `describe`; `children` names whose descendant boxes to add. */
  geometry: {
    params: { handles: EditingElementHandle[]; children?: EditingElementHandle };
    result: {
      elements: Array<EditingElementGeometry | null>;
      children: EditingElementBox[] | null;
    };
  };
  /** The Layers walk from `offset`, MAX_QUERY_MATCHES at a time, scoped to a drilled-into `group`;
   * `missingGroup` says this page has no such group, and lists nothing. */
  layers: {
    params: { group?: EditingElementHandle; offset?: number };
    result: { layers: EditingLayer[]; truncated: boolean; missingGroup: boolean };
  };
  /** Gesture drafts in order, up to MAX_DESCRIBE_HANDLES; `drawn` counts the elements still here. */
  draft: { params: { drafts: EditingDraft[] }; result: { drawn: number } };
  "gesture-start": {
    params: { handles: EditingElementHandle[] };
    result: { elements: Array<EditingGestureStart | null>; snap: EditingElementBox[] };
  };
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

const MAX_SELECTOR_LENGTH = 2_000;
const MAX_STYLE_PROPERTIES = 64;
const MAX_STYLE_PROPERTY_LENGTH = 256;
const STYLE_PROPERTY = /^(?:[a-z][a-z0-9-]*|--[\w\u0080-\uffff-]+)$/;

const hasKeys = (params: unknown, keys: string): params is Record<string, unknown> =>
  isPlainRecord(params) && Object.keys(params).sort().join() === keys;

const noParams = (params: unknown): NoParams | null =>
  params === undefined || (isPlainRecord(params) && Object.keys(params).length === 0) ? {} : null;

const isSelector = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_SELECTOR_LENGTH;
const isHandle = (value: unknown): value is EditingElementHandle =>
  typeof value === "string" && EDITING_ELEMENT_HANDLE.test(value);

function styleTarget(params: Record<string, unknown>) {
  const keys = Object.keys(params).sort().join();
  const { selector, handle } = params;
  if (keys === "properties,selector" && isSelector(selector)) return { selector };
  return keys === "handle,properties" && isHandle(handle) ? { handle } : null;
}

function styleProperties(properties: unknown): string[] | null {
  if (!Array.isArray(properties) || properties.length > MAX_STYLE_PROPERTIES) return null;
  const names = properties.filter(
    (name): name is string =>
      typeof name === "string" &&
      name.length <= MAX_STYLE_PROPERTY_LENGTH &&
      STYLE_PROPERTY.test(name),
  );
  return names.length === properties.length ? names : null;
}

function handleList(params: unknown): { handles: EditingElementHandle[] } | null {
  if (!hasKeys(params, "handles") || !Array.isArray(params.handles)) return null;
  const { handles } = params;
  if (!handles.length || handles.length > MAX_DESCRIBE_HANDLES) return null;
  return handles.every(isHandle) ? { handles } : null;
}

function point(params: unknown): { x: number; y: number } | null {
  if (!hasKeys(params, "x,y")) return null;
  const { x, y } = params;
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
}

const isOffset = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

function layerParams(params: unknown): EditingParams<"layers"> | null {
  if (!isPlainRecord(params)) return null;
  const { group, offset, ...rest } = params;
  const valid = [
    Object.keys(rest).length === 0,
    group === undefined || isHandle(group),
    offset === undefined || isOffset(offset),
  ];
  if (valid.includes(false)) return null;
  return { ...(isHandle(group) && { group }), ...(isOffset(offset) && { offset }) };
}

const isDraftPx = (value: unknown, min: number): value is number =>
  Number.isFinite(value) && (value as number) >= min && Math.abs(value as number) <= MAX_DRAFT_PX;

function draftPart(value: unknown, keys: string, min: number): boolean {
  if (value === null) return true;
  if (!hasKeys(value, keys)) return false;
  return keys.split(",").every((key) => isDraftPx(value[key], min));
}

function draftEntry(value: unknown): EditingDraft | null {
  if (!isPlainRecord(value) || !isHandle(value.handle)) return null;
  const { handle, end, translate, size } = value;
  if (hasKeys(value, "end,handle"))
    return end === "keep" || end === "restore" ? { handle, end } : null;
  if (!hasKeys(value, "handle,size,translate")) return null;
  const valid = draftPart(translate, "x,y", -MAX_DRAFT_PX) && draftPart(size, "height,width", 0);
  return valid ? (value as EditingDraft) : null;
}

function draftList(params: unknown): EditingParams<"draft"> | null {
  if (!hasKeys(params, "drafts") || !Array.isArray(params.drafts)) return null;
  const { drafts } = params;
  if (!drafts.length || drafts.length > MAX_DESCRIBE_HANDLES) return null;
  const parsed = drafts.map(draftEntry);
  return parsed.includes(null) ? null : { drafts: parsed as EditingDraft[] };
}

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
  "computed-styles": (params) => {
    if (!isPlainRecord(params)) return null;
    const target = styleTarget(params);
    const properties = styleProperties(params.properties);
    return target && properties ? { ...target, properties } : null;
  },
  "elements-at-point": point,
  "pointer-targets": point,
  describe: handleList,
  ancestors: handleList,
  query: (params) =>
    hasKeys(params, "selector") && isSelector(params.selector)
      ? { selector: params.selector }
      : null,
  geometry: (params) => {
    if (!isPlainRecord(params)) return null;
    const { children, ...rest } = params;
    const list = handleList(rest);
    if (!list || !("children" in params)) return list;
    return isHandle(children) ? { ...list, children } : null;
  },
  layers: (params) => noParams(params) ?? layerParams(params),
  draft: draftList,
  "gesture-start": handleList,
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
