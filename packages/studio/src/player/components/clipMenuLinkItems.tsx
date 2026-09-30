import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import type { TimelineLinkEdit } from "./timelineCallbacks";
import { linkedMembersOf } from "./audioClipLink";
import { canDetachAudio, canLinkPair, findMergePair } from "../../components/editor/mediaLinkEdits";

interface LinkMenuItem {
  label: string;
  shortcut?: string;
  destructive?: boolean;
  run: () => void;
}

const keyOf = (el: TimelineElement) => el.key ?? el.id;

/** The link-model items for a clip, in wireframe order (detach · unlink/link · merge · delete-one). */
export function resolveLinkMenuItems(input: {
  element: TimelineElement;
  elements: readonly TimelineElement[];
  selectedKeys: ReadonlySet<string>;
  onLinkEdit?: (edit: TimelineLinkEdit) => unknown;
  onDeleteElementOnly?: (element: TimelineElement) => unknown;
}): LinkMenuItem[] {
  const { element, elements, selectedKeys, onLinkEdit, onDeleteElementOnly } = input;
  const items: LinkMenuItem[] = [];
  if (!onLinkEdit) return items;
  const members = linkedMembersOf(element, elements);
  const linked = members.length > 1;
  if (canDetachAudio(element)) {
    items.push({
      label: "Detach audio",
      shortcut: "⌥⇧D",
      run: () => onLinkEdit({ kind: "detach", element }),
    });
  }
  const selected = elements.filter((el) => selectedKeys.has(keyOf(el)));
  if (linked) {
    items.push({
      label: "Unlink",
      shortcut: "⌘L",
      run: () => onLinkEdit({ kind: "unlink", elements: members }),
    });
  } else if (canLinkPair(selected) && selectedKeys.has(keyOf(element))) {
    items.push({
      label: "Link",
      shortcut: "⌘L",
      run: () => onLinkEdit({ kind: "link", elements: selected }),
    });
  }
  const pair = findMergePair(element, elements);
  if (pair) {
    items.push({
      label: "Merge audio back into video",
      run: () => onLinkEdit({ kind: "merge", ...pair }),
    });
  }
  if (linked && onDeleteElementOnly) {
    items.push({
      label: "Delete this clip only",
      shortcut: "⌥⌫",
      destructive: true,
      run: () => onDeleteElementOnly(element),
    });
  }
  return items;
}

export function ClipMenuLinkItems({
  element,
  onClose,
}: {
  element: TimelineElement;
  onClose: () => void;
}) {
  const { onLinkEdit, onDeleteElementOnly } = useTimelineEditContextOptional();
  const elements = usePlayerStore((s) => s.elements);
  const selectedKeys = usePlayerStore((s) => s.selectedElementIds);
  const items = resolveLinkMenuItems({
    element,
    elements,
    selectedKeys,
    onLinkEdit,
    onDeleteElementOnly,
  });
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left outline-hidden cursor-pointer hover:bg-neutral-800 focus-visible:bg-neutral-800 ${
            item.destructive ? "text-red-400" : "text-neutral-300"
          }`}
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span className="text-neutral-500 text-[10px] ml-3">{item.shortcut}</span>
          )}
        </button>
      ))}
      <div className="my-1 border-t border-neutral-700/60" />
    </>
  );
}
