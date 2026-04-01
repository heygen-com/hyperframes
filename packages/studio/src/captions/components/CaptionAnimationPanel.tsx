import { memo, useCallback } from "react";
import { useCaptionStore } from "../store";
import type { CaptionAnimation } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTRANCE_PRESETS = [
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "pop",
  "slam",
  "bounce",
  "typewriter",
  "blur-in",
  "flip",
  "drop",
];

const HIGHLIGHT_PRESETS = [
  "none",
  "color-change",
  "scale-pop",
  "glow-pulse",
  "underline-sweep",
  "background-fill",
  "bounce",
];

const EXIT_PRESETS = [
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scatter",
  "drop",
  "collapse",
  "blur-out",
  "shrink",
];

const EASE_PRESETS = [
  "power1.out",
  "power2.out",
  "power3.out",
  "power4.out",
  "power1.in",
  "power2.in",
  "power3.in",
  "power1.inOut",
  "power2.inOut",
  "back.out(1.7)",
  "elastic.out(1,0.3)",
  "bounce.out",
];

// ---------------------------------------------------------------------------
// Shared input class (matches CaptionPropertyPanel)
// ---------------------------------------------------------------------------

const inputCls =
  "w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-2xs text-neutral-200 font-mono outline-none focus:border-neutral-600";

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mt-2 mb-1.5">
        <span className="text-2xs font-medium text-neutral-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-neutral-600 w-14 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animation phase controls
// ---------------------------------------------------------------------------

interface AnimationPhaseProps {
  label: string;
  presets: string[];
  animation: CaptionAnimation | null;
  showIntensity?: boolean;
  onChange: (update: Partial<CaptionAnimation>) => void;
}

function AnimationPhase({
  label,
  presets,
  animation,
  showIntensity,
  onChange,
}: AnimationPhaseProps) {
  const preset = animation?.preset ?? "none";
  const duration = animation?.duration ?? 0.2;
  const ease = animation?.ease ?? "power2.out";
  const stagger = animation?.stagger ?? 0;
  const intensity = animation?.intensity ?? 1;

  return (
    <Section label={label}>
      <Row label="Preset">
        <select
          value={preset}
          onChange={(e) => onChange({ preset: e.target.value })}
          className={inputCls}
        >
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Duration">
        <input
          type="number"
          value={duration}
          step={0.05}
          min={0}
          max={2}
          onChange={(e) => onChange({ duration: Number(e.target.value) })}
          className={inputCls}
        />
      </Row>

      <Row label="Ease">
        <select
          value={ease}
          onChange={(e) => onChange({ ease: e.target.value })}
          className={inputCls}
        >
          {EASE_PRESETS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Stagger">
        <input
          type="number"
          value={stagger}
          step={0.02}
          min={0}
          max={0.5}
          onChange={(e) => onChange({ stagger: Number(e.target.value) })}
          className={inputCls}
        />
      </Row>

      {showIntensity && (
        <Row label="Intensity">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={intensity}
              onChange={(e) => onChange({ intensity: Number(e.target.value) })}
              className="flex-1 accent-studio-accent"
            />
            <span className="text-2xs text-neutral-400 font-mono w-8 text-right flex-shrink-0">
              {intensity.toFixed(2)}
            </span>
          </div>
        </Row>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CaptionAnimationPanel = memo(function CaptionAnimationPanel() {
  const model = useCaptionStore((s) => s.model);
  const selectedGroupId = useCaptionStore((s) => s.selectedGroupId);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const updateGroupAnimation = useCaptionStore((s) => s.updateGroupAnimation);
  const applyAnimationToAll = useCaptionStore((s) => s.applyAnimationToAll);

  // Resolve which group to edit
  let resolvedGroupId: string | null = selectedGroupId;
  if (!resolvedGroupId && model && selectedSegmentIds.size > 0) {
    const firstSegmentId = [...selectedSegmentIds][0];
    if (firstSegmentId) {
      for (const [gid, group] of model.groups) {
        if (group.segmentIds.includes(firstSegmentId)) {
          resolvedGroupId = gid;
          break;
        }
      }
    }
  }

  const group = resolvedGroupId ? model?.groups.get(resolvedGroupId) : undefined;
  const animation = group?.animation;

  // All hooks must be called before any early return
  const handleEntranceChange = useCallback(
    (update: Partial<CaptionAnimation>) => {
      if (resolvedGroupId) updateGroupAnimation(resolvedGroupId, "entrance", update);
    },
    [resolvedGroupId, updateGroupAnimation],
  );

  const handleHighlightChange = useCallback(
    (update: Partial<CaptionAnimation>) => {
      if (resolvedGroupId) updateGroupAnimation(resolvedGroupId, "highlight", update);
    },
    [resolvedGroupId, updateGroupAnimation],
  );

  const handleExitChange = useCallback(
    (update: Partial<CaptionAnimation>) => {
      if (resolvedGroupId) updateGroupAnimation(resolvedGroupId, "exit", update);
    },
    [resolvedGroupId, updateGroupAnimation],
  );

  const handleApplyToAll = useCallback(() => {
    if (animation) applyAnimationToAll(animation);
  }, [animation, applyAnimationToAll]);

  // Empty state — after all hooks
  if (!group || !resolvedGroupId || !animation) {
    return (
      <div className="flex items-center justify-center h-full px-4 text-center">
        <p className="text-xs text-neutral-500">Select a caption group to edit animations</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <AnimationPhase
          label="Entrance"
          presets={ENTRANCE_PRESETS}
          animation={animation.entrance}
          onChange={handleEntranceChange}
        />

        <AnimationPhase
          label="Highlight"
          presets={HIGHLIGHT_PRESETS}
          animation={animation.highlight}
          showIntensity
          onChange={handleHighlightChange}
        />

        <AnimationPhase
          label="Exit"
          presets={EXIT_PRESETS}
          animation={animation.exit}
          onChange={handleExitChange}
        />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-neutral-800">
        <button
          type="button"
          onClick={handleApplyToAll}
          className="w-full py-1.5 rounded border border-neutral-700 text-2xs text-neutral-300 hover:border-studio-accent/50 hover:text-studio-accent transition-colors"
        >
          Apply to all groups
        </button>
      </div>
    </div>
  );
});
