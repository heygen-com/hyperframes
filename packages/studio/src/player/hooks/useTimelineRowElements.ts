import { useMemo } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";

/** Rows are the ids `topLevelElements` names, as the lint does; implicit layers and id-less ones are kept. */
export function selectTimelineRowElements(
  elements: TimelineElement[],
  topLevelIds: ReadonlySet<string> | null,
): TimelineElement[] {
  if (!topLevelIds) return elements;
  return elements.filter(
    (el) => el.domId === undefined || el.timingSource === "implicit" || topLevelIds.has(el.domId),
  );
}

export function useTimelineRowElements(): TimelineElement[] {
  const elements = usePlayerStore((s) => s.elements);
  const topLevelIds = usePlayerStore((s) => s.topLevelIds);
  return useMemo(() => selectTimelineRowElements(elements, topLevelIds), [elements, topLevelIds]);
}
