// Studio decodes only its project's files, at URLs it builds: the film can load those through the preview route.
import { encodeUrlPath } from "@hyperframes/parsers";
import {
  PAUSED_FRAME_BYTES,
  parsePausedFrameAsk,
  type PausedFrameAsk,
} from "@hyperframes/core/runtime/editing-port";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { PREVIEW_PATH } from "./frameToken";
import { previewEditingClient } from "./previewChannel";
import type { PausedVideoFrame } from "@hyperframes/core";
import type { PausedVideoDecodeAsk, PausedVideoDecoder } from "./pausedVideoDecoder";

const served = new WeakMap<HTMLIFrameElement, object>();

export function servePausedVideoFrames(iframe: HTMLIFrameElement): void {
  const project = PREVIEW_PATH.exec(new URL(iframe.src, location.href).pathname)?.[1];
  if (!project) return;
  const client = previewEditingClient(iframe);
  if (served.get(iframe) === client) return;
  served.set(iframe, client);
  const { port1, port2 } = new MessageChannel();
  const host = pausedFrameHost(port1, project);
  closeOnNextDocument(iframe, host.close);
  client
    .request("serve-paused-frames", { channel: port2 }, { transfer: [port2] })
    .then(({ served: on }) => on || host.close(), host.close);
}

function readableDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

function closeOnNextDocument(iframe: HTMLIFrameElement, close: () => void): void {
  const served = readableDocument(iframe);
  const onLoad = () => {
    if (served && readableDocument(iframe) === served) return;
    iframe.removeEventListener("load", onLoad);
    close();
  };
  iframe.addEventListener("load", onLoad);
}

async function projectFiles(project: string): Promise<Set<string>> {
  const res = await studioApiFetch(project);
  if (!res.ok) throw new Error(`Project files unavailable: ${res.status}`);
  const body = (await res.json()) as { files?: unknown };
  return new Set(Array.isArray(body.files) ? body.files.filter((f) => typeof f === "string") : []);
}

/** The project file `path` names on this project's preview route, or null for anything else. */
function projectFileOf(path: string, project: string): string | null {
  const route = PREVIEW_PATH.exec(path);
  const rest = route ? path.slice(route[0].length) : "";
  if (!route || route[1] !== project || !rest.startsWith("/")) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(rest.slice(1));
  } catch {
    return null;
  }
  const parts = relative.split("/");
  return parts.some((part) => part === "" || part === "." || part === "..") ? null : relative;
}

const loadDecoder = () =>
  import("./pausedVideoDecoder").then(({ createPausedVideoDecoder }) => createPausedVideoDecoder());

export function pausedFrameHost(
  port: MessagePort,
  project: string,
  deps: {
    decoder?: () => Promise<PausedVideoDecoder>;
    files?: (project: string) => Promise<Set<string>>;
  } = {},
) {
  let decoder: Promise<PausedVideoDecoder> | null = null;
  let files: Promise<Set<string>> | null = null;
  const inFlight = new Map<number, AbortController>();
  let lastSettled = Promise.resolve();
  let closed = false;
  const reply = (message: unknown, transfer: Transferable[] = []) => {
    if (!closed) port.postMessage(message, transfer);
  };

  const resolveAsk = async (ask: PausedFrameAsk): Promise<PausedVideoDecodeAsk> => {
    const relative = projectFileOf(ask.path, project);
    if (relative === null) throw new Error("Preview source is not this project's");
    files ??= (deps.files ?? projectFiles)(project);
    if (!(await files).has(relative)) throw new Error("Preview source is not a project file");
    const url = new URL(`${project}/preview/${encodeUrlPath(relative)}`, location.origin);
    for (const [key, value] of Object.entries(ask.params)) url.searchParams.set(key, value);
    const { frameRate, variableFrameRate } = ask;
    return { source: url.pathname + url.search, time: ask.time, frameRate, variableFrameRate };
  };

  const send = async (id: number, frames: PausedVideoFrame[], signal: AbortSignal) => {
    if (frames.reduce((sum, f) => sum + f.width * f.height * 4, 0) > PAUSED_FRAME_BYTES)
      throw new Error("Preview decode over budget");
    const images = await Promise.all(frames.map((frame) => createImageBitmap(frame.source)));
    if (signal.aborted || closed) return images.forEach((image) => image.close());
    const wire = frames.map(({ timestamp, duration, width, height }, i) => ({
      image: images[i],
      timestamp,
      duration,
      width,
      height,
    }));
    reply({ type: "frames", id, frames: wire }, images);
  };

  const replaceOlder = () => {
    for (const [older, control] of inFlight) {
      if (control.signal.aborted) continue;
      control.abort();
      reply({ type: "failed", id: older, message: "Preview decode replaced" });
    }
  };

  const nextTurn = () => {
    const previous = lastSettled;
    let settled = () => {};
    lastSettled = new Promise((resolve) => (settled = resolve));
    return { previous, settled };
  };

  const decodeAndSend = async (id: number, asks: PausedFrameAsk[], signal: AbortSignal) => {
    const resolved = await Promise.all(asks.map(resolveAsk));
    decoder ??= (deps.decoder ?? loadDecoder)();
    const frames = await (await decoder).decode(resolved, signal);
    await send(id, frames, signal).finally(() => frames.forEach((f) => f.release()));
  };

  const decode = async (id: number, asks: PausedFrameAsk[]) => {
    if (asks.length === 0)
      return reply({ type: "failed", id, message: "Preview decode over budget" });
    replaceOlder();
    const control = new AbortController();
    inFlight.set(id, control);
    const { previous, settled } = nextTurn();
    try {
      await previous;
      if (!control.signal.aborted) await decodeAndSend(id, asks, control.signal);
    } catch (error) {
      if (!control.signal.aborted)
        reply({ type: "failed", id, message: String((error as Error)?.message ?? error) });
    } finally {
      if (inFlight.get(id) === control) inFlight.delete(id);
      settled();
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    for (const control of inFlight.values()) control.abort();
    inFlight.clear();
    void decoder?.then((actual) => actual.dispose()).catch(() => {});
    port.close();
  };

  port.onmessage = (event: MessageEvent<unknown>) => {
    const message = parsePausedFrameAsk(event.data);
    if (!message || closed) return;
    if (message.type === "close") return close();
    if (message.type === "abort") return inFlight.get(message.id)?.abort();
    if (message.type === "suspend") {
      void (decoder ?? Promise.resolve(null))
        .catch(() => null)
        .then((actual) => actual?.suspend())
        .catch(() => {})
        .then(() => reply({ type: "suspended", id: message.id }));
      return;
    }
    void decode(message.id, message.asks);
  };

  return { close };
}
