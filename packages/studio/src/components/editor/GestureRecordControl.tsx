export type GestureRecordingState = "idle" | "recording" | "preview";

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

  return (
    <div className="px-4 pb-3">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleRecording}
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

interface GestureRecordBadgeProps {
  rect: { left: number; top: number; width: number; height: number };
  recordingState?: GestureRecordingState;
  onToggleRecording: () => void;
}

export function GestureRecordBadge({
  rect,
  recordingState,
  onToggleRecording,
}: GestureRecordBadgeProps) {
  const recording = recordingState === "recording";
  const label = recording ? "Stop gesture recording (R)" : "Record gesture (R)";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`pointer-events-auto absolute z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow-lg transition-colors ${
        recording
          ? "border-red-400/60 bg-red-500 text-white animate-pulse"
          : "border-studio-accent/60 bg-neutral-950 text-studio-accent hover:bg-neutral-900"
      }`}
      style={{
        left: Math.max(0, rect.left + rect.width + 8),
        top: Math.max(0, rect.top - 4),
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleRecording();
      }}
    >
      <GestureRecordIcon recording={recording} />
    </button>
  );
}
