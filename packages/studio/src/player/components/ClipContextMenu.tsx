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
      className="fixed z-50 min-w-[196px] rounded-xl bg-neutral-950/95 p-1 ring-1 ring-white/10 backdrop-blur-md shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-8px_rgba(0,0,0,0.7)]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {splitLabel && (
        <>
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ease-out ${
              canSplit
                ? "cursor-pointer text-neutral-200 hover:bg-neutral-800/80"
                : "cursor-not-allowed text-neutral-600"
            }`}
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
          <div data-menu-divider="true" className="-mx-1 my-1 h-px bg-white/10" />
        </>
      )}

      {domEditActions && (
        <>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-200 transition-colors duration-150 ease-out hover:bg-neutral-800/80"
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
          <div data-menu-divider="true" className="-mx-1 my-1 h-px bg-white/10" />
        </>
      )}

      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-red-400 transition-colors duration-150 ease-out hover:bg-red-500/10"
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
