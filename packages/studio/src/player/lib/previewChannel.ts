// Runtime-state reads over a preview frame's editing port; an opaque frame's window is out of reach.
import {
  createEditingPortClient,
  type EditingPortClient,
} from "@hyperframes/core/runtime/editing-port";
import type { ClipManifest, IframeWindow } from "./playbackTypes";

const clients = new WeakMap<HTMLIFrameElement, EditingPortClient>();
const loopStarts = new WeakMap<EditingPortClient, number | null>();

/** A frame whose window refuses Studio's reads; one with no window has nothing to reach either way. */
export function previewFrameOpaque(iframe: HTMLIFrameElement): boolean {
  const win = iframe.contentWindow;
  if (!win) return false;
  try {
    void win.document;
    return false;
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

export const AGENT_PROBE_MS = 1_000;

/** Gives up after AGENT_PROBE_MS with no port: a runtime without the editing agent never answers. */
export async function previewSeekPainted(iframe: HTMLIFrameElement, timeoutMs?: number) {
  const client = previewEditingClient(iframe);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = new Promise<boolean>(
    (resolve) => (timer = setTimeout(resolve, AGENT_PROBE_MS, false)),
  );
  const connected = await Promise.race([
    client.ready.then(
      () => true,
      () => false,
    ),
    probe,
  ]);
  clearTimeout(timer);
  if (connected) await client.request("wait-for-seek", {}, { timeoutMs }).catch(() => {});
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

/** The runtime's computed `properties` for the element `selector` names; null when it has none. */
export async function previewComputedStyles(
  iframe: HTMLIFrameElement,
  selector: string,
  properties: string[],
): Promise<Record<string, string> | null> {
  const reply = await previewEditingClient(iframe)
    .request("computed-styles", { selector, properties })
    .catch(() => null);
  const styles: unknown = reply?.styles;
  if (typeof styles !== "object" || styles === null) return null;
  const read: Record<string, string> = {};
  for (const name of properties) {
    const value: unknown = Object.getOwnPropertyDescriptor(styles, name)?.value;
    if (typeof value === "string" && value) read[name] = value;
  }
  return read;
}
