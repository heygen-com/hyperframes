import {
  getTimelineElementIdentity,
  getTimelineElementSelector,
  getTimelineElementSelectorIndex,
  getTimelineElementSourceFile,
} from "../player/lib/timelineElementHelpers";
import { readTimelineText } from "../player/lib/timelineText";
import { usePlayerStore } from "../player/store/playerStore";

/** A text commit skips the preview reload, so the edited layer's row re-reads its words here. */
export function refreshTimelineRowText(el: HTMLElement): void {
  const selector = getTimelineElementSelector(el);
  if (!selector) return;
  const selectorIndex = getTimelineElementSelectorIndex(el.ownerDocument, el, selector) ?? 0;
  const sourceFile = getTimelineElementSourceFile(el);
  const { elements, updateElement } = usePlayerStore.getState();
  const row = elements.find(
    (candidate) =>
      candidate.selector === selector &&
      (candidate.selectorIndex ?? 0) === selectorIndex &&
      candidate.sourceFile === sourceFile,
  );
  if (row) updateElement(getTimelineElementIdentity(row), { text: readTimelineText(el) });
}
