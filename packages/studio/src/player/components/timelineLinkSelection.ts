import { usePlayerStore } from "../store/playerStore";
import { expandToLinkedMembers } from "./audioClipLink";
import { isLinkedSelectionOn } from "../../utils/linkedClipPreferences";

/**
 * Select `key` the way a clip click does, then widen to link partners; Alt
 * (or Linked Selection off) selects `key` alone, even inside a larger selection.
 */
export function selectClipWithLinks(
  key: string,
  altKey: boolean,
  setSelectedElementId: (id: string) => void,
): void {
  const state = usePlayerStore.getState();
  if (altKey || !isLinkedSelectionOn()) {
    state.setSelection([key], key);
    return;
  }
  setSelectedElementId(key);
  const { selectedElementIds, elements } = usePlayerStore.getState();
  const expanded = expandToLinkedMembers(selectedElementIds, elements);
  if (expanded.size > selectedElementIds.size) state.setSelection(expanded, key);
}
