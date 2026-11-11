// Runtime-state reads over a preview frame's editing port; an opaque frame's window is out of reach.
import {
  createEditingPortClient,
  type EditingPortClient,
} from "@hyperframes/core/runtime/editing-port";
import type { ClipManifest, IframeWindow } from "./playbackTypes";

const clients = new WeakMap<HTMLIFrameElement, EditingPortClient>();
const loopStarts = new WeakMap<EditingPortClient, number | null>();

/** A frame with a document Studio cannot read; one with no window has nothing to reach either way. */
export function previewFrameOpaque(iframe: HTMLIFrameElement): boolean {
  if (!iframe.contentWindow) return false;
  try {
    return iframe.contentDocument === null;
  } catch {
    return true;
  }
}

/** One client per frame load: the frame's next load disposes it. */
export function previewEditingClient(iframe: HTMLIFrameElement): EditingPortClient {
  const open = clients.get(iframe);
  if (open) return open;
  const client = createEditingPortClient({ iframe });
  clients.set(iframe, client);
  const onLoad = () => {
    client.dispose();
    if (clients.get(iframe) === client) clients.delete(iframe);
  };
  iframe.addEventListener("load", onLoad, { once: true });
  return client;
}

export function setFrameLoopStart(iframe: HTMLIFrameElement, seconds: number | null): void {
  if (!previewFrameOpaque(iframe)) {
    try {
      (iframe.contentWindow as IframeWindow | null)?.__hf?.setLoopStart?.(seconds);
    } catch {}
    return;
  }
  const client = previewEditingClient(iframe);
  if (loopStarts.has(client) && loopStarts.get(client) === seconds) return;
  loopStarts.set(client, seconds);
  client.request("set-loop-start", { seconds }).catch(() => {
    if (loopStarts.get(client) === seconds) loopStarts.delete(client);
  });
}

export function previewSeekPainted(iframe: HTMLIFrameElement, timeoutMs?: number): Promise<void> {
  return previewEditingClient(iframe)
    .request("wait-for-seek", {}, { timeoutMs })
    .then(
      () => {},
      () => {},
    );
}

/** The reply is frame data, so its shape is checked. */
export async function previewClipManifest(iframe: HTMLIFrameElement): Promise<ClipManifest | null> {
  const snapshot = await previewEditingClient(iframe).request("runtime-snapshot", {});
  const manifest: unknown = snapshot?.clipManifest;
  if (typeof manifest !== "object" || manifest === null) return null;
  const { clips, durationInFrames } = manifest as Partial<ClipManifest>;
  if (!Array.isArray(clips) || typeof durationInFrames !== "number") return null;
  if (!Number.isFinite(durationInFrames)) return null;
  return manifest as ClipManifest;
}
