/**
 * Studio's channel to the runtime in a preview frame, so Studio can read what it
 * needs without reaching into the frame's window. That window is out of reach
 * once the preview runs on an opaque origin.
 *
 * Reads go over the runtime's editing port (`@hyperframes/core/runtime/editing-port`),
 * one client per frame load. Playback commands go over the runtime's control
 * bridge instead (`bridgePlayback.ts`).
 */
import {
  createEditingPortClient,
  type EditingPortClient,
} from "@hyperframes/core/runtime/editing-port";
import type { ClipManifest } from "./playbackTypes";

const clients = new WeakMap<HTMLIFrameElement, EditingPortClient>();
const loopStarts = new WeakMap<EditingPortClient, number | null>();

/** Whether Studio can script the frame's document: true for a same-origin preview. */
export function previewFrameScriptable(iframe: HTMLIFrameElement): boolean {
  try {
    return iframe.contentDocument !== null;
  } catch {
    return false;
  }
}

/**
 * The editing client for the document now in `iframe`. The next load of the
 * frame disposes it, and the next call opens a client bound to the new runtime.
 */
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

/** Tells the runtime where a looping playback wraps to. Only a change is sent. */
export function setPreviewLoopStart(iframe: HTMLIFrameElement, seconds: number | null): void {
  const client = previewEditingClient(iframe);
  if (loopStarts.has(client) && loopStarts.get(client) === seconds) return;
  loopStarts.set(client, seconds);
  client.request("set-loop-start", { seconds }).catch(() => {
    // Not applied: let the next call send it again.
    if (loopStarts.get(client) === seconds) loopStarts.delete(client);
  });
}

/** Settles once the runtime has painted its latest seek, or when the channel gives up. */
export function previewSeekPainted(iframe: HTMLIFrameElement, timeoutMs?: number): Promise<void> {
  return previewEditingClient(iframe)
    .request("wait-for-seek", {}, { timeoutMs })
    .then(
      () => {},
      () => {},
    );
}

/** The clip manifest the runtime last posted, or null. The reply is frame data, so it is checked. */
export async function previewClipManifest(iframe: HTMLIFrameElement): Promise<ClipManifest | null> {
  const snapshot = await previewEditingClient(iframe).request("runtime-snapshot", {});
  const manifest: unknown = snapshot?.clipManifest;
  if (typeof manifest !== "object" || manifest === null) return null;
  const { clips, durationInFrames } = manifest as Partial<ClipManifest>;
  if (!Array.isArray(clips) || typeof durationInFrames !== "number") return null;
  if (!Number.isFinite(durationInFrames)) return null;
  return manifest as ClipManifest;
}
