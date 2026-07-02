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
} from "../lib/timelineDOM";
import {
  normalizePreviewViewport,
  autoHealMissingCompositionIds,
  buildMissingCompositionElements,
} from "../lib/timelineIframeHelpers";

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
      const rawDuration = data.durationInFrames / 30;
      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition.
      const newDuration = Number.isFinite(rawDuration) && rawDuration < 7200 ? rawDuration : 0;
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
    const seekTo = pendingSeekRef.current ?? storeSeek;
    pendingSeekRef.current = null;
    if (storeSeek != null) usePlayerStore.getState().clearSeekRequest();
    const startTime = seekTo != null ? Math.min(seekTo, adapter.getDuration()) : 0;

    adapter.seek(startTime);
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
