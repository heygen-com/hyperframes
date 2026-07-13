/**
 * Right-click context menu for a selected canvas element.
 *
 * Mirrors the look, positioning, and dismiss behavior of
 * player/components/ClipContextMenu.tsx — portaled to document.body,
 * overflow-adjusted, dismissed on outside-click or Escape via
 * useContextMenuDismiss.
 *
 * ── Wiring (z-order persistence) ─────────────────────────────────────────────
 * Z-index changes are applied optimistically to the live iframe element(s) via
 * `resolveZOrderChange`, which returns a MULTI-element patch list (tie-aware:
 * moving a target past an equal-z sibling can require renumbering the affected
 * set). The patches are surfaced through the `onApplyZIndex` prop.
 *
 * The prop MUST be wired at the call site to route through the full persist
 * path. PreviewOverlays.tsx builds the per-patch PatchTargets (the selected
 * element carries its full selection identity; sibling elements are iframe DOM
 * nodes, so their id / selector are derived from the node and they share the
 * selection's sourceFile) and forwards them to handleDomZIndexReorderCommit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { memo } from "react";
import { createPortal } from "react-dom";
import type { DomEditSelection } from "./domEditing";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import {
  isZOrderActionEnabled,
  resolveZOrderChange,
  type ZOrderPatch,
} from "./canvasContextMenuZOrder";

interface CanvasContextMenuProps {
  /** Viewport x of the right-click event. */
  x: number;
  /** Viewport y of the right-click event. */
  y: number;
  selection: DomEditSelection;
  onClose: () => void;
  /**
   * Called with the resolved z-order patch list after an optimistic DOM update.
   * Each patch is an { element, zIndex } pair (the target and, when a renumber
   * is needed, affected siblings). Wire to handleDomZIndexReorderCommit (see
   * module-level wiring comment).
   */
  onApplyZIndex?: (patches: ZOrderPatch[]) => void;
  /**
   * Delete the selected element. Wire to handleDomEditElementDelete from
   * useDomEditActionsContext — same path as the Delete/Backspace hotkey.
   * Absent when the caller wires no delete persist path (e.g. a legacy mount):
   * the Delete item is then hidden rather than shown as a silent no-op.
   */
  onDelete?: (selection: DomEditSelection) => void;
}

type ZAction = "bring-forward" | "send-backward" | "bring-to-front" | "send-to-back";

const Z_ACTIONS: Array<{ action: ZAction; label: string }> = [
  { action: "bring-forward", label: "Bring forward" },
  { action: "send-backward", label: "Send backward" },
  { action: "bring-to-front", label: "Bring to front" },
  { action: "send-to-back", label: "Send to back" },
];

export const CanvasContextMenu = memo(function CanvasContextMenu({
  x,
  y,
  selection,
  onClose,
  onApplyZIndex,
  onDelete,
}: CanvasContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);

  // Gate each item group on the presence of its persist handler. Without the
  // handler the action can't be persisted, so showing it would be a dead-end:
  // a z-write reverts on reload and Delete silently no-ops. Hide the group
  // instead. If nothing is actionable (a legacy mount with no handlers at all),
  // don't render the menu — an empty menu is itself a dead-end.
  const hasZActions = Boolean(onApplyZIndex);
  const hasDelete = Boolean(onDelete);
  const hasDivider = hasZActions && hasDelete;

  // Overflow correction — match ClipContextMenu approach. Only the rendered
  // groups contribute height (keeps positioning correct when a group is hidden).
  const menuWidth = 200;
  const menuHeight =
    8 + (hasZActions ? Z_ACTIONS.length * 28 : 0) + (hasDivider ? 1 : 0) + (hasDelete ? 28 : 0) + 8; // padding + items + divider + delete + padding
  const overflowY = y + menuHeight - window.innerHeight;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = overflowY > 0 ? y - overflowY - 8 : y;

  const el = selection.element;

  function handleZAction(action: ZAction) {
    // No persist handler → do NOT touch the live iframe DOM. An optimistic
    // write with nothing to persist just reverts on the next reload.
    if (!onApplyZIndex) return;
    const patches = resolveZOrderChange(el, action);
    if (patches === null) return;
    // Optimistic update — visible immediately even before persist completes.
    for (const patch of patches) {
      patch.element.style.zIndex = String(patch.zIndex);
      const view = patch.element.ownerDocument?.defaultView;
      if (view && view.getComputedStyle(patch.element).position === "static") {
        patch.element.style.position = "relative";
      }
    }
    onApplyZIndex(patches);
    onClose();
  }

  function handleDelete() {
    if (!onDelete) return;
    onDelete(selection);
    onClose();
  }

  if (!hasZActions && !hasDelete) return null;

  // The menu is portaled to document.body, but in the React tree it is still a
  // child of the DomEditOverlay <div>. React synthetic events bubble through the
  // REACT tree (not the DOM tree), so a click on any menu control would otherwise
  // bubble into the overlay's onPointerDown / onMouseDown handlers — which
  // preventDefault() to start a marquee and re-resolve the selection. That
  // preventDefault cancels the button's own click and the item action never runs.
  //
  // Stop pointer/mouse propagation at the menu root so overlay gesture handlers
  // never see these events, and drive the item actions on pointerDown (which
  // fires before any outside-click / dismiss logic can unmount the menu).
  const stopBubble = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
      onPointerDown={stopBubble}
      onMouseDown={stopBubble}
      onClick={stopBubble}
      onContextMenu={(e) => {
        // Keep a right-click on the menu itself from re-opening / bubbling.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {hasZActions &&
        Z_ACTIONS.map(({ action, label }) => {
          const enabled = isZOrderActionEnabled(el, action);
          return (
            <button
              key={action}
              type="button"
              className={`w-full flex items-center px-3 py-1.5 text-xs text-left ${
                enabled
                  ? "text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                  : "text-neutral-600 cursor-not-allowed"
              }`}
              disabled={!enabled}
              // Act on pointerDown, not click: a pointerDown that reaches the
              // overlay/document would otherwise re-select or dismiss the menu
              // before the trailing click fires. Running here guarantees the
              // action lands. Guard `button === 0` so a right-press is ignored.
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                if (enabled) handleZAction(action);
              }}
            >
              {label}
            </button>
          );
        })}

      {hasDivider && <div className="my-1 border-t border-neutral-700/60" />}

      {hasDelete && (
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            handleDelete();
          }}
        >
          <span>Delete</span>
          <span className="text-neutral-500 text-[10px] ml-3">⌫</span>
        </button>
      )}
    </div>,
    document.body,
  );
});
