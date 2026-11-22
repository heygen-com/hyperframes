/**
 * React callbacks for synchronising the player store from iframe runtime data.
 *
 * Covers four related concerns:
 *  - processTimelineMessage  — turn a clip-manifest postMessage into TimelineElements
 *  - enrichMissingCompositions — fill gaps the manifest misses (element-ref starts)
 *  - initializeAdapter        — called after iframe load: seek, set duration, read elements
 *  - onIframeLoad             — orchestrates initializeAdapter with a message-based fallback
 */

import { useCallback, useRef } from "react";
import { liveTime, usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter, IframeWindow } from "../lib/playbackTypes";
import { readTimelineDurationFromDocument } from "../lib/timelineDOM";
import { buildMissingCompositionElements } from "../lib/timelineIframeHelpers";
import { acceptedRuntimeMessageFps } from "../lib/runtimeProtocol";
import { previewClipParents, previewDocumentCopy, previewFrameOpaque } from "../lib/previewChannel";
import { useLinkedClipPreferences } from "../../utils/linkedClipPreferences";
import {
  buildTimelineElementsFromClips,
  fallbackTimelineFromDom,
  syncManifestTimeline,
  clipTreeParentMap,
  collectSubCompositionDomChildren,
  collectSubCompositionHostState,
  hydrateTimelineFromPreview,
  isPreviewReadinessMessage,
  safeContentDocument,
  sanitizeDurationSeconds,
  seekAdapterToRestorePoint,
  syncAdapterDuration,
  type RuntimeTimelineMessage,
  type SealedTimelineRead,
} from "./timelineSyncHydration";
import {
  landTimelineRevision,
  nextTimelineRevision,
  supersedeTimelineReads,
} from "../lib/timelineRevision";

// Re-exported for the tests and callers that have always imported it from here.
export { resolveReloadSeekTime } from "./timelineSyncHydration";

export interface UseTimelineSyncCallbacksParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  probeIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | undefined>;
  pendingSeekRef: React.MutableRefObject<number | null>;
  isRefreshingRef: React.MutableRefObject<boolean>;
  getAdapter: () => PlaybackAdapter | null;
  syncTimelineElements: (elements: TimelineElement[], nextDuration?: number) => void;
  setDuration: (v: number) => void;
  setCurrentTime: (v: number) => void;
  requestTimelineReady: (doc: Document | null) => void;
  setIsPlaying: (v: boolean) => void;
  attachIframeShortcutListeners: () => void;
  applyPreviewAudioState: () => void;
  /**
   * Fires once the restore-seek is issued and owns when `commit` (the store hydration) runs.
   * The default reveals the iframe and commits at once; a shadow reload defers it to promotion.
   */
  onAdapterReady?: (
    iframe: HTMLIFrameElement | null,
    context: number | undefined,
    commit: () => void,
  ) => void;
  /** False when the load for `context` was superseded: it must then cause no side effects. */
  isCurrent?: (context?: number) => boolean;
  /** Fires when no adapter appeared within the wait window. */
  onLoadGiveUp?: (context?: number) => void;
  hostOwnsDeadline?: boolean;
  /** The frame on screen, when it is not this hook's own (a shadow, hidden until promoted). */
  liveFrame?: () => HTMLIFrameElement | null;
}

/**
 * Where should the player seek when the preview (re)loads?
 * Priority: explicit pending seek (saved by refreshPlayer right before a
 * reload) → store-level seek request (deep-link `?t=` hydration) → the store's
 * last known playhead. The last fallback makes the playhead RELOAD-INVARIANT:
 * edits persist + reload the preview, sometimes more than once (App's
 * refreshPreviewDocumentVersion staggers extra bumps at 80/300ms), and the
 * consume-once pendingSeekRef meant any reload after the first found the slot
 * empty and reset the playhead to 0 — the "dropped a file and the playhead
 * jumped to 0" bug. Falling back to the store's playhead means every reload
 * restores position; a fresh project load still starts at 0 because the store
 * resets currentTime on project switch. Invariant: an edit NEVER moves the
 * playhead (the clamp below is the one sanctioned move — content shrank past it).
 */
/** Undo a hidden `visibility` on an iframe; idempotent no-op otherwise. */
export function revealIframe(iframe: HTMLIFrameElement | null): void {
  if (iframe && iframe.style.visibility === "hidden") {
    iframe.style.visibility = "";
  }
}

