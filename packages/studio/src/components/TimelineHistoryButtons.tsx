import { useStudioShellContextOptional } from "../contexts/StudioContext";
import { RotateCcw, RotateCw } from "../icons/SystemIcons";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { historyTooltipLabel } from "../utils/studioHelpers";
import { flatDisabled, flatIdle } from "./timelineToolbarStyles";
import { Tooltip } from "./ui";

interface HistoryButtonProps {
  action: "undo" | "redo";
  can: boolean;
  label: string | undefined;
  onClick: (() => Promise<void> | void) | undefined;
}

function HistoryButton({ action, can, label, onClick }: HistoryButtonProps) {
  const Icon = action === "undo" ? RotateCcw : RotateCw;
  const enabled = Boolean(onClick) && can;
  return (
    <Tooltip label={historyTooltipLabel(action, label)}>
      <button
        type="button"
        aria-label={action === "undo" ? "Undo" : "Redo"}
        disabled={!enabled}
        className={enabled ? flatIdle : flatDisabled}
        onClick={() => {
          trackStudioEvent("toolbar_action", { action });
          void onClick?.();
        }}
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  );
}

export interface TimelineHistoryButtonsProps {
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string;
  redoLabel?: string;
  onUndo?: () => Promise<void> | void;
  onRedo?: () => Promise<void> | void;
}

/** Undo and Redo: a host's props win, else the shell's edit history. */
export function TimelineHistoryButtons(props: TimelineHistoryButtonsProps) {
  const shell = useStudioShellContextOptional();
  const onUndo = props.onUndo ?? shell?.handleUndo;
  const onRedo = props.onRedo ?? shell?.handleRedo;
  return (
    <>
      <HistoryButton
        action="undo"
        can={props.canUndo ?? shell?.editHistory.canUndo ?? false}
        label={props.undoLabel ?? shell?.editHistory.undoLabel}
        onClick={onUndo}
      />
      <HistoryButton
        action="redo"
        can={props.canRedo ?? shell?.editHistory.canRedo ?? false}
        label={props.redoLabel ?? shell?.editHistory.redoLabel}
        onClick={onRedo}
      />
    </>
  );
}
