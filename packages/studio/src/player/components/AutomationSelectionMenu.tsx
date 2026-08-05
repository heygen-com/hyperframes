/**
 * Context menu for a right-click inside an automation time selection: the four
 * utility shapes, then Simplify. Portal + dismiss handling mirror
 * TrackGapContextMenu; rows never vanish — an inapplicable Simplify dims with
 * a reason instead of leaving a shorter menu.
 */
import { memo } from "react";
import { createPortal } from "react-dom";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { AUTOMATION_SHAPES, type AutomationShapeId } from "./automationShapes";

interface AutomationSelectionMenuProps {
  x: number;
  y: number;
  onClose(): void;
  onInsertShape(shape: AutomationShapeId): void;
  onSimplify(): void;
  /** At least three points in the range — fewer has nothing to thin. */
  canSimplify: boolean;
}

export const AutomationSelectionMenu = memo(function AutomationSelectionMenu({
  x,
  y,
  onClose,
  onInsertShape,
  onSimplify,
  canSimplify,
}: AutomationSelectionMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);
  const row =
    "block w-full px-2 py-1 text-left text-[11px] text-panel-text-1 hover:bg-panel-bg-3 disabled:opacity-40";
  return createPortal(
    <div
      ref={menuRef}
      className="hf-automation-menu fixed z-50 min-w-[140px] rounded border border-panel-border-input bg-panel-bg-2 py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {AUTOMATION_SHAPES.map((shape) => (
        <button
          key={shape.id}
          type="button"
          className={row}
          onClick={() => {
            onInsertShape(shape.id);
            onClose();
          }}
        >
          {shape.label}
        </button>
      ))}
      <div className="my-1 border-t border-panel-border-input" />
      <button
        type="button"
        className={row}
        disabled={!canSimplify}
        title={canSimplify ? undefined : "Fewer than three points in the selection"}
        onClick={() => {
          onSimplify();
          onClose();
        }}
      >
        Simplify
      </button>
    </div>,
    document.body,
  );
});
