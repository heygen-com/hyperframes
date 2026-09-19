// Loads a full-reload edit in a hidden shadow iframe and promotes it once painted,
// so the live iframe never shows a blank frame.

import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { logReload } from "../../utils/reloadDebug";
import {
  useTimelineSyncCallbacks,
  planShadowReload,
  planShadowPromotion,
  planShadowDiscard,
  type PreviewIframeSlot,
  type UseTimelineSyncCallbacksParams,
} from "./useTimelineSyncCallbacks";
import type { PlaybackAdapter } from "../lib/playbackTypes";

// The Player caps its own asset wait at 10s; leave room for the load and shader loader on top.
export const SHADOW_READY_TIMEOUT_MS = 15_000;

type UseShadowPreviewReloadParams = Omit<
  UseTimelineSyncCallbacksParams,
  "probeIntervalRef" | "onAdapterReady" | "getAdapter" | "isCurrent" | "onLoadGiveUp"
> & {
  getAdapter: (overrideIframe?: HTMLIFrameElement | null) => PlaybackAdapter | null;
  /** Runs right after a shadow becomes the live iframe (iframeRef already points at it). */
  onPromoted?: () => void;
  /** A shadow that never became ready was dropped; the live preview is unchanged. */
  onReloadFailed?: (message: string) => void;
};

export function useShadowPreviewReload({
  iframeRef,
  getAdapter,
  pendingSeekRef,
  isRefreshingRef,
  syncTimelineElements,
  setDuration,
  setCurrentTime,
  requestTimelineReady,
  setIsPlaying,
  attachIframeShortcutListeners,
  applyPreviewAudioState,
  onPromoted,
  onReloadFailed,
}: UseShadowPreviewReloadParams) {
  const shadowIframeRef = useRef<HTMLIFrameElement | null>(null);
  const shadowProbeIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Invalidation counter, separate from the live slot's key: bumping it never remounts the live Player.
  const shadowGenRef = useRef(0);
  const pendingCommitRef = useRef<{ gen: number; commit: () => void } | null>(null);
  const visuallyReadyGenRef = useRef<number | null>(null);
  const onPromotedRef = useRef(onPromoted);
  onPromotedRef.current = onPromoted;
  const onReloadFailedRef = useRef(onReloadFailed);
  onReloadFailedRef.current = onReloadFailed;
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelPendingLoadRef = useRef<() => void>(() => {});
  const [previewSlots, setPreviewSlots] = useState<PreviewIframeSlot[]>([{ gen: 0, role: "live" }]);

  const stopPendingShadow = useCallback(() => {
    clearTimeout(readyTimerRef.current);
    cancelPendingLoadRef.current();
    pendingCommitRef.current = null;
    visuallyReadyGenRef.current = null;
  }, []);

  const failShadow = useCallback(
    (gen: number, cause: string) => {
      if (gen !== shadowGenRef.current) return;
      shadowGenRef.current += 1;
      stopPendingShadow();
      shadowIframeRef.current = null;
      isRefreshingRef.current = false;
      pendingSeekRef.current = null;
      setPreviewSlots(planShadowDiscard);
      const message = `The preview did not reload (${cause}). The previous preview is still showing.`;
      logReload("shadow-failed", { cause });
      console.error(`[studio] ${message}`);
      onReloadFailedRef.current?.(message);
    },
    [stopPendingShadow, isRefreshingRef, pendingSeekRef],
  );

  const promoteWhenReady = useCallback(
    (gen: number) => {
      const shadow = shadowIframeRef.current;
      const pending = pendingCommitRef.current;
      const ready = pending?.gen === gen && visuallyReadyGenRef.current === gen;
      if (!shadow || !pending || !ready || gen !== shadowGenRef.current) return;
      stopPendingShadow();
      // The store takes the new document's timeline only now that it is the one on screen.
      pending.commit();
      iframeRef.current = shadow;
      shadowIframeRef.current = null;
      attachIframeShortcutListeners();
      applyPreviewAudioState();
      setPreviewSlots((prev) => planShadowPromotion(prev, gen));
      onPromotedRef.current?.();
    },
    [stopPendingShadow, iframeRef, attachIframeShortcutListeners, applyPreviewAudioState],
  );

  const getShadowAdapter = useCallback(() => getAdapter(shadowIframeRef.current), [getAdapter]);
  const isCurrentShadow = useCallback((gen?: number) => gen === shadowGenRef.current, []);
  const markAdapterReady = useCallback(
    (_iframe: HTMLIFrameElement | null, gen: number | undefined, commit: () => void) => {
      if (gen == null || gen !== shadowGenRef.current) return;
      pendingCommitRef.current = { gen, commit };
      promoteWhenReady(gen);
    },
    [promoteWhenReady],
  );
  const onAdapterTimeout = useCallback(
    (gen?: number) => {
      if (gen != null) failShadow(gen, "the new document never became ready");
    },
    [failShadow],
  );

  const { onIframeLoad: onShadowIframeLoad, cancelPendingLoad } = useTimelineSyncCallbacks({
    iframeRef: shadowIframeRef,
    probeIntervalRef: shadowProbeIntervalRef,
    pendingSeekRef,
    isRefreshingRef,
    getAdapter: getShadowAdapter,
    syncTimelineElements,
    setDuration,
    setCurrentTime,
    requestTimelineReady,
    setIsPlaying,
    // A hidden shadow gets neither: shortcuts and audio state apply once it is promoted.
    attachIframeShortcutListeners: () => {},
    applyPreviewAudioState: () => {},
    onAdapterReady: markAdapterReady,
    isCurrent: isCurrentShadow,
    onLoadGiveUp: onAdapterTimeout,
  });
  cancelPendingLoadRef.current = cancelPendingLoad;

  // The Player reports whether loaders (shader transition, assets) are cleared right now.
  const onShadowReadyChange = useCallback(
    (gen: number, ready: boolean) => {
      if (gen !== shadowGenRef.current) return;
      visuallyReadyGenRef.current = ready ? gen : null;
      if (ready) promoteWhenReady(gen);
    },
    [promoteWhenReady],
  );

  const setShadowIframeNode = useCallback((node: HTMLIFrameElement | null) => {
    shadowIframeRef.current = node;
  }, []);

  const beginShadowReload = useCallback(
    (url: string) => {
      shadowGenRef.current += 1;
      const gen = shadowGenRef.current;
      stopPendingShadow();
      readyTimerRef.current = setTimeout(
        () => failShadow(gen, "it took too long to load"),
        SHADOW_READY_TIMEOUT_MS,
      );
      setPreviewSlots((prev) => planShadowReload(prev, gen, url));
    },
    [stopPendingShadow, failShadow],
  );

  // Composition switch (not an edit reload): drop any in-flight shadow.
  const resetPreviewSlots = useCallback(() => {
    shadowGenRef.current += 1;
    stopPendingShadow();
    shadowIframeRef.current = null;
    isRefreshingRef.current = false;
    pendingSeekRef.current = null;
    setPreviewSlots(planShadowDiscard);
  }, [stopPendingShadow, isRefreshingRef, pendingSeekRef]);

  useMountEffect(() => stopPendingShadow);

  return {
    previewSlots,
    onShadowIframeLoad,
    onShadowReadyChange,
    onShadowError: failShadow,
    setShadowIframeNode,
    beginShadowReload,
    resetPreviewSlots,
  };
}
