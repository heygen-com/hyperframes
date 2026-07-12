import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import type { TimelineElement, KeyframeCacheEntry } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";

interface UseTimelineKeyframeHandlersInput {
  expandedElements: TimelineElement[];
  keyframeCache: Map<string, KeyframeCacheEntry>;
  onSelectElement?: (element: TimelineElement | null) => void;
  onSeek?: (time: number) => void;
  setSelectedElementId: (id: string | null) => void;
  setKfContextMenu: (state: KeyframeDiamondContextMenuState | null) => void;
  toggleSelectedKeyframe: (key: string) => void;
}

export function useTimelineKeyframeHandlers({
  expandedElements,
  keyframeCache,
  onSelectElement,
  onSeek,
  setSelectedElementId,
  setKfContextMenu,
  toggleSelectedKeyframe,
}: UseTimelineKeyframeHandlersInput) {
  const onClickKeyframe = useCallback(
    (el: TimelineElement, pct: number) => {
      usePlayerStore.getState().clearSelectedKeyframes();
      const elKey = el.key ?? el.id;
      setSelectedElementId(elKey);
      onSelectElement?.(el);
      toggleSelectedKeyframe(`${elKey}:${pct}`);
      onSeek?.(el.start + (pct / 100) * el.duration);
      const kfData = keyframeCache.get(elKey);
      const kf = kfData?.keyframes.find((item) => Math.abs(item.percentage - pct) < 0.5);
      usePlayerStore.getState().setActiveKeyframePct(kf?.tweenPercentage ?? null);
    },
    [keyframeCache, onSeek, onSelectElement, setSelectedElementId, toggleSelectedKeyframe],
  );

  const onShiftClickKeyframe = useCallback(
    (elId: string, pct: number) => {
      toggleSelectedKeyframe(`${elId}:${pct}`);
    },
    [toggleSelectedKeyframe],
  );

  const onContextMenuKeyframe = useCallback(
    (e: ReactMouseEvent, elId: string, pct: number) => {
      const el = expandedElements.find((item) => (item.key ?? item.id) === elId);
      if (el) {
        setSelectedElementId(elId);
        onSelectElement?.(el);
      }
      const kfData = keyframeCache.get(elId);
      const kf = kfData?.keyframes.find((item) => Math.abs(item.percentage - pct) < 0.2);
      setKfContextMenu({
        x: e.clientX + 4,
        y: e.clientY + 2,
        elementId: elId,
        percentage: pct,
        tweenPercentage: kf?.tweenPercentage,
        currentEase: kf?.ease ?? kfData?.ease,
      });
    },
    [expandedElements, keyframeCache, onSelectElement, setKfContextMenu, setSelectedElementId],
  );

  return {
    onClickKeyframe,
    onShiftClickKeyframe,
    onContextMenuKeyframe,
  };
}
