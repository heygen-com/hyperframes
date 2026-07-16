import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";

type GestureRecordingState = "idle" | "recording" | "preview";

interface GestureRecordIconProps {
  recording: boolean;
}

function GestureRecordIcon({ recording }: GestureRecordIconProps) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {recording ? (
        <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
      ) : (
        <circle cx="5" cy="5" r="4.5" fill="currentColor" />
      )}
    </svg>
  );
}

interface GestureRecordPanelButtonProps {
  recordingState?: GestureRecordingState;
  recordingDuration?: number;
  onToggleRecording: () => void;
}

export function GestureRecordPanelButton({
  recordingState,
  recordingDuration,
  onToggleRecording,
}: GestureRecordPanelButtonProps) {
  const recording = recordingState === "recording";
  const track = useTrackDesignInput();

  return (
    <div className="px-4 pb-3">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          track("button", "Gesture recording");
          onToggleRecording();
        }}
        className={`w-full flex items-center justify-center gap-2 rounded-lg py-2 text-[11px] font-medium transition-colors ${
          recording
            ? "bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse"
            : "bg-panel-input text-panel-text-2 hover:bg-panel-hover border border-panel-border"
        }`}
      >
        <GestureRecordIcon recording={recording} />
        {recording
          ? `Stop recording ${(recordingDuration ?? 0).toFixed(1)}s -- press R`
          : "Record gesture (R) -- move pointer to capture motion"}
      </button>
    </div>
  );
}
