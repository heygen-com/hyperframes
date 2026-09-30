import { usePlayerStore } from "../store/playerStore";
import { expandToLinkedMembers } from "./audioClipLink";

/**
 * Select `key` the way a clip click does, then widen to link partners; Alt
 * selects `key` alone even when it sat inside a larger selection.
 */
export function selectClipWithLinks(
  key: string,
  altKey: boolean,
  setSelectedElementId: (id: string) => void,
): void {
  const state = usePlayerStore.getState();
  if (altKey) {
    state.setSelection([key], key);
    return;
  }
  setSelectedElementId(key);
  const { selectedElementIds, elements } = usePlayerStore.getState();
  const expanded = expandToLinkedMembers(selectedElementIds, elements);
  if (expanded.size > selectedElementIds.size) state.setSelection(expanded, key);
}
