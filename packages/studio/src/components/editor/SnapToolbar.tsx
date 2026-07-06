import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Crop, MagnetStraight, GridFour, Path } from "@phosphor-icons/react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { usePlayerStore } from "../../player/store/playerStore";

const SNAP_DEFAULTS = {
  snapEnabled: true,
  gridVisible: false,
  gridSpacing: 50,
  snapToGrid: false,
};

// fallow-ignore-next-line complexity
function readSnapPrefs() {
  const prefs = readStudioUiPreferences();
  return {
    snapEnabled: prefs.snapEnabled ?? SNAP_DEFAULTS.snapEnabled,
    gridVisible: prefs.gridVisible ?? SNAP_DEFAULTS.gridVisible,
    gridSpacing: prefs.gridSpacing ?? SNAP_DEFAULTS.gridSpacing,
    snapToGrid: prefs.snapToGrid ?? SNAP_DEFAULTS.snapToGrid,
  };
}

interface SnapToolbarProps {
  onSnapChange?: (prefs: {
    snapEnabled: boolean;
    gridVisible: boolean;
    gridSpacing: number;
    snapToGrid: boolean;
  }) => void;
}

// fallow-ignore-next-line complexity
export const SnapToolbar = memo(function SnapToolbar({ onSnapChange }: SnapToolbarProps) {
  const [prefs, setPrefs] = useState(readSnapPrefs);
  const [gridPopoverOpen, setGridPopoverOpen] = useState(false);
  // Motion-path "set destination" toggle — shown only when the selected element
  // can take a path; arms a single canvas click to place it (MotionPathOverlay).
  const motionPathCreateAvailable = usePlayerStore((s) => s.motionPathCreateAvailable);
  const motionPathArmed = usePlayerStore((s) => s.motionPathArmed);
  const setMotionPathArmed = usePlayerStore((s) => s.setMotionPathArmed);
  const cropAvailable = usePlayerStore((s) => s.cropAvailable);
  const cropMode = usePlayerStore((s) => s.cropMode);
  const setCropMode = usePlayerStore((s) => s.setCropMode);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridButtonRef = useRef<HTMLButtonElement>(null);

  const updatePrefs = useCallback(
    (patch: Partial<typeof prefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        writeStudioUiPreferences(patch);
        onSnapChange?.(next);
        return next;
      });
    },
    [onSnapChange],
  );

  const toggleSnap = useCallback(() => {
    updatePrefs({ snapEnabled: !prefs.snapEnabled });
  }, [prefs.snapEnabled, updatePrefs]);

  const toggleGrid = useCallback(() => {
    updatePrefs({ gridVisible: !prefs.gridVisible });
  }, [prefs.gridVisible, updatePrefs]);

  useEffect(() => {
    // fallow-ignore-next-line complexity
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      if (t instanceof HTMLIFrameElement) return;
      if (e.key === "s" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        updatePrefs({ snapEnabled: !readSnapPrefs().snapEnabled });
      }
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        updatePrefs({ gridVisible: !readSnapPrefs().gridVisible });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [updatePrefs]);

  useEffect(() => {
    if (!gridPopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || gridButtonRef.current?.contains(target)) return;
      setGridPopoverOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [gridPopoverOpen]);

  return (
    <div
      className="absolute top-2 right-2 z-50 flex items-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {cropAvailable && (
        <button
          type="button"
          className={`rounded-md p-1.5 transition-colors ${
            cropMode
              ? "bg-studio-accent/20 text-studio-accent"
              : "bg-black/40 text-white/60 hover:bg-black/60 hover:text-white/80"
          }`}
          onClick={() => setCropMode(!cropMode)}
          title={cropMode ? "Exit crop (Esc)" : "Crop selection"}
          aria-label="Crop selection"
          aria-pressed={cropMode}
        >
          <Crop size={16} weight={cropMode ? "fill" : "regular"} />
        </button>
      )}
      {motionPathCreateAvailable && (
        <button
          type="button"
          className={`rounded-md p-1.5 transition-colors ${
            motionPathArmed
              ? "bg-studio-accent/20 text-studio-accent"
              : "bg-black/40 text-white/60 hover:bg-black/60 hover:text-white/80"
          }`}
          onClick={() => setMotionPathArmed(!motionPathArmed)}
          title={
            motionPathArmed ? "Click the canvas to set the destination" : "Set motion destination"
          }
          aria-label="Set motion destination"
        >
          <Path size={16} weight={motionPathArmed ? "fill" : "regular"} />
        </button>
      )}
      <button
        type="button"
        className={`rounded-md p-1.5 transition-colors ${
          prefs.snapEnabled
            ? "bg-studio-accent/20 text-studio-accent"
            : "bg-black/40 text-white/60 hover:bg-black/60 hover:text-white/80"
        }`}
        onClick={toggleSnap}
        title={prefs.snapEnabled ? "Snap enabled (S)" : "Snap disabled (S)"}
        aria-label="Toggle snap"
      >
        <MagnetStraight size={16} weight={prefs.snapEnabled ? "fill" : "regular"} />
      </button>

      <div className="relative">
        <button
          ref={gridButtonRef}
          type="button"
          className={`rounded-md p-1.5 transition-colors ${
            prefs.gridVisible
              ? "bg-studio-accent/20 text-studio-accent"
              : "bg-black/40 text-white/60 hover:bg-black/60 hover:text-white/80"
          }`}
          onClick={toggleGrid}
          onContextMenu={(e) => {
            e.preventDefault();
            setGridPopoverOpen((v) => !v);
          }}
          title={prefs.gridVisible ? "Grid visible (G)" : "Grid hidden (G)"}
          aria-label="Toggle grid"
        >
          <GridFour size={16} weight={prefs.gridVisible ? "fill" : "regular"} />
        </button>

        {gridPopoverOpen && (
          <div
            ref={popoverRef}
            className="absolute right-0 top-full mt-1 rounded-lg bg-neutral-800 border border-neutral-700 p-3 shadow-xl min-w-[180px]"
          >
            <label className="flex items-center justify-between text-xs text-white/80 mb-2">
              <span>Grid spacing</span>
              <input
                type="number"
                min={10}
                max={500}
                step={10}
                value={prefs.gridSpacing}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val >= 10 && val <= 500) {
                    updatePrefs({ gridSpacing: val });
                  }
                }}
                className="w-16 rounded bg-neutral-900 border border-neutral-600 px-1.5 py-0.5 text-xs text-white text-right tabular-nums outline-none focus:border-studio-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.snapToGrid}
                onChange={() => updatePrefs({ snapToGrid: !prefs.snapToGrid })}
                className="accent-studio-accent"
              />
              <span>Snap to grid</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
});
