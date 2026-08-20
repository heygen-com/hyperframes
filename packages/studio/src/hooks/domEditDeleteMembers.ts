/**
 * Which elements a delete acts on.
 *
 * Its own module so `useDomEditSession.ts` stays under the studio's 600-line
 * cap; it reads only its arguments.
 */

import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { EditHistoryKind } from "../utils/editHistory";

/** One entry in the studio's edit history, as `useDomEditSession`'s caller
 *  supplies it. */
export interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

/**
 * Which elements a delete acts on. `expandGroup` widens the primary to the
 * whole marquee group, which is what the Delete key means.
 *
 * The caller chooses rather than the delete deciding for everyone: Cut copies
 * the primary alone, so expanding for it put one element on the clipboard and
 * removed every other member of the group with it.
 */
export function membersForDelete(
  selection: DomEditSelection,
  group: DomEditSelection[],
  options?: { expandGroup?: boolean },
): DomEditSelection[] {
  return options?.expandGroup && group.length > 0 ? group : [selection];
}
