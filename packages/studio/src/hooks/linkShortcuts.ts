import { usePlayerStore } from "../player";
import type { TimelineEditCallbacks } from "../player/components/timelineCallbacks";
import { resolveLinkMenuItems } from "../player/components/clipMenuLinkItems";
import { isTypingTarget } from "../utils/typingTarget";

export interface LinkShortcutCallbacks {
  handleLinkEdit?: TimelineEditCallbacks["onLinkEdit"];
  handleTimelineElementDeleteOnly?: TimelineEditCallbacks["onDeleteElementOnly"];
}

const isDeleteKey = (event: KeyboardEvent) => event.key === "Backspace" || event.key === "Delete";
const hasMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;

const SHORTCUTS: ReadonlyArray<[string, (event: KeyboardEvent) => boolean]> = [
  ["⌘L", (e) => hasMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "l"],
  ["⌥⇧D", (e) => !hasMod(e) && e.altKey && e.shiftKey && e.code === "KeyD"],
  ["⌥⌫", (e) => !hasMod(e) && e.altKey && !e.shiftKey && isDeleteKey(e)],
];

function shortcutOf(event: KeyboardEvent): string | null {
  return SHORTCUTS.find(([, matches]) => matches(event))?.[0] ?? null;
}

/** ⌘L unlink/link, ⌥⇧D detach audio, ⌥⌫ delete one linked clip — the clip menu's shortcuts. */
export function dispatchLinkShortcut(event: KeyboardEvent, cb: LinkShortcutCallbacks): boolean {
  const shortcut = isTypingTarget(event.target) ? null : shortcutOf(event);
  if (!shortcut) return false;
  const { elements, selectedElementId, selectedElementIds } = usePlayerStore.getState();
  const element = elements.find((el) => (el.key ?? el.id) === selectedElementId);
  if (!element) return false;
  const item = resolveLinkMenuItems({
    element,
    elements,
    selectedKeys: selectedElementIds,
    onLinkEdit: cb.handleLinkEdit,
    onDeleteElementOnly: cb.handleTimelineElementDeleteOnly,
  }).find((candidate) => candidate.shortcut === shortcut);
  if (!item) return false;
  event.preventDefault();
  item.run();
  return true;
}
