import { useState, useCallback, useRef, useEffect, memo } from "react";
import { formatTime, frameToSeconds } from "../lib/time";
import { Tooltip } from "../../components/ui";

const SHORTCUT_SECTIONS = [
  {
    title: "Playback",
    hints: [
      { key: "Space", label: "Play / Pause" },
      { key: "J", label: "Play backward" },
      { key: "K", label: "Stop" },
      { key: "L", label: "Play forward" },
      { key: "M", label: "Toggle mute" },
      { key: "⇧L", label: "Toggle loop" },
      { key: "←/→", label: "Step 1 frame" },
      { key: "⇧←/⇧→", label: "Step 10 frames" },
      { key: "F", label: "Toggle fullscreen" },
    ],
  },
  {
    title: "Keyframes",
    hints: [
      { key: "K", label: "Add keyframe at playhead" },
      { key: "Del", label: "Delete selected keyframe" },
      { key: "H", label: "Toggle hold / bezier" },
      { key: "U", label: "Expand / collapse properties" },
      { key: "R", label: "Record gesture" },
    ],
  },
  {
    title: "Editing",
    hints: [
      { key: "⌘Z", label: "Undo" },
      { key: "⌘⇧Z", label: "Redo" },
      { key: "⌘C", label: "Copy element" },
      { key: "⌘V", label: "Paste element" },
      { key: "⌘X", label: "Cut element" },
      { key: "S", label: "Split clip at playhead" },
      { key: "⌘G", label: "Group elements" },
      { key: "⌘⇧G", label: "Ungroup" },
      { key: "Del", label: "Delete selected element" },
    ],
  },
  {
    title: "Gesture recording modifiers",
    hints: [
      { key: "Drag", label: "Record x / y position" },
      { key: "Scroll", label: "Record z depth" },
      { key: "⇧ Drag", label: "Record rotationX / rotationY" },
      { key: "⌥ Drag", label: "Record rotation" },
      { key: "⌘ Drag↕", label: "Record opacity" },
      { key: "⌘ Scroll", label: "Record scale" },
    ],
  },
  {
    title: "Canvas",
    hints: [
      { key: "Drag", label: "Move element / add keyframe" },
      { key: "⌥ Drag", label: "Move entire animation path" },
      { key: "⇧ Drag", label: "Uniform resize" },
    ],
  },
  {
    title: "Panels",
    hints: [
      { key: "⌘1", label: "Compositions tab" },
      { key: "⌘2", label: "Assets tab" },
    ],
  },
  {
    title: "Work area",
    hints: [
      { key: "I", label: "Set in-point" },
      { key: "⇧I", label: "Clear in-point" },
      { key: "O", label: "Set out-point" },
      { key: "⇧O", label: "Clear out-point" },
      { key: "A", label: "Jump to in-point" },
      { key: "E", label: "Jump to out-point" },
    ],
  },
] as const;

interface ShortcutsPanelProps {
  disabled: boolean;
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  setInPoint: (v: number | null) => void;
  setOutPoint: (v: number | null) => void;
  onSeek: (time: number) => void;
}

export const ShortcutsPanel = memo(function ShortcutsPanel({
  disabled,
  duration,
  inPoint,
  outPoint,
  setInPoint,
  setOutPoint,
  onSeek,
}: ShortcutsPanelProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [jumpFrame, setJumpFrame] = useState("");
  const shortcutsPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showShortcuts) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (shortcutsPanelRef.current && !shortcutsPanelRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showShortcuts]);

  const commitJumpFrame = useCallback(() => {
    if (disabled) return;
    const frame = Number.parseInt(jumpFrame, 10);
    if (!Number.isFinite(frame) || duration <= 0) return;
    onSeek(Math.min(duration, frameToSeconds(Math.max(0, frame))));
  }, [disabled, duration, jumpFrame, onSeek]);

  const handleJumpSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      commitJumpFrame();
    },
    [commitJumpFrame],
  );

  const handleJumpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitJumpFrame();
    },
    [commitJumpFrame],
  );

  return (
    <div ref={shortcutsPanelRef} className="relative flex-shrink-0">
      <Tooltip label="Shortcuts and tools">
        <button
          type="button"
          onClick={() => setShowShortcuts((v) => !v)}
          className={`w-6 h-6 flex items-center justify-center rounded border transition-colors ${
            showShortcuts
              ? "border-neutral-600 text-neutral-200 bg-neutral-800"
              : "border-neutral-800 text-neutral-600 hover:text-neutral-300 hover:border-neutral-600"
          }`}
          aria-label="Shortcuts and tools"
          aria-expanded={showShortcuts}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
          </svg>
        </button>
      </Tooltip>
      {showShortcuts && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 rounded-lg shadow-xl min-w-[220px] overflow-y-auto"
          style={{
            background: "#161618",
            border: "1px solid rgba(255,255,255,0.08)",
            maxHeight: "min(280px, calc(100vh - 80px))",
          }}
        >
          <div className="px-3 pt-3 pb-2.5">
            <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
              Jump to frame
            </p>
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5">
              <input
                value={jumpFrame}
                onChange={(e) => setJumpFrame(e.target.value)}
                disabled={disabled}
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Jump to frame"
                placeholder="frame number"
                className="h-6 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-mono tabular-nums text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-studio-accent/60"
                onKeyDown={handleJumpKeyDown}
                onBlur={commitJumpFrame}
              />
              <Tooltip label="Jump to frame">
                <button
                  type="submit"
                  disabled={disabled}
                  className="h-6 px-2 rounded border border-neutral-700 text-[10px] text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-40"
                >
                  Go
                </button>
              </Tooltip>
            </form>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
          <div className="px-3 pt-2.5 pb-2">
            <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
              Work area
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[20px] text-center"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    I
                  </span>
                  <span className="text-[10px] text-neutral-400">In-point</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {inPoint !== null ? (
                    <>
                      <span className="font-mono text-[10px] text-neutral-300">
                        {formatTime(inPoint)}
                      </span>
                      <Tooltip label="Clear in-point">
                        <button
                          type="button"
                          onClick={() => setInPoint(null)}
                          className="w-4 h-4 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                          aria-label="Clear in-point"
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <span className="text-[10px] text-neutral-600">—</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[20px] text-center"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    O
                  </span>
                  <span className="text-[10px] text-neutral-400">Out-point</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {outPoint !== null ? (
                    <>
                      <span className="font-mono text-[10px] text-neutral-300">
                        {formatTime(outPoint)}
                      </span>
                      <Tooltip label="Clear out-point">
                        <button
                          type="button"
                          onClick={() => setOutPoint(null)}
                          className="w-4 h-4 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                          aria-label="Clear out-point"
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <span className="text-[10px] text-neutral-600">—</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
          <div className="px-3 pt-2.5 pb-3 flex flex-col gap-3">
            {SHORTCUT_SECTIONS.map((section) => (
              <div key={section.title}>
                <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                  {section.title}
                </p>
                <div className="flex flex-col gap-1">
                  {section.hints.map((hint) => (
                    <div key={hint.key} className="flex items-center gap-3">
                      <span
                        className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[36px] text-center"
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      >
                        {hint.key}
                      </span>
                      <span className="text-[10px] text-neutral-400">{hint.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