function revealAndCommit(
  iframe: HTMLIFrameElement | null,
  _context: number | undefined,
  commit: () => void,
): void {
  revealIframe(iframe);
  commit();
}

export type PreviewIframeRole = "live" | "shadow";

export interface PreviewIframeSlot {
  gen: number;
  role: PreviewIframeRole;
  url?: string;
}

/** Queue a hidden shadow slot for the reload URL, replacing any earlier unpromoted shadow. */
export function planShadowReload(
  slots: PreviewIframeSlot[],
  nextGen: number,
  url: string,
): PreviewIframeSlot[] {
  const live = slots.find((slot) => slot.role === "live");
  return live ? [live, { gen: nextGen, role: "shadow", url }] : [{ gen: nextGen, role: "live" }];
}

export function planShadowAlone(nextGen: number, url: string): PreviewIframeSlot[] {
  return [{ gen: nextGen, role: "shadow", url }];
}

/** Drop any pending shadow; the live slot (and its key) is untouched. */
export function planShadowDiscard(slots: PreviewIframeSlot[]): PreviewIframeSlot[] {
  return slots.filter((slot) => slot.role === "live");
}

/** Atomically make the ready shadow the only (live) slot; a stale readyGen is a no-op. */
export function planShadowPromotion(
  slots: PreviewIframeSlot[],
  readyGen: number,
): PreviewIframeSlot[] {
  const ready = slots.find((slot) => slot.gen === readyGen && slot.role === "shadow");
  return ready ? [{ ...ready, role: "live" }] : slots;
}

/**
 * The transport TOTAL a clip-manifest message should write to the store.
 *
 * The manifest's `durationInFrames` measures the runtime timeline; some runtimes
 * report only the furthest clip end and ignore the root composition's authored
 * `data-duration`. When that manifest total is SHORTER than the authored root
 * duration, writing it makes the readout stale (playback still runs the full
 * authored window — the user saw "0:44/0:40" on a root authored at 44.5s whose
 * last clip ends at 40s). The authored root duration is the floor for the total,
 * so the readout can never sit below what the file declares. A manifest total
 * that is LONGER (clips extend past the root) still wins — content can only grow
 * the timeline, never shrink it below the authored window.
 */
export function resolveTimelineTotalDuration(input: {
  manifestDurationSeconds: number;
  authoredRootDurationSeconds: number;
}): number {
  return Math.max(
    sanitizeDurationSeconds(input.manifestDurationSeconds),
    sanitizeDurationSeconds(input.authoredRootDurationSeconds),
  );
}

/** A same-origin frame's clip tree, read in place; a frame that refuses the read has none. */
function openClipParents(iframe: HTMLIFrameElement | null): Map<string, string> {
  try {
    return clipTreeParentMap(iframe?.contentWindow ?? null);
  } catch {
    return new Map();
  }
}

