/**
 * The `window.message` router for the preview iframe.
 *
 * Extracted from `useTimelinePlayer`, which had grown past the studio's 600-line
 * file cap and carried a `fallow-ignore-next-line complexity` on this function
 * admitting the same thing. Nothing here is new logic — it is the same four
 * branches (accept-gate, group levels, state, timeline) against the same refs,
 * with the suppression retired rather than moved.
 */

import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { ClipManifestClip, IframeWindow, PlaybackAdapter } from "../lib/playbackTypes";
import { hasTimelinePerformanceFixtureLease } from "../lib/timelinePerformanceFixture";
import { acceptStudioRuntimeMessage } from "../lib/runtimeProtocol";
import { groupLevels, parseGroupLevelsMessage } from "../store/groupLevels";
import { parseTimelineFromDOM } from "../lib/timelineDOM";

/** What `processTimelineMessage` accepts — the clip-manifest postMessage. */
export interface ClipManifestMessage {
  clips: ClipManifestClip[];
  durationInFrames: number;
  scenes?: Array<{ id: string; label: string; start: number; duration: number }>;
  protocolVersion?: unknown;
  capabilities?: unknown;
  fps?: unknown;
}

interface PreviewMessage {
  source?: string;
  type?: string;
  clips?: unknown;
}

export interface PreviewMessageRouterDeps {
  iframeRef: { current: HTMLIFrameElement | null };
  /** Kept as refs by the caller so the listener can be registered once. */
  processTimelineMessageRef: { current: (data: ClipManifestMessage) => void };
  enrichMissingCompositionsRef: { current: () => void };
  lastTimelineMessageRef: { current: number };
  getAdapter: () => PlaybackAdapter | null;
  syncTimelineElements: (elements: TimelineElement[]) => void;
}

/** True when the message did not come from OUR preview iframe. */
function isForeignSource(e: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  return Boolean(e.source && iframe && e.source !== iframe.contentWindow);
}

/** A preview message worth acting on, or null: the fixture lease, the sender
 *  check and the protocol accept-gate collapsed into one answer so the listener
 *  below stays a flat dispatch. */
function acceptedPreviewMessage(
  e: MessageEvent,
  iframe: HTMLIFrameElement | null,
): PreviewMessage | null {
  if (hasTimelinePerformanceFixtureLease()) return null;
  if (isForeignSource(e, iframe)) return null;
  const data = e.data as PreviewMessage | null;
  if (data?.source !== "hf-preview") return null;
  return acceptStudioRuntimeMessage(data) ? data : null;
}

/** One meter reading per group with an active member. */
function handleGroupLevelsMessage(data: PreviewMessage): void {
  const levels = parseGroupLevelsMessage(data);
  if (levels) groupLevels.notify(levels);
}

/**
 * A `state` tick doubles as a recovery hook: if the store still has no
 * elements, read the manifest straight off the iframe, and if no `timeline`
 * message has arrived recently, re-run enrichment.
 */
function handleStateMessage(
  deps: PreviewMessageRouterDeps,
  iframe: HTMLIFrameElement | null,
): void {
  try {
    if (usePlayerStore.getState().elements.length === 0) {
      const manifest = (iframe?.contentWindow as IframeWindow | null)?.__clipManifest;
      if (manifest && manifest.clips.length > 0) {
        deps.processTimelineMessageRef.current(manifest);
      }
    }
    if (Date.now() - deps.lastTimelineMessageRef.current > 500) {
      deps.enrichMissingCompositionsRef.current();
    }
  } catch {}
}

/**
 * The clip list. When it arrives empty-handed — the store still has nothing —
 * fall back to parsing the live DOM, which is the only source left before the
 * next tick.
 */
function handleTimelineMessage(
  deps: PreviewMessageRouterDeps,
  iframe: HTMLIFrameElement | null,
  data: ClipManifestMessage,
): void {
  deps.lastTimelineMessageRef.current = Date.now();
  deps.processTimelineMessageRef.current(data);
  deps.enrichMissingCompositionsRef.current();
  if (usePlayerStore.getState().elements.length > 0) return;
  try {
    const doc = iframe?.contentDocument;
    const adapter = deps.getAdapter();
    if (!doc || !adapter) return;
    const els = parseTimelineFromDOM(doc, adapter.getDuration());
    if (els.length > 0) deps.syncTimelineElements(els);
  } catch {}
}

export function createPreviewMessageHandler(
  deps: PreviewMessageRouterDeps,
): (e: MessageEvent) => void {
  return (e: MessageEvent) => {
    const iframe = deps.iframeRef.current;
    const data = acceptedPreviewMessage(e, iframe);
    if (!data) return;
    if (data.type === "group-levels") return handleGroupLevelsMessage(data);
    if (data.type === "state") return handleStateMessage(deps, iframe);
    if (data.type === "timeline" && Array.isArray(data.clips)) {
      handleTimelineMessage(deps, iframe, data as unknown as ClipManifestMessage);
    }
  };
}
