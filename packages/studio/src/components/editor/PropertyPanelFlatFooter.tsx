import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useDomEditSelectionContextOptional } from "../../contexts/DomEditContext";
import { AgentGlyph } from "./agentGlyphs";

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
  const track = useTrackDesignInput();
  const agentState = useDomEditSelectionContextOptional();
  const recording = recordingState === "recording";
  const recordTitle = recording
    ? `Stop recording ${(recordingDuration ?? 0).toFixed(1)}s`
    : "Record gesture (R)";

  return (
    // No border-t here: every possible element immediately above this footer
    // in the new fixed-headers + scrollable-open-section layout (a collapsed
    // FlatGroupHeader, or the open group's scrollable body wrapper) already
    // draws its own border-b in normal document flow — nothing here is
    // `position: sticky` anymore, so there's no rounding seam to seal (see
    // p11-scrollable-open-section-report.md).
    <div className="flex items-center justify-between bg-panel-bg px-4 py-[11px]">
      <button
        type="button"
        data-flat-footer-ask="true"
        onClick={() => {
          track("button", "Ask agent");
          onAskAgent?.();
        }}
        disabled={!onAskAgent}
        className="flex items-center gap-[7px] text-[11px] font-medium text-panel-text-2 disabled:cursor-not-allowed"
      >
        <AgentGlyph
          kind={agentState?.agentRunKind ?? "custom"}
          size={13}
          iconUrl={agentState?.agentIconUrl}
        />
        Ask {agentState?.agentRunLabel ?? "agent"} about this element
        <span className="rounded border border-panel-border-input px-[5px] py-px font-mono text-[9px] text-panel-text-5">
          ⌘K
        </span>
      </button>
      {onToggleRecording && (
        <button
          type="button"
          data-flat-footer-record="true"
          aria-label={recordTitle}
          title={recordTitle}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            track("button", "Gesture recording");
            onToggleRecording();
          }}
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
