import { readTimelineText } from "../player/lib/timelineText";
import { usePlayerStore } from "../player/store/playerStore";

/** A text commit skips the preview reload, so the edited layer's row re-reads its words here. */
export function refreshTimelineRowText(el: HTMLElement): void {
  const { elements, updateElement } = usePlayerStore.getState();
  const row = elements.find(
    (candidate) =>
      candidate.selector &&
      el.ownerDocument.querySelectorAll(candidate.selector)[candidate.selectorIndex ?? 0] === el,
  );
  if (row) updateElement(row.id, { text: readTimelineText(el) });
}
