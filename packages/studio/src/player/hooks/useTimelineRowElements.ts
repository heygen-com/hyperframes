import { useMemo } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";

/**
 * The timeline's rows: the elements `topLevelElements` (parsers) names as top-level,
 * the same definition the structure lint uses. An element with no DOM id, or a
 * document not yet read, is kept rather than guessed away.
 */
export function selectTimelineRowElements(
  elements: TimelineElement[],
  topLevelIds: ReadonlySet<string> | null,
): TimelineElement[] {
  if (!topLevelIds) return elements;
  return elements.filter((el) => el.domId === undefined || topLevelIds.has(el.domId));
}

export function useTimelineRowElements(): TimelineElement[] {
  const elements = usePlayerStore((s) => s.elements);
  const topLevelIds = usePlayerStore((s) => s.topLevelIds);
  return useMemo(() => selectTimelineRowElements(elements, topLevelIds), [elements, topLevelIds]);
}
