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
import { thumbnailScheduler } from "../lib/thumbnailScheduler";
import { usePlayerStore } from "../store/playerStore";

// One wait budget for a shadow: the player's 8s asset cap plus its 0.42s loader fade
// leaves about 6.5s for the document load and runtime boot. Nothing shorter may fail the swap.
// It only runs while the tab is visible: readiness is frame-driven, and a hidden tab renders none.
export const SHADOW_READY_TIMEOUT_MS = 15_000;
// A busy machine can need more than one budget; the shadow keeps loading for this many before it is dropped.
export const SHADOW_READY_BUDGETS = 3;

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

type UseShadowPreviewReloadParams = Omit<
  UseTimelineSyncCallbacksParams,
  "probeIntervalRef" | "onAdapterReady" | "getAdapter" | "isCurrent" | "onLoadGiveUp"
> & {
  getAdapter: (overrideIframe?: HTMLIFrameElement | null) => PlaybackAdapter | null;
  /** Runs right after a shadow becomes the live iframe (iframeRef already points at it). */
  onPromoted?: () => void;
  /** A shadow that never became ready was dropped; the live preview is unchanged. */
  onReloadFailed?: (message: string) => void;
  /** Puts the promoted document at the live frame's time, playing if the live frame was. */
  handOverPlayback: (time: number, playing: boolean) => void;
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
  handOverPlayback,
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
  const handOverPlaybackRef = useRef(handOverPlayback);
  handOverPlaybackRef.current = handOverPlayback;
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const budgetsSpentRef = useRef(0);
  // The shadow still owed a wait budget, so a hidden tab can resume it when it becomes visible.
  const budgetGenRef = useRef<number | null>(null);
  const cancelPendingLoadRef = useRef<() => void>(() => {});
  const [previewSlots, setPreviewSlots] = useState<PreviewIframeSlot[]>([{ gen: 0, role: "live" }]);

  const stopPendingShadow = useCallback(() => {
    clearTimeout(readyTimerRef.current);
    budgetGenRef.current = null;
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
      thumbnailScheduler.setPreviewReloading(false);
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
      // The live frame kept playing, stopped at the end or was seeked while the shadow loaded.
      const live = getAdapter();
      const liveTime = live?.getTime();
      const playing = usePlayerStore.getState().isPlaying;
      live?.pause();
      // The store takes the new document's timeline only now that it is the one on screen.
      pending.commit();
      iframeRef.current = shadow;
      shadowIframeRef.current = null;
      attachIframeShortcutListeners();
      applyPreviewAudioState();
      setPreviewSlots((prev) => planShadowPromotion(prev, gen));
      if (liveTime != null) handOverPlaybackRef.current(liveTime, playing);
      onPromotedRef.current?.();
      thumbnailScheduler.setPreviewReloading(false);
    },
    [
      stopPendingShadow,
      getAdapter,
      iframeRef,
      attachIframeShortcutListeners,
      applyPreviewAudioState,
    ],
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

  const armReadyTimer = useCallback(
    (gen: number) => {
      clearTimeout(readyTimerRef.current);
      if (isDocumentHidden()) return;
      readyTimerRef.current = setTimeout(() => {
        if (gen !== shadowGenRef.current) return;
        budgetsSpentRef.current += 1;
        if (budgetsSpentRef.current < SHADOW_READY_BUDGETS) {
          logReload("shadow-slow", { budgetsSpent: budgetsSpentRef.current });
          armReadyTimerRef.current(gen);
          return;
        }
        failShadow(gen, "it took too long to load");
      }, SHADOW_READY_TIMEOUT_MS);
    },
    [failShadow],
  );
  const armReadyTimerRef = useRef(armReadyTimer);
  armReadyTimerRef.current = armReadyTimer;

  const beginShadowReload = useCallback(
    (url: string) => {
      shadowGenRef.current += 1;
      const gen = shadowGenRef.current;
      stopPendingShadow();
      budgetGenRef.current = gen;
      budgetsSpentRef.current = 0;
      armReadyTimer(gen);
      setPreviewSlots((prev) => planShadowReload(prev, gen, url));
      // Thumbnails of the edit wait for the new preview instead of competing with it.
      thumbnailScheduler.setPreviewReloading(true);
    },
    [stopPendingShadow, armReadyTimer],
  );

  // Composition switch (not an edit reload): drop any in-flight shadow.
  const resetPreviewSlots = useCallback(() => {
    shadowGenRef.current += 1;
    stopPendingShadow();
    shadowIframeRef.current = null;
    isRefreshingRef.current = false;
    pendingSeekRef.current = null;
    // The new composition's preview isn't playable yet; its load step marks it ready again.
    usePlayerStore.getState().setTimelineReady(false);
    setPreviewSlots(planShadowDiscard);
    thumbnailScheduler.setPreviewReloading(false);
  }, [stopPendingShadow, isRefreshingRef, pendingSeekRef]);

  // Hiding the tab pauses the budget; showing it again restarts the full budget for a pending shadow.
  useMountEffect(() => {
    const onVisibilityChange = () => {
      if (isDocumentHidden()) {
        clearTimeout(readyTimerRef.current);
        return;
      }
      const gen = budgetGenRef.current;
      if (gen != null && gen === shadowGenRef.current) armReadyTimerRef.current(gen);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPendingShadow();
      thumbnailScheduler.setPreviewReloading(false);
    };
  });

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
