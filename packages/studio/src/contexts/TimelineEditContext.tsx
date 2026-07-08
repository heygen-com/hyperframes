import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TimelineEditCallbacks } from "../player/components/timelineCallbacks";

const TimelineEditContext = createContext<TimelineEditCallbacks | null>(null);

export function useTimelineEditContext(): TimelineEditCallbacks {
  const ctx = useContext(TimelineEditContext);
  if (!ctx) throw new Error("useTimelineEditContext must be used within TimelineEditProvider");
  return ctx;
}

/**
 * Optional access — returns an empty object when outside a provider.
 * Useful in components that can render both inside and outside the NLE.
 */
export function useTimelineEditContextOptional(): TimelineEditCallbacks {
  return useContext(TimelineEditContext) ?? {};
}

export function TimelineEditProvider({
  value,
  children,
}: {
  value: TimelineEditCallbacks;
  children: ReactNode;
}) {
  const memoized = useMemo(
    () => value,
    // Each callback is a stable reference from the parent — memoize the bag
    // so consumers don't re-render when unrelated parent state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      value.onMoveElement,
      value.onResizeElement,
      value.onToggleTrackHidden,
      value.onBlockedEditAttempt,
      value.onSplitElement,
      value.onRazorSplit,
      value.onRazorSplitAll,
      value.onDeleteKeyframe,
      value.onDeleteAllKeyframes,
      value.onChangeKeyframeEase,
      value.onMoveKeyframeToPlayhead,
      value.onMoveKeyframe,
      value.onToggleKeyframeAtPlayhead,
    ],
  );
  return <TimelineEditContext.Provider value={memoized}>{children}</TimelineEditContext.Provider>;
}
