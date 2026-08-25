/**
 * React callbacks for synchronising the player store from iframe runtime data.
 *
 * Covers four related concerns:
 *  - processTimelineMessage  — turn a clip-manifest postMessage into TimelineElements
 *  - enrichMissingCompositions — fill gaps the manifest misses (element-ref starts)
 *  - initializeAdapter        — called after iframe load: seek, set duration, read elements
 *  - onIframeLoad             — orchestrates initializeAdapter with a message-based fallback
 */

import { useCallback } from "react";
import { liveTime, usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter, IframeWindow } from "../lib/playbackTypes";
import { readTimelineDurationFromDocument } from "../lib/timelineDOM";
import { buildMissingCompositionElements } from "../lib/timelineIframeHelpers";
import { acceptedRuntimeMessageFps } from "../lib/runtimeProtocol";
import {
  buildTimelineElementsFromClips,
  clipTreeParentMap,
  collectSubCompositionDomChildren,
  hydrateTimelineFromPreview,
  isPreviewReadinessMessage,
  safeContentDocument,
  sanitizeDurationSeconds,
  seekAdapterToRestorePoint,
  syncAdapterDuration,
  withImplicitDomLayers,
  type RuntimeTimelineMessage,
} from "./timelineSyncHydration";

// Re-exported for the tests and callers that have always imported it from here.
export { resolveReloadSeekTime } from "./timelineSyncHydration";

interface UseTimelineSyncCallbacksParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  probeIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | undefined>;
  pendingSeekRef: React.MutableRefObject<number | null>;
  isRefreshingRef: React.MutableRefObject<boolean>;
  getAdapter: () => PlaybackAdapter | null;
  syncTimelineElements: (elements: TimelineElement[], nextDuration?: number) => void;
  setDuration: (v: number) => void;
  setCurrentTime: (v: number) => void;
  setTimelineReady: (v: boolean) => void;
  setIsPlaying: (v: boolean) => void;
  attachIframeShortcutListeners: () => void;
  applyPreviewAudioState: () => void;
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
/**
 * Undo the `visibility: hidden` that refreshPlayer sets across a full reload.
 * Safe to call when the iframe was never hidden (idempotent no-op). Every reload
 * completion + failure path funnels through here so the preview can never get
 * stuck invisible.
 */
export function revealIframe(iframe: HTMLIFrameElement | null): void {
  if (iframe && iframe.style.visibility === "hidden") {
    iframe.style.visibility = "";
  }
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

export function useTimelineSyncCallbacks({
  iframeRef,
  probeIntervalRef,
  pendingSeekRef,
  isRefreshingRef,
  getAdapter,
  syncTimelineElements,
  setDuration,
  setCurrentTime,
  setTimelineReady,
  setIsPlaying,
  attachIframeShortcutListeners,
  applyPreviewAudioState,
}: UseTimelineSyncCallbacksParams) {
  // Convert a runtime timeline message (from iframe postMessage) into TimelineElements
  const processTimelineMessage = useCallback(
    (data: RuntimeTimelineMessage) => {
      if (!data.clips || data.clips.length === 0) {
        return;
      }

      usePlayerStore.getState().setClipManifest(data.clips);

      // Show root-level clips: no parentCompositionId, OR parent is a "phantom wrapper"
      const clipCompositionIds = new Set(data.clips.map((c) => c.compositionId).filter(Boolean));
      const filtered = data.clips.filter(
        (clip) => !clip.parentCompositionId || !clipCompositionIds.has(clip.parentCompositionId),
      );
      const iframeDoc = safeContentDocument(iframeRef.current);

      try {
        const parentMap = clipTreeParentMap(iframeRef.current?.contentWindow ?? null);
        const domClipChildren = collectSubCompositionDomChildren(iframeDoc, data.clips, parentMap);
        usePlayerStore.getState().setClipParentMap(parentMap);
        usePlayerStore.getState().setDomClipChildren(domClipChildren);
      } catch {
        // cross-origin or __clipTree not available — maps stay empty
      }

      const els = buildTimelineElementsFromClips(filtered, iframeDoc);
      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition. Floor the manifest total
      // at the authored root `data-duration` so a runtime that measures only the
      // furthest clip end (shorter than the authored window) can't leave a stale,
      // too-short total in the transport (the "0:44/0:40" bug).
      const newDuration = resolveTimelineTotalDuration({
        manifestDurationSeconds: data.durationInFrames / acceptedRuntimeMessageFps(data),
        authoredRootDurationSeconds: readTimelineDurationFromDocument(iframeDoc),
      });
      const timelineEls = withImplicitDomLayers(
        els,
        iframeDoc,
        newDuration > 0 ? newDuration : usePlayerStore.getState().duration,
      );
      if (timelineEls.length > 0) {
        syncTimelineElements(timelineEls, newDuration > 0 ? newDuration : undefined);
      }
    },
    [iframeRef, syncTimelineElements],
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

  const initializeAdapter = useCallback(() => {
    const adapter = getAdapter();
    if (!adapter || adapter.getDuration() <= 0) return false;

    adapter.pause();
    const startTime = seekAdapterToRestorePoint(adapter, pendingSeekRef);
    // The correct frame is now rendered — reveal the iframe that refreshPlayer hid
    // for the reload, so the user sees the restored frame directly (never the raw
    // all-clips DOM). Cleared unconditionally: any later failure path must not leave
    // the preview stuck invisible.
    revealIframe(iframeRef.current);
    // Keep non-React listeners such as the capture link and time display in sync
    // with the initial adapter seek on iframe load.
    liveTime.notify(startTime);
    syncAdapterDuration(adapter, setDuration);
    setCurrentTime(startTime);
    if (!isRefreshingRef.current) {
      setTimelineReady(true);
    }
    isRefreshingRef.current = false;
    setIsPlaying(false);

    hydrateTimelineFromPreview({
      iframe: iframeRef.current,
      adapter,
      processTimelineMessage,
      enrichMissingCompositions,
      applyPreviewAudioState,
      attachIframeShortcutListeners,
      syncTimelineElements,
    });
    return true;
  }, [
    getAdapter,
    setDuration,
    setCurrentTime,
    setTimelineReady,
    setIsPlaying,
    processTimelineMessage,
    enrichMissingCompositions,
    syncTimelineElements,
    attachIframeShortcutListeners,
    applyPreviewAudioState,
    iframeRef,
    isRefreshingRef,
    pendingSeekRef,
  ]);

  const onIframeLoad = useCallback(() => {
    applyPreviewAudioState();
    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);

    // Fast path: adapter already available (in-place reloads, cached compositions)
    if (initializeAdapter()) return;

    // The runtime posts "state" or "timeline" messages once ready.
    // Listen for those instead of polling.
    const iframe = iframeRef.current;
    let settled = false;

    const trySettle = () => {
      if (settled) return;
      if (initializeAdapter()) {
        settled = true;
        window.removeEventListener("message", onMessage);
        if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (isPreviewReadinessMessage(e, iframe)) trySettle();
    };
    window.addEventListener("message", onMessage);

    // Safety net: if no message arrives within 5s, try one last time then give up.
    probeIntervalRef.current = setTimeout(() => {
      if (!settled) {
        trySettle();
      }
      window.removeEventListener("message", onMessage);
      // Never leave the preview stuck invisible if the runtime never settled
      // (initializeAdapter reveals on success; this covers the give-up case).
      revealIframe(iframeRef.current);
    }, 5000) as unknown as ReturnType<typeof setInterval>;
  }, [initializeAdapter, iframeRef, probeIntervalRef, applyPreviewAudioState]);

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
  };
}
