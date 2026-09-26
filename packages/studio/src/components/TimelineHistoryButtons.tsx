import { useStudioShellContext } from "../contexts/StudioContext";
import { RotateCcw, RotateCw } from "../icons/SystemIcons";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { historyTooltipLabel } from "../utils/studioHelpers";
import { flatDisabled, flatIdle } from "./timelineToolbarStyles";
import { Tooltip } from "./ui";

interface HistoryButtonProps {
  action: "undo" | "redo";
  enabled: boolean;
  label: string | undefined;
  onClick: () => Promise<void> | void;
}

function HistoryButton({ action, enabled, label, onClick }: HistoryButtonProps) {
  const Icon = action === "undo" ? RotateCcw : RotateCw;
  return (
    <Tooltip label={historyTooltipLabel(action, label)}>
      <button
        type="button"
        aria-label={action === "undo" ? "Undo" : "Redo"}
        disabled={!enabled}
        className={enabled ? flatIdle : flatDisabled}
        onClick={() => {
          trackStudioEvent("toolbar_action", { action });
          void onClick();
        }}
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  );
}

/** Undo and Redo, on the one edit-history path the shell already owns. */
export function TimelineHistoryButtons() {
  const { editHistory, handleUndo, handleRedo } = useStudioShellContext();
  return (
    <>
      <HistoryButton
        action="undo"
        enabled={editHistory.canUndo}
        label={editHistory.undoLabel}
        onClick={handleUndo}
      />
      <HistoryButton
        action="redo"
        enabled={editHistory.canRedo}
        label={editHistory.redoLabel}
        onClick={handleRedo}
      />
    </>
  );
}
