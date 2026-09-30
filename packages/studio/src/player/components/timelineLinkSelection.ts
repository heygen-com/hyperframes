import { usePlayerStore } from "../store/playerStore";
import { expandToLinkedMembers } from "./audioClipLink";

/** After selecting `key`, widen the selection to its link partners (primary stays `key`). */
export function selectLinkPartners(key: string): void {
  const state = usePlayerStore.getState();
  const expanded = expandToLinkedMembers([key], state.elements);
  if (expanded.size <= 1) return;
  state.setSelection(expanded, key);
}
