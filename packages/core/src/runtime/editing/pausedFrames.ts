// Paused video frames for a frame Studio cannot script: the runtime asks over a port Studio handed it, and Studio
// decodes. An ask names a path on the frame's own server and the proxy options it played, never a URL: Studio
// resolves it against its own project before reading anything.
import { sourceFactsOfSrc } from "../mediaSourceLookup";
import type {
  PausedVideoFrame,
  PausedVideoFrameProvider,
  PausedVideoFrameRequest,
} from "../pausedVideoFrames";

/** The query options the runtime's media proxy adds to a src; any other key never leaves the frame. */
export const PAUSED_FRAME_PARAMS = [
  "hf-proxy",
  "hf-proxy-box",
  "hf-proxy-light",
  "hf-proxy-retry",
] as const;
const PARAM_VALUE = /^[\w.:-]{1,64}$/;
/** The most image bytes one decode may hand back; the runtime presents no more at once either. */
export const PAUSED_FRAME_BYTES = 128 * 1024 * 1024;
/** The most sources one decode may name. */
export const PAUSED_FRAME_SOURCES = 4;

export interface PausedFrameAsk {
  path: string;
  params: Record<string, string>;
  time: number;
  /** Hints from the frame: they shape decode timing, never what is read. */
  frameRate?: number;
  variableFrameRate?: boolean;
}

export interface PausedFrameImage {
  image: ImageBitmap;
  timestamp: number;
  duration: number;
  width: number;
  height: number;
}

export type PausedFrameAskMessage =
  | { type: "decode"; id: number; asks: PausedFrameAsk[] }
  | { type: "abort"; id: number }
  | { type: "suspend"; id: number }
  | { type: "close" };

export type PausedFrameReply =
  | { type: "frames"; id: number; frames: PausedFrameImage[] }
  | { type: "failed"; id: number; message: string }
  | { type: "suspended"; id: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseParams(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const known = PAUSED_FRAME_PARAMS as readonly string[];
  const entries = Object.entries(value);
  const valid = entries.every(
    ([key, param]) => known.includes(key) && typeof param === "string" && PARAM_VALUE.test(param),
  );
  return valid ? (Object.fromEntries(entries) as Record<string, string>) : null;
}

function withHints<T extends object>(target: T, from: Record<string, unknown>): T {
  const hinted: T & { frameRate?: number; variableFrameRate?: boolean } = target;
  if (finite(from.frameRate) && from.frameRate > 0) hinted.frameRate = from.frameRate;
  if (typeof from.variableFrameRate === "boolean")
    hinted.variableFrameRate = from.variableFrameRate;
  return hinted;
}

function parseAsk(value: unknown): PausedFrameAsk | null {
  if (!isRecord(value) || typeof value.path !== "string" || !finite(value.time)) return null;
  const params = parseParams(value.params);
  return params ? withHints({ path: value.path, params, time: value.time }, value) : null;
}

/** One message from the frame, or null for anything off-shape. Paths are checked by the host, not here. */
export function parsePausedFrameAsk(data: unknown): PausedFrameAskMessage | null {
  if (!isRecord(data)) return null;
  if (data.type === "close") return { type: "close" };
  if (!isId(data.id)) return null;
  if (data.type === "abort" || data.type === "suspend") return { type: data.type, id: data.id };
  if (data.type !== "decode" || !Array.isArray(data.asks)) return null;
  const asks = data.asks.map(parseAsk);
  return asks.every((ask): ask is PausedFrameAsk => ask !== null)
    ? { type: "decode", id: data.id, asks }
    : null;
}

/** The ask for one request: only a src on the document's own server, by path and proxy options. */
export function pausedFrameAsk(request: PausedVideoFrameRequest): PausedFrameAsk | null {
  let url: URL;
  try {
    url = new URL(request.source, document.baseURI);
  } catch {
    return null;
  }
  if (url.origin !== new URL(document.baseURI).origin) return null;
  const params: Record<string, string> = {};
  for (const key of PAUSED_FRAME_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) params[key] = value;
  }
  const facts = sourceFactsOfSrc(request.source);
  const ask: PausedFrameAsk = { path: url.pathname, params, time: request.time };
  if (facts?.frameRate) ask.frameRate = facts.frameRate;
  if (facts?.variableFrameRate !== undefined) ask.variableFrameRate = facts.variableFrameRate;
  return ask;
}

const aborted = () => new DOMException("Preview cancelled", "AbortError");

/** The runtime's provider over `port`: each decode is one ask, answered by Studio with transferred images. */
export function portPausedVideoProvider(port: MessagePort): PausedVideoFrameProvider {
  const pending = new Map<
    number,
    { resolve: (reply: PausedFrameReply) => void; reject: (e: unknown) => void }
  >();
  let lastId = 0;
  let disposed = false;
  const closeImages = (reply: unknown) => {
    if (!isRecord(reply) || !Array.isArray(reply.frames)) return;
    for (const frame of reply.frames)
      if (isRecord(frame)) (frame.image as ImageBitmap | undefined)?.close?.();
  };
  port.onmessage = (event: MessageEvent<unknown>) => {
    const reply = event.data;
    const entry = isRecord(reply) && isId(reply.id) ? pending.get(reply.id) : undefined;
    if (!entry) return closeImages(reply);
    pending.delete((reply as { id: number }).id);
    entry.resolve(reply as PausedFrameReply);
  };
  const ask = (message: Exclude<PausedFrameAskMessage, { type: "close" }>, signal?: AbortSignal) =>
    new Promise<PausedFrameReply>((resolve, reject) => {
      if (disposed) return reject(aborted());
      const onAbort = () => {
        if (!pending.delete(message.id)) return;
        port.postMessage({ type: "abort", id: message.id });
        reject(aborted());
      };
      pending.set(message.id, {
        resolve: (reply) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(reply);
        },
        reject,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      port.postMessage(message);
    });
  const provider: PausedVideoFrameProvider = {
    async decode(requests, signal) {
      signal.throwIfAborted();
      const asks = requests.map(pausedFrameAsk);
      if (asks.some((a) => a === null))
        throw new Error("Preview source is not on the preview server");
      const reply = await ask(
        { type: "decode", id: ++lastId, asks: asks as PausedFrameAsk[] },
        signal,
      );
      if (reply.type === "failed") throw new Error(reply.message);
      if (reply.type !== "frames") throw new Error("Preview frames malformed");
      if (signal.aborted || disposed) {
        closeImages(reply);
        throw aborted();
      }
      return reply.frames.map((frame): PausedVideoFrame => {
        let released = false;
        return {
          source: frame.image,
          timestamp: frame.timestamp,
          duration: frame.duration,
          width: frame.width,
          height: frame.height,
          release() {
            if (released) return;
            released = true;
            frame.image.close();
          },
        };
      });
    },
    async suspend() {
      await ask({ type: "suspend", id: ++lastId }).catch(() => {});
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of pending.values()) entry.reject(aborted());
      pending.clear();
      try {
        port.postMessage({ type: "close" });
      } catch {}
      port.close();
      window.removeEventListener("pagehide", onPageHide);
    },
  };
  const onPageHide = () => provider.dispose();
  window.addEventListener("pagehide", onPageHide, { once: true });
  return provider;
}
