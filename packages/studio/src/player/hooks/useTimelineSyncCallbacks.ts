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
import type { TimelineElement, DomClipChild } from "../store/playerStore";
import type { PlaybackAdapter, ClipManifestClip, IframeWindow } from "../lib/playbackTypes";
import {
  parseTimelineFromDOM,
  createTimelineElementFromManifestClip,
  findTimelineDomNodeForClip,
  createImplicitTimelineLayersFromDOM,
  buildStandaloneRootTimelineElement,
  getTimelineElementSelector,
  readTimelineDurationFromDocument,
} from "../lib/timelineDOM";
import {
  normalizePreviewViewport,
  autoHealMissingCompositionIds,
  buildMissingCompositionElements,
} from "../lib/timelineIframeHelpers";
import { acceptedRuntimeMessageFps, inspectStudioRuntimeMessage } from "../lib/runtimeProtocol";

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

export function resolveReloadSeekTime(input: {
  pendingSeek: number | null;
  requestedSeek: number | null;
  storeCurrentTime: number;
  duration: number;
}): number {
  const target = input.pendingSeek ?? input.requestedSeek ?? input.storeCurrentTime;
  if (!Number.isFinite(target) || target <= 0) return 0;
  // Only clamp to duration when it's a usable positive number. A non-finite or
  // non-positive duration (e.g. the adapter reports NaN mid-reload) would turn
  // Math.min(target, NaN) into NaN and seek(NaN); return the guarded target
  // unclamped instead so the playhead lands at the intended position.
  if (!Number.isFinite(input.duration) || input.duration <= 0) return target;
  return Math.min(target, input.duration);
}

