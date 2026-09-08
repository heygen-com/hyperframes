/**
 * Context menu for a right-click inside an automation time selection: the four
 * utility shapes, then Simplify. Rows never vanish — an inapplicable Simplify
 * dims with a reason instead of leaving a shorter menu.
 *
 * Opened at a stored point rather than from a trigger: the lane is canvas, so
 * the selection the user right-clicked has no element of its own.
 */
import { memo } from "react";
import { ContextMenu, MenuItem, MenuSeparator } from "../../components/ui";
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
  return (
    <ContextMenu
      anchor={{ x, y }}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      aria-label="Automation selection actions"
      className="hf-automation-menu"
    >
      {AUTOMATION_SHAPES.map((shape) => (
        <MenuItem key={shape.id} onClick={() => onInsertShape(shape.id)}>
          {shape.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        disabled={!canSimplify}
        title={canSimplify ? undefined : "Fewer than three points in the selection"}
        onClick={onSimplify}
      >
        Simplify
      </MenuItem>
    </ContextMenu>
  );
});
