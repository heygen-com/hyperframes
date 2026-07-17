import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { trackStudioSegmentEaseEdit } from "../../telemetry/events";
import type { TimelineElement, KeyframeCacheEntry } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";
import {
  timelineKeyframeSelectionKey,
  type TimelineKeyframeTarget,
} from "./timelineKeyframeIdentity";

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
    (el: TimelineElement, target: TimelineKeyframeTarget, options?: { seek?: boolean }) => {
      usePlayerStore.getState().clearSelectedKeyframes();
      const elKey = el.key ?? el.id;
      setSelectedElementId(elKey);
      onSelectElement?.(el);
      toggleSelectedKeyframe(timelineKeyframeSelectionKey(elKey, target));
      // Clicking a diamond seeks the playhead to it; selecting a segment to edit
      // its ease (options.seek === false) must NOT move the playhead.
      if (options?.seek !== false) {
        onSeek?.(el.start + (target.percentage / 100) * el.duration);
      }
      const kfData = keyframeCache.get(elKey);
      const kf = kfData?.keyframes.find(
        (item) => Math.abs(item.percentage - target.percentage) < 0.5,
      );
      usePlayerStore
        .getState()
        .setActiveKeyframePct(target.tweenPercentage ?? kf?.tweenPercentage ?? null);
    },
    [keyframeCache, onSeek, onSelectElement, setSelectedElementId, toggleSelectedKeyframe],
  );

  const onShiftClickKeyframe = useCallback(
    (elId: string, target: TimelineKeyframeTarget) => {
      toggleSelectedKeyframe(timelineKeyframeSelectionKey(elId, target));
    },
    [toggleSelectedKeyframe],
  );

  const onSelectSegment = useCallback(
    (elId: string, target: TimelineKeyframeTarget) => {
      const el = expandedElements.find((item) => (item.key ?? item.id) === elId);
      if (!el) return;
      onClickKeyframe(el, target, { seek: false });
      if (target.animationId !== undefined && target.tweenPercentage !== undefined) {
        usePlayerStore.getState().setFocusedEaseSegment({
          animationId: target.animationId,
          collidingAnimationIds: target.collidingAnimationIds,
          tweenPercentage: target.tweenPercentage,
          elementId: elId,
        });
        trackStudioSegmentEaseEdit({ action: "open" });
      }
    },
    [expandedElements, onClickKeyframe],
  );

  const onContextMenuKeyframe = useCallback(
    (e: ReactMouseEvent, elId: string, target: TimelineKeyframeTarget) => {
      const el = expandedElements.find((item) => (item.key ?? item.id) === elId);
      if (el) {
        setSelectedElementId(elId);
        onSelectElement?.(el);
      }
      const kfData = keyframeCache.get(elId);
      const kf = kfData?.keyframes.find(
        (item) => Math.abs(item.percentage - target.percentage) < 0.2,
      );
      setKfContextMenu({
        x: e.clientX + 4,
        y: e.clientY + 2,
        elementId: elId,
        percentage: target.percentage,
        tweenPercentage: target.tweenPercentage ?? kf?.tweenPercentage,
        propertyGroup: target.propertyGroup,
        animationId: target.animationId,
        currentEase: kf?.ease ?? kfData?.ease,
      });
    },
    [expandedElements, keyframeCache, onSelectElement, setKfContextMenu, setSelectedElementId],
  );

  return {
    onClickKeyframe,
    onSelectSegment,
    onShiftClickKeyframe,
    onContextMenuKeyframe,
  };
}