/** Reject non-finite, non-positive, and absurdly large (loop-inflated) values. */
function sanitizeDurationSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 && value < 7200 ? value : 0;
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
    (data: {
      clips: ClipManifestClip[];
      durationInFrames: number;
      scenes?: Array<{ id: string; label: string; start: number; duration: number }>;
      protocolVersion?: unknown;
      capabilities?: unknown;
      fps?: unknown;
    }) => {
      if (!data.clips || data.clips.length === 0) {
        return;
      }

      usePlayerStore.getState().setClipManifest(data.clips);

      // Show root-level clips: no parentCompositionId, OR parent is a "phantom wrapper"
      const clipCompositionIds = new Set(data.clips.map((c) => c.compositionId).filter(Boolean));
      const filtered = data.clips.filter(
        (clip) => !clip.parentCompositionId || !clipCompositionIds.has(clip.parentCompositionId),
      );
      let iframeDoc: Document | null = null;
      try {
        iframeDoc = iframeRef.current?.contentDocument ?? null;
      } catch {
        iframeDoc = null;
      }

      try {
        const iframeWin = iframeRef.current?.contentWindow as
          | (Window & { __clipTree?: import("@hyperframes/core/runtime/clipTree").ClipTree })
          | null;
        const clipTree = iframeWin?.__clipTree;
        const parentMap = new Map<string, string>();
        if (clipTree) {
          const walk = (nodes: typeof clipTree.roots) => {
            for (const node of nodes) {
              if (node.id && node.parentId) parentMap.set(node.id, node.parentId);
              if (node.children.length > 0) walk(node.children);
            }
          };
          walk(clipTree.roots);
        }

        // Descend into each sub-composition host: its internal elements (group
        // wrappers + their children) carry no `data-start`, so the clip
        // tree/manifest never enumerate them. Surface them studio-side as DOM
        // children + parent links so the timeline can expand a sub-comp/group
        // row to show them. Manifest stays lean (timed clips only).
        const domClipChildren: DomClipChild[] = [];
        if (iframeDoc) {
          for (const clip of data.clips) {
            if (clip.kind !== "composition" || !clip.id) continue;
            const hostEl = iframeDoc.getElementById(clip.id);
            if (!hostEl) continue;
            const hostId = clip.id;
            const innerRoot = hostEl.querySelector("[data-hf-inner-root]") ?? hostEl;
            // Collect the sub-comp's id'd descendants (grouped OR ungrouped) so they
            // expand into timeline rows. Descends through id-less structural wrappers
            // (the inlined sub-comp body), and one level into groups for drill-in.
            const collect = (parentEl: Element, parentId: string) => {
              for (const child of Array.from(parentEl.children)) {
                if (!child.id) {
                  collect(child, parentId); // unwrap id-less structural containers
                  continue;
                }
                const isGroup = child.hasAttribute("data-hf-group");
                domClipChildren.push({
                  id: child.id,
                  parentId,
                  hostId,
                  label: isGroup ? child.getAttribute("data-hf-group") || child.id : child.id,
                });
                parentMap.set(child.id, parentId);
                if (isGroup) collect(child, child.id);
              }
            };
            collect(innerRoot, hostId);
          }
        }
        usePlayerStore.getState().setClipParentMap(parentMap);
        usePlayerStore.getState().setDomClipChildren(domClipChildren);
      } catch {
        // cross-origin or __clipTree not available — maps stay empty
      }

      const usedHostEls = new Set<Element>();
      const els: TimelineElement[] = filtered.map((clip, index) => {
        const hostEl = iframeDoc
          ? findTimelineDomNodeForClip(iframeDoc, clip, index, usedHostEls)
          : null;
        if (hostEl) usedHostEls.add(hostEl);
        return createTimelineElementFromManifestClip({
          clip,
          fallbackIndex: index,
          doc: iframeDoc,
          hostEl,
        });
      });
      const rawDuration = data.durationInFrames / acceptedRuntimeMessageFps(data);
      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition. Floor the manifest total
      // at the authored root `data-duration` so a runtime that measures only the
      // furthest clip end (shorter than the authored window) can't leave a stale,
      // too-short total in the transport (the "0:44/0:40" bug).
      const newDuration = resolveTimelineTotalDuration({
        manifestDurationSeconds: rawDuration,
        authoredRootDurationSeconds: readTimelineDurationFromDocument(iframeDoc),
      });
      const effectiveDuration = newDuration > 0 ? newDuration : usePlayerStore.getState().duration;
      const clampedEls =
        effectiveDuration > 0
          ? els
              .filter((element) => element.start < effectiveDuration)
              .map((element) => ({
                ...element,
                duration: Math.min(element.duration, effectiveDuration - element.start),
              }))
              .filter((element) => element.duration > 0)
          : els;
      const timelineEls =
        iframeDoc && effectiveDuration > 0
          ? [
              ...clampedEls,
              ...createImplicitTimelineLayersFromDOM(iframeDoc, effectiveDuration, clampedEls),
            ]
          : clampedEls;
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
    // Honor a seek requested before the adapter was ready. It may sit in either
    // place: `pendingSeekRef` if the store subscription was mounted when requestSeek
    // fired, or only in the store's `requestedSeekTime` if it fired earlier still
    // (deep-link hydration runs before the player subscription mounts, so the request
    // never reaches pendingSeekRef). Reconciling with the store here is what makes a
    // deep-linked `?t=` land instead of starting at 0.
    const storeSeek = usePlayerStore.getState().requestedSeekTime;
    const startTime = resolveReloadSeekTime({
      pendingSeek: pendingSeekRef.current,
      requestedSeek: storeSeek,
      storeCurrentTime: usePlayerStore.getState().currentTime,
      duration: adapter.getDuration(),
    });
    pendingSeekRef.current = null;
    if (storeSeek != null) usePlayerStore.getState().clearSeekRequest();

    // Force a REAL render at startTime, not a no-op. After a post-edit reload the
    // freshly rebuilt GSAP timeline can already report being at `startTime`
    // internally (the reload restores the same playhead), so a single
    // `adapter.seek(startTime)` is a GSAP no-op — `tl.seek(t)` at the current time
    // doesn't re-evaluate. That's why a just-dropped clip stayed invisible until
    // the user nudged the playhead: its element's state was never applied at the
    // restore position. Seeking to a DIFFERENT guard value first (a hair off, or 0
    // when startTime is already ~0) guarantees the follow-up seek to `startTime`
    // crosses a time boundary and re-renders every clip — including the new one.
    const guardTime = startTime > 0.001 ? Math.max(0, startTime - 0.001) : 0.001;
    adapter.seek(guardTime);
    adapter.seek(startTime);
    // The correct frame is now rendered — reveal the iframe that refreshPlayer hid
    // for the reload, so the user sees the restored frame directly (never the raw
    // all-clips DOM). Cleared unconditionally: any later failure path must not leave
    // the preview stuck invisible.
    revealIframe(iframeRef.current);
    // Keep non-React listeners such as the capture link and time display in sync
    // with the initial adapter seek on iframe load.
    liveTime.notify(startTime);
    const adapterDur = adapter.getDuration();
    if (
      Number.isFinite(adapterDur) &&
      adapterDur > 0 &&
      adapterDur < 7200 &&
      adapterDur !== usePlayerStore.getState().duration
    ) {
      setDuration(adapterDur);
    }
    setCurrentTime(startTime);
    if (!isRefreshingRef.current) {
      setTimelineReady(true);
    }
    isRefreshingRef.current = false;
    setIsPlaying(false);

    try {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const iframeWin = iframe?.contentWindow as IframeWindow | null;
      if (doc && iframeWin) {
        normalizePreviewViewport(doc, iframeWin);
        autoHealMissingCompositionIds(doc);
        attachIframeShortcutListeners();
      }

      const manifest = iframeWin?.__clipManifest;
      if (manifest && manifest.clips.length > 0) {
        processTimelineMessage(manifest);
      }
      enrichMissingCompositions();
      applyPreviewAudioState();

      if (usePlayerStore.getState().elements.length === 0 && doc) {
        const els = parseTimelineFromDOM(doc, adapter.getDuration());
        if (els.length > 0) syncTimelineElements(els);
      }
      if (usePlayerStore.getState().elements.length === 0 && doc) {
        const rootComp = doc.querySelector("[data-composition-id]");
        const rootDuration = adapter.getDuration();
        if (rootComp && rootDuration > 0) {
          const fallbackElement = buildStandaloneRootTimelineElement({
            compositionId: rootComp.getAttribute("data-composition-id") || "composition",
            tagName: (rootComp as HTMLElement).tagName || "div",
            rootDuration,
            iframeSrc: iframe?.src || "",
            selector: getTimelineElementSelector(rootComp),
          });
          if (fallbackElement) syncTimelineElements([fallbackElement]);
        }
      }
    } catch {}
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
      if (e.source && iframe && e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (data?.source === "hf-preview" && (data?.type === "state" || data?.type === "timeline")) {
        // The main message handler owns protocol-error diagnostics. This readiness-only
        // listener mirrors its acceptance gate without dispatching a duplicate event:
        // an unsupported runtime must not make the iframe appear successfully settled.
        if (inspectStudioRuntimeMessage(data).status === "unsupported") return;
        trySettle();
      }
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
