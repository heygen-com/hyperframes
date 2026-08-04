import { memo } from "react";
import { createPortal } from "react-dom";
import type { TimelineElement } from "../store/playerStore";
import { canSplitElement } from "../../utils/timelineElementSplit";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import { AgentGlyph } from "../../components/editor/agentGlyphs";
import {
  FLOATING_SURFACE,
  MENU_DIVIDER,
  MENU_ROW,
  MENU_ROW_DANGER,
  MENU_ROW_DISABLED,
  MENU_ROW_ENABLED,
} from "../../components/ui/floatingSurface";

interface ClipContextMenuProps {
  x: number;
  y: number;
  element: TimelineElement;
  currentTime: number;
  onClose: () => void;
  onSplit: (element: TimelineElement, splitTime: number) => void;
  onDelete: (element: TimelineElement) => void;
}

export const ClipContextMenu = memo(function ClipContextMenu({
  x,
  y,
  element,
  currentTime,
  onClose,
  onSplit,
  onDelete,
}: ClipContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);
  // Null in standalone player mounts (no studio provider) — the agent entry
  // only exists where there is a project on disk to edit.
  const domEditActions = useDomEditActionsContextOptional();
  const agentState = useDomEditSelectionContextOptional();

  const menuWidth = 200;
  const menuHeight = domEditActions ? 110 : 80;
  const overflowY = y + menuHeight - window.innerHeight;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = overflowY > 0 ? y - overflowY - 8 : y;

  const isSplittable = canSplitElement(element) && ["video", "audio", "img"].includes(element.tag);
  const canSplit =
    isSplittable && currentTime > element.start && currentTime < element.start + element.duration;

  const splitLabel = !isSplittable
    ? null
    : canSplit
      ? `Split at ${currentTime.toFixed(2)}s`
      : "Split (move playhead inside clip)";

  return createPortal(
    <div
      ref={menuRef}
      className={`fixed z-50 min-w-[196px] rounded-xl p-1 ${FLOATING_SURFACE}`}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {splitLabel && (
        <>
          <button
            type="button"
            className={`${MENU_ROW} justify-between ${canSplit ? MENU_ROW_ENABLED : MENU_ROW_DISABLED}`}
            disabled={!canSplit}
            onClick={() => {
              if (canSplit) {
                onSplit(element, currentTime);
                onClose();
              }
            }}
          >
            <span>{splitLabel}</span>
            <span className="text-neutral-500 text-[10px] ml-3">S</span>
          </button>
          <div data-menu-divider="true" className={MENU_DIVIDER} />
        </>
      )}

      {domEditActions && (
        <>
          <button
            type="button"
            className={`${MENU_ROW} ${MENU_ROW_ENABLED}`}
            onClick={() => {
              // Resolve the clip back to its live DOM element so the agent gets
              // the same rich context a canvas selection produces.
              void domEditActions.buildDomSelectionForTimelineElement(element).then((selection) => {
                if (!selection) return;
                domEditActions.applyDomSelection(selection);
                domEditActions.handleAskAgent();
              });
              onClose();
            }}
          >
            <AgentGlyph
              kind={agentState?.agentRunKind ?? "custom"}
              size={14}
              iconUrl={agentState?.agentIconUrl}
            />
            <span className="flex-1">Ask {agentState?.agentRunLabel ?? "agent"}</span>
            <span className="text-[10px] text-neutral-600">⌘K</span>
          </button>
          <div data-menu-divider="true" className={MENU_DIVIDER} />
        </>
      )}

      <button
        type="button"
        className={`${MENU_ROW} justify-between ${MENU_ROW_DANGER}`}
        onClick={() => {
          onDelete(element);
          onClose();
        }}
      >
        <span>Delete</span>
        <span className="text-neutral-500 text-[10px] ml-3">⌫</span>
      </button>
    </div>,
    document.body,
  );
});