export function useTimelineSyncCallbacks({
  iframeRef,
  probeIntervalRef,
  pendingSeekRef,
  isRefreshingRef,
  getAdapter,
  syncTimelineElements,
  setDuration,
  setCurrentTime,
  requestTimelineReady,
  setIsPlaying,
  attachIframeShortcutListeners,
  applyPreviewAudioState,
  onAdapterReady = revealAndCommit,
  isCurrent,
  onLoadGiveUp,
  hostOwnsDeadline,
  liveFrame,
}: UseTimelineSyncCallbacksParams) {
  const onScreen = useCallback(
    () => (liveFrame ? liveFrame() : iframeRef.current),
    [liveFrame, iframeRef],
  );
  // Convert a runtime timeline message (from iframe postMessage) into TimelineElements
  const applyTimelineMessage = useCallback(
    (
      data: RuntimeTimelineMessage,
      iframeDoc: Document | null,
      parentMap: Map<string, string>,
      iframe: HTMLIFrameElement | null,
      previewDuration: number,
      revision: number,
    ) => {
      // A read lands only from the frame on screen, and only over nothing newer.
      if (iframe !== onScreen() || !landTimelineRevision(revision)) return;
      usePlayerStore.getState().setClipManifest(data.clips);
      // Show root-level clips: no parentCompositionId, OR parent is a "phantom wrapper"
      const clipCompositionIds = new Set(data.clips.map((c) => c.compositionId).filter(Boolean));
      const filtered = data.clips.filter(
        (clip) => !clip.parentCompositionId || !clipCompositionIds.has(clip.parentCompositionId),
      );
      try {
        const domClipChildren = collectSubCompositionDomChildren(iframeDoc, data.clips, parentMap);
        usePlayerStore.getState().setClipParentMap(parentMap);
        usePlayerStore.getState().setDomClipChildren(domClipChildren);
        usePlayerStore
          .getState()
          .setSubCompositionHostState(collectSubCompositionHostState(iframeDoc, data.clips));
      } catch {
        // A document the walk cannot read leaves the maps empty.
      }

      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition. Floor the manifest total
      // at the authored root `data-duration` so a runtime that measures only the
      // furthest clip end (shorter than the authored window) can't leave a stale,
      // too-short total in the transport (the "0:44/0:40" bug).
      const fps = acceptedRuntimeMessageFps(data);
      useLinkedClipPreferences.getState().setCompositionFps(fps);
      const newDuration = resolveTimelineTotalDuration({
        manifestDurationSeconds: data.durationInFrames / fps,
        authoredRootDurationSeconds: readTimelineDurationFromDocument(iframeDoc),
      });
      // The composition's own row keeps its exact length; the transport total is frame-rounded.
      const ownDuration =
        sanitizeDurationSeconds(readTimelineDurationFromDocument(iframeDoc)) ||
        sanitizeDurationSeconds(previewDuration) ||
        newDuration;
      const fallback = data.clips.length === 0 && iframeDoc !== null;
      const els = fallback
        ? fallbackTimelineFromDom(iframeDoc, iframe, ownDuration)
        : buildTimelineElementsFromClips(filtered, iframeDoc);
      syncManifestTimeline(
        els,
        fallback ? Math.max(newDuration, ownDuration) : newDuration,
        usePlayerStore.getState().duration,
        syncTimelineElements,
      );
    },
    [onScreen, syncTimelineElements],
  );

  // A sealed frame's rows bind to its document copy and clip tree from the editing port.
  const readSealedTimeline = useCallback<SealedTimelineRead>(
    (iframe, manifest, previewDuration) => {
      const revision = nextTimelineRevision();
      void Promise.all([manifest, previewDocumentCopy(iframe), previewClipParents(iframe)]).then(
        ([data, doc, parents]) => {
          // A frame its player removed is gone: callback refs keep it (promotion repoints them), the page does not.
          if (data && iframe.isConnected)
            applyTimelineMessage(data, doc, parents, iframe, previewDuration, revision);
        },
      );
    },
    [applyTimelineMessage],
  );

  const processTimelineMessage = useCallback(
    (data: RuntimeTimelineMessage) => {
      if (!data.clips) return;
      const iframe = iframeRef.current;
      const previewDuration = getAdapter()?.getDuration() ?? 0;
      if (iframe && previewFrameOpaque(iframe))
        return readSealedTimeline(iframe, Promise.resolve(data), previewDuration);
      const doc = safeContentDocument(iframe);
      const parents = openClipParents(iframe);
      applyTimelineMessage(data, doc, parents, iframe, previewDuration, nextTimelineRevision());
    },
    [iframeRef, getAdapter, readSealedTimeline, applyTimelineMessage],
  );

  const enrichMissingCompositions = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const iframeWin = iframe?.contentWindow as IframeWindow | null;
      if (!doc || !iframeWin) return;

      const currentEls = usePlayerStore.getState().elements;
      const rootDuration = usePlayerStore.getState().duration;
      const { missing, updatedEls, patched } = buildMissingCompositionElements(
        doc,
        iframeWin,
        currentEls,
        rootDuration,
      );

      if (missing.length > 0 || patched) {
        // Dedup: ensure no missing element duplicates an existing one
        const finalIds = new Set(updatedEls.map((e) => e.id));
        const dedupedMissing = missing.filter((m) => !finalIds.has(m.id));
        syncTimelineElements([...updatedEls, ...dedupedMissing]);
      }
    } catch {}
  }, [iframeRef, syncTimelineElements]);

  const initializeAdapter = useCallback(
    (context?: number) => {
      if (isCurrent && !isCurrent(context)) return true;
      const adapter = getAdapter();
      if (!adapter || adapter.getDuration() <= 0) return false;

      adapter.pause();
      const startTime = seekAdapterToRestorePoint(adapter, pendingSeekRef);
      const commit = () => {
        // Keep non-React listeners such as the time display in sync
        // with the initial adapter seek on iframe load.
        liveTime.notify(startTime);
        syncAdapterDuration(adapter, setDuration);
        setCurrentTime(startTime);
        if (!isRefreshingRef.current) {
          // Enables Play from actual play-readiness, not just a known duration —
          // a click before this resolves used to start the timeline with media,
          // images or fonts still loading and never recover.
          requestTimelineReady(safeContentDocument(iframeRef.current));
        }
        isRefreshingRef.current = false;
        setIsPlaying(false);

        hydrateTimelineFromPreview({
          iframe: iframeRef.current,
          adapter,
          processTimelineMessage,
          readSealedTimeline,
          enrichMissingCompositions,
          applyPreviewAudioState,
          attachIframeShortcutListeners,
          syncTimelineElements,
        });
      };
      onAdapterReady(iframeRef.current, context, commit);
      return true;
    },
    [
      getAdapter,
      setDuration,
      setCurrentTime,
      requestTimelineReady,
      setIsPlaying,
      processTimelineMessage,
      readSealedTimeline,
      enrichMissingCompositions,
      syncTimelineElements,
      attachIframeShortcutListeners,
      applyPreviewAudioState,
      onAdapterReady,
      isCurrent,
      iframeRef,
      isRefreshingRef,
      pendingSeekRef,
    ],
  );

  // Drops the previous load's readiness listener so a superseded load cannot settle later.
  const stopWaitingRef = useRef<(() => void) | null>(null);

  const onIframeLoad = useCallback(
    (context?: number) => {
      if (onScreen() === iframeRef.current) supersedeTimelineReads();
      const loadedDoc = safeContentDocument(iframeRef.current);
      if (loadedDoc) usePlayerStore.getState().markPreviewLoadStep(loadedDoc);
      applyPreviewAudioState();
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
      stopWaitingRef.current?.();
      stopWaitingRef.current = null;

      // Fast path: adapter already available (in-place reloads, cached compositions)
      if (initializeAdapter(context)) return;

      // The runtime posts "state" or "timeline" messages once ready.
      // Listen for those instead of polling.
      const iframe = iframeRef.current;
      let settled = false;
      let retryFrame = 0;
      const stopWaiting = () => {
        window.removeEventListener("message", onMessage);
        cancelAnimationFrame(retryFrame);
      };

      const trySettle = () => {
        if (settled) return;
        if (initializeAdapter(context)) {
          settled = true;
          stopWaiting();
          if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
          return;
        }
        cancelAnimationFrame(retryFrame);
        retryFrame = requestAnimationFrame(trySettle);
      };

      const onMessage = (e: MessageEvent) => {
        if (isPreviewReadinessMessage(e, iframe)) trySettle();
      };
      window.addEventListener("message", onMessage);
      stopWaitingRef.current = stopWaiting;
      if (hostOwnsDeadline) return;

      // Safety net: if no message arrives within 5s, try one last time then give up.
      probeIntervalRef.current = setTimeout(() => {
        if (!settled) {
          trySettle();
        }
        stopWaiting();
        if (!settled) onLoadGiveUp?.(context);
        revealIframe(iframeRef.current);
      }, 5000) as unknown as ReturnType<typeof setInterval>;
    },
    [
      initializeAdapter,
      iframeRef,
      probeIntervalRef,
      applyPreviewAudioState,
      onLoadGiveUp,
      hostOwnsDeadline,
      onScreen,
    ],
  );

  const cancelPendingLoad = useCallback(() => {
    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
    stopWaitingRef.current?.();
    stopWaitingRef.current = null;
  }, [probeIntervalRef]);

  // Stable refs so mount-effect closures always call the latest version
  const processTimelineMessageRef = { current: processTimelineMessage };
  const enrichMissingCompositionsRef = { current: enrichMissingCompositions };

  return {
    processTimelineMessage,
    processTimelineMessageRef,
    enrichMissingCompositions,
    enrichMissingCompositionsRef,
    initializeAdapter,
    onIframeLoad,
    cancelPendingLoad,
  };
}
