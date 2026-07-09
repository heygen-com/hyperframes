export function PropertyPanelFlatFooter({
  onAskAgent,
  recordingState,
  recordingDuration,
  onToggleRecording,
}: {
  onAskAgent?: () => void;
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
}) {
  const recording = recordingState === "recording";
  const recordTitle = recording
    ? `Stop recording ${(recordingDuration ?? 0).toFixed(1)}s`
    : "Record gesture (R)";

  return (
    <div className="flex items-center justify-between border-t border-panel-hairline px-4 py-[11px]">
      <button
        type="button"
        data-flat-footer-ask="true"
        onClick={onAskAgent}
        disabled={!onAskAgent}
        className="flex items-center gap-[7px] text-[11px] font-medium text-panel-text-2 disabled:cursor-not-allowed"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="text-panel-accent"
        >
          <path d="M8 1l1.4 4.6L14 7l-4.6 1.4L8 13l-1.4-4.6L2 7l4.6-1.4z" />
        </svg>
        Ask agent about this element
      </button>
      {onToggleRecording && (
        <button
          type="button"
          data-flat-footer-record="true"
          aria-label={recordTitle}
          title={recordTitle}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleRecording}
          className={recording ? "text-panel-danger animate-pulse" : "text-panel-danger"}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            {recording ? (
              <rect x="2" y="2" width="10" height="10" rx="1.5" />
            ) : (
              <circle cx="7" cy="7" r="6" />
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
