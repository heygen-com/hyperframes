import type { DomEditSelection } from "../components/editor/domEditing";

type SelectionSetListener = (
  selection: DomEditSelection | null,
  group: readonly DomEditSelection[],
) => void;

const listeners = new Set<SelectionSetListener>();

/** Every place useDomSelection sets a selection calls this, before React renders it: an opaque frame's overlay can
 * ask for its rects at once. */
export function domSelectionSet(
  selection: DomEditSelection | null,
  group: readonly DomEditSelection[],
): void {
  for (const listener of listeners) listener(selection, group);
}

export function onDomSelectionSet(listener: SelectionSetListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
