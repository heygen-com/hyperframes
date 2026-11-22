/**
 * The `window.message` router for the preview iframe.
 *
 * Extracted from `useTimelinePlayer`, which had grown past the studio's 600-line
 * file cap and carried a `fallow-ignore-next-line complexity` on this function
 * admitting the same thing. Nothing here is new logic — it is the same three
 * branches (accept-gate, state, timeline) against the same refs, with the
 * suppression retired rather than moved. The group-levels branch went with the
 * level meter it fed (see the group volume/meter removal).
 */

import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { ClipManifestClip, IframeWindow, PlaybackAdapter } from "../lib/playbackTypes";
import { hasTimelinePerformanceFixtureLease } from "../lib/timelinePerformanceFixture";
import { acceptStudioRuntimeMessage, postRuntimeControlMessage } from "../lib/runtimeProtocol";
import {
  parseMediaLoadFailure,
  RUNTIME_MEDIA_LOAD_FAILED,
} from "@hyperframes/core/runtime/protocol";
import {
  parsePlaybackHealth,
  parsePreviewCopies,
  parsePreviewFacts,
} from "../store/previewQualitySlice";
import { parseTimelineFromDOM } from "../lib/timelineDOM";
import { previewClipManifest, previewFrameOpaque } from "../lib/previewChannel";
import { wellFormedClips } from "../lib/manifestClips";
import { frameOrigins } from "../lib/bridgePlayback";

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
  isPlaying?: unknown;
  copies?: unknown;
  health?: unknown;
  facts?: unknown;
  code?: unknown;
  details?: unknown;
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

/** True only for a post by our preview iframe's window, from an origin that frame can have. */
function fromOurPreview(e: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  if (!iframe || !e.source || e.source !== iframe.contentWindow) return false;
  return frameOrigins(iframe).includes(e.origin);
}

/** A preview message worth acting on, or null: the fixture lease, the sender
 *  check and the protocol accept-gate collapsed into one answer so the listener
 *  below stays a flat dispatch. */
function acceptedPreviewMessage(
  e: MessageEvent,
  iframe: HTMLIFrameElement | null,
): PreviewMessage | null {
  if (hasTimelinePerformanceFixtureLease()) return null;
  if (!fromOurPreview(e, iframe)) return null;
  const data = e.data as PreviewMessage | null;
  if (data?.source !== "hf-preview") return null;
  return acceptStudioRuntimeMessage(data) ? data : null;
}

/** Whether enrichment is due: no timeline message and no enrichment of ours for 500 ms. Marks it run. */
function enrichDue(lastTimelineMessage: number, enriched: { at: number }): boolean {
  const now = Date.now();
  if (now - lastTimelineMessage <= 500 || now - enriched.at <= 500) return false;
  enriched.at = now;
  return true;
}

interface Recovery {
  asking: boolean;
  heard: WeakSet<HTMLIFrameElement>;
}

const timelineOwed = (iframe: HTMLIFrameElement | null, recovery: Recovery) =>
  usePlayerStore.getState().elements.length === 0 ||
  (iframe !== null && !recovery.heard.has(iframe));

function takeManifest(
  deps: PreviewMessageRouterDeps,
  iframe: HTMLIFrameElement,
  recovery: Recovery,
  manifest: ClipManifestMessage,
): void {
  recovery.heard.add(iframe);
  if (manifest.clips.length > 0) deps.processTimelineMessageRef.current(manifest);
}

/** Asks the runtime for its clip manifest, one request at a time, while the frame still owes it. */
function recoverClipManifest(
  deps: PreviewMessageRouterDeps,
  iframe: HTMLIFrameElement,
  recovery: Recovery,
): void {
  if (recovery.asking) return;
  recovery.asking = true;
  previewClipManifest(iframe)
    .then((manifest) => {
      const stillWanted =
        timelineOwed(iframe, recovery) &&
        deps.iframeRef.current === iframe &&
        !hasTimelinePerformanceFixtureLease();
      if (manifest && stillWanted) takeManifest(deps, iframe, recovery, manifest);
    })
    .catch(() => {})
    .finally(() => (recovery.asking = false));
}

/** A reloaded frame posts its clip list while hidden, before it is the frame this router hears: read it once live. */
function recoverTimeline(
  deps: PreviewMessageRouterDeps,
  iframe: HTMLIFrameElement | null,
  recovery: Recovery,
): void {
  if (iframe && previewFrameOpaque(iframe)) return recoverClipManifest(deps, iframe, recovery);
  const manifest = (iframe?.contentWindow as IframeWindow | null)?.__clipManifest;
  if (iframe && manifest) takeManifest(deps, iframe, recovery, manifest);
}

/**
 * A `state` tick doubles as a recovery hook: if the live frame still owes its
 * clip list (timelineOwed), read its manifest, and if no `timeline`
 * message has arrived recently, re-run enrichment (at most every 500 ms: it queries the whole document).
 */
function handleStateMessage(
  deps: PreviewMessageRouterDeps,
  iframe: HTMLIFrameElement | null,
  playingHoldsClipListPosts: boolean,
  enriched: Recovery & { at: number },
): void {
  try {
    if (timelineOwed(iframe, enriched)) recoverTimeline(deps, iframe, enriched);
    if (!playingHoldsClipListPosts && enrichDue(deps.lastTimelineMessageRef.current, enriched)) {
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
  recovery: Recovery,
): void {
  deps.lastTimelineMessageRef.current = Date.now();
  if (iframe) recovery.heard.add(iframe);
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

function applyStoreReport(data: PreviewMessage): boolean {
  const store = usePlayerStore.getState();
  switch (data.type) {
    case "preview-copies":
      store.setPreviewCopies(parsePreviewCopies(data.copies));
      return true;
    case "preview-health":
      store.setPlaybackHealth(parsePlaybackHealth(data.health));
      return true;
    case "preview-facts":
      store.setPreviewFacts(parsePreviewFacts(data.facts));
      return true;
    case "diagnostic": {
      if (data.code !== RUNTIME_MEDIA_LOAD_FAILED) return false;
      const failure = parseMediaLoadFailure(data.details);
      if (failure) store.setMediaLoadFailure(failure);
      return true;
    }
    default:
      return false;
  }
}

export function createPreviewMessageHandler(
  deps: PreviewMessageRouterDeps,
): (e: MessageEvent) => void {
  const enriched = { at: 0, asking: false, heard: new WeakSet<HTMLIFrameElement>() };
  return (e: MessageEvent) => {
    const iframe = deps.iframeRef.current;
    const data = acceptedPreviewMessage(e, iframe);
    if (!data) return;
    if (data.type === "state")
      return handleStateMessage(deps, iframe, data.isPlaying === true, enriched);
    if (applyStoreReport(data)) return;
    if (data.type === "ready") {
      const level = usePlayerStore.getState().previewQuality;
      postRuntimeControlMessage(iframe?.contentWindow, "set-preview-quality", { level });
      return;
    }
    if (data.type === "timeline" && Array.isArray(data.clips)) {
      const message = { ...data, clips: wellFormedClips(data.clips) };
      handleTimelineMessage(deps, iframe, message as unknown as ClipManifestMessage, enriched);
    }
  };
}
