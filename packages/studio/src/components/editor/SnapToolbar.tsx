import { memo, useCallback, useEffect, useState } from "react";
import { MagnetStraight, GridFour, Path } from "@phosphor-icons/react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { usePlayerStore } from "../../player/store/playerStore";
import { IconButton, Popover } from "../ui";

/**
 * These three sit ON the canvas rather than in panel chrome, so they carry a
 * backdrop of their own; `IconButton`'s ghost variant is transparent and would
 * leave the glyphs to fight whatever the composition is rendering underneath.
 */
const OVER_CANVAS = "bg-bg-0/40 text-text-2 enabled:hover:bg-bg-0/60 enabled:hover:text-text-0";
const OVER_CANVAS_ON = "bg-accent/20 text-accent";

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

  return (
    <div
      className="absolute top-2 right-2 z-50 flex items-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {motionPathCreateAvailable && (
        <IconButton
          size="md"
          className={motionPathArmed ? OVER_CANVAS_ON : OVER_CANVAS}
          onClick={() => setMotionPathArmed(!motionPathArmed)}
          title={
            motionPathArmed ? "Click the canvas to set the destination" : "Set motion destination"
          }
          aria-label="Set motion destination"
          aria-pressed={motionPathArmed}
          icon={<Path size={16} weight={motionPathArmed ? "fill" : "regular"} />}
        />
      )}
      <IconButton
        size="md"
        className={prefs.snapEnabled ? OVER_CANVAS_ON : OVER_CANVAS}
        onClick={toggleSnap}
        title={prefs.snapEnabled ? "Snap enabled (S)" : "Snap disabled (S)"}
        aria-label="Toggle snap"
        aria-pressed={prefs.snapEnabled}
        icon={<MagnetStraight size={16} weight={prefs.snapEnabled ? "fill" : "regular"} />}
      />

      <div className="relative">
        <IconButton
          size="md"
          className={prefs.gridVisible ? OVER_CANVAS_ON : OVER_CANVAS}
          onClick={toggleGrid}
          onContextMenu={(e) => {
            e.preventDefault();
            setGridPopoverOpen((v) => !v);
          }}
          title={
            prefs.gridVisible
              ? "Grid visible (G) — right-click for spacing options"
              : "Grid hidden (G) — right-click for spacing options"
          }
          aria-label="Toggle grid"
          aria-pressed={prefs.gridVisible}
          icon={<GridFour size={16} weight={prefs.gridVisible ? "fill" : "regular"} />}
        />
        {/* A form, not a list of actions, so it is a Popover and the arrow keys
            stay with the number field inside it (KTD5). Base UI owns the
            outside press and the Escape; the hand-rolled `mousedown` listener
            this replaced could not see a press that the canvas overlay had
            already stopped. */}
        <Popover
          open={gridPopoverOpen}
          onOpenChange={setGridPopoverOpen}
          align="end"
          aria-label="Grid options"
          className="min-w-[180px]"
          trigger={
            <button
              type="button"
              className="absolute -right-0.5 -bottom-0.5 rounded-sm bg-bg-0/50 p-0.5 text-text-3 hover:text-text-0"
              title="Grid options"
              aria-label="Grid options"
            >
              <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                <path d="M1 2.5l3 3 3-3z" />
              </svg>
            </button>
          }
        >
          <label className="mb-2 flex items-center justify-between">
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
              className="w-16 rounded-sm border border-border-input bg-input px-1.5 py-0.5 text-right tabular-nums text-text-0 outline-hidden focus:border-accent"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.snapToGrid}
              onChange={() => updatePrefs({ snapToGrid: !prefs.snapToGrid })}
              className="accent-accent"
            />
            <span>Snap to grid</span>
          </label>
        </Popover>
      </div>
    </div>
  );
});
