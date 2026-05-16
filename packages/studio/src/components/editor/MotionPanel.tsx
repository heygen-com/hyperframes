import { memo, useMemo } from "react";
import { X, Zap } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import {
  STUDIO_GSAP_EASE_OPTIONS,
  buildStudioGsapPresetMotion,
  controlPointsForGsapEase,
  parseStudioCustomEaseData,
  serializeStudioCustomEaseData,
  type StudioCustomEaseControlPoints,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioGsapMotionPreset,
} from "./studioMotion";
import {
  formatNumericValue,
  clampMotionNumber,
  parsePlainNumber,
  DetailField,
  SegmentedControl,
  SelectField,
  MotionSection,
  RESPONSIVE_GRID,
} from "./MotionPanelFields";
import { EaseCurveEditor } from "./EaseCurveEditor";

/** Motion data without targeting metadata (kind/target/updatedAt are derived from context). */
type StudioMotionData = Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">;

interface MotionPanelProps {
  element: DomEditSelection | null;
  motion: StudioMotionData | null;
  onClearSelection: () => void;
  onSetMotion: (element: DomEditSelection, motion: StudioMotionData) => void;
  onClearMotion: (element: DomEditSelection) => void;
}

const MOTION_PRESET_OPTIONS: Array<{ label: string; value: StudioGsapMotionPreset }> = [
  { label: "Fade Up", value: "fade-up" },
  { label: "Slide", value: "slide" },
  { label: "Pop", value: "pop" },
];

const MOTION_DIRECTION_OPTIONS: StudioGsapMotionDirection[] = ["up", "down", "left", "right"];

function motionValueDistance(motion: StudioMotionData | null): number {
  if (!motion) return 32;
  return Math.max(Math.abs(motion.from.x ?? 0), Math.abs(motion.from.y ?? 0), 1);
}

function inferMotionPreset(motion: StudioMotionData | null): StudioGsapMotionPreset {
  if (!motion) return "fade-up";
  if (motion.from.scale != null || motion.to.scale != null) return "pop";
  if (motion.from.x != null || motion.to.x != null) return "slide";
  return "fade-up";
}

function inferMotionDirection(motion: StudioMotionData | null): StudioGsapMotionDirection {
  if (!motion) return "up";
  const x = motion.from.x ?? 0;
  const y = motion.from.y ?? 0;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? "right" : "left";
  return y < 0 ? "down" : "up";
}

function buildStudioCustomEaseId(element: DomEditSelection): string {
  const source = element.id || element.selector || element.label || "layer";
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `studio-${normalized || "layer"}-ease`;
}

export const MotionPanel = memo(function MotionPanel({
  element,
  motion,
  onClearSelection,
  onSetMotion,
  onClearMotion,
}: MotionPanelProps) {
  const activeMotionPreset = inferMotionPreset(motion);
  const activeMotionDirection = inferMotionDirection(motion);
  const activeMotionStart = motion?.start ?? 0;
  const activeMotionDuration = motion?.duration ?? 0.6;
  const activeMotionDistance = motionValueDistance(motion);
  const activeMotionEase = motion?.ease ?? "power3.out";
  const customEaseData = motion?.customEase?.data ?? "";
  const customEaseActive = customEaseData.trim().length > 0;
  const activeCustomEasePoints = useMemo(
    () =>
      parseStudioCustomEaseData(customEaseData) ??
      controlPointsForGsapEase(
        STUDIO_GSAP_EASE_OPTIONS.includes(
          activeMotionEase as (typeof STUDIO_GSAP_EASE_OPTIONS)[number],
        )
          ? activeMotionEase
          : "power3.out",
      ),
    [activeMotionEase, customEaseData],
  );

  if (!element) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-neutral-900 px-6 text-center">
        <Zap size={18} className="mb-3 text-neutral-600" />
        <p className="text-sm font-medium text-neutral-200">Select an element for motion.</p>
        <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
          Timeline layers and inspector selections can receive Studio-authored GSAP motion.
        </p>
      </div>
    );
  }

  const sourceLabel = element.id ? `#${element.id}` : element.selector;
  const easeSelectValue = customEaseActive
    ? "CustomEase"
    : STUDIO_GSAP_EASE_OPTIONS.includes(
          activeMotionEase as (typeof STUDIO_GSAP_EASE_OPTIONS)[number],
        )
      ? activeMotionEase
      : "power3.out";
  const easeSelectOptions = customEaseActive
    ? ["CustomEase", ...STUDIO_GSAP_EASE_OPTIONS]
    : STUDIO_GSAP_EASE_OPTIONS;

  const commitMotion = (
    overrides: Partial<{
      preset: StudioGsapMotionPreset;
      direction: StudioGsapMotionDirection;
      start: number;
      duration: number;
      distance: number;
      ease: string;
      customEaseData: string;
    }>,
  ) => {
    const customEaseText = overrides.customEaseData ?? customEaseData;
    const customEase = customEaseText.trim()
      ? {
          id: motion?.customEase?.id ?? buildStudioCustomEaseId(element),
          data: customEaseText.trim(),
        }
      : undefined;
    const nextEase = customEase
      ? customEase.id
      : (overrides.ease ?? activeMotionEase).trim() || "none";
    onSetMotion(
      element,
      buildStudioGsapPresetMotion(overrides.preset ?? activeMotionPreset, {
        start: clampMotionNumber(overrides.start ?? activeMotionStart, 0, 3600, 0),
        duration: clampMotionNumber(overrides.duration ?? activeMotionDuration, 0.01, 3600, 0.6),
        distance: clampMotionNumber(overrides.distance ?? activeMotionDistance, 1, 2000, 32),
        direction: overrides.direction ?? activeMotionDirection,
        ease: nextEase,
        customEase,
      }),
    );
  };

  const commitCustomEase = (points: StudioCustomEaseControlPoints) => {
    commitMotion({
      ease: buildStudioCustomEaseId(element),
      customEaseData: serializeStudioCustomEaseData(points),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      <div className="border-b border-neutral-800 px-4 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500">
              Motion Target
            </div>
            <div className="mt-3 truncate text-[12px] font-semibold text-neutral-100">
              {element.label}
            </div>
            <div className="mt-1 truncate text-[11px] text-neutral-500">{sourceLabel}</div>
          </div>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClearSelection}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-500 shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-colors hover:border-neutral-600 hover:text-neutral-200"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <MotionSection
          title="GSAP Motion"
          accessory={
            <div className="rounded-full border border-studio-accent/40 bg-studio-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-studio-accent">
              GSAP
            </div>
          }
        >
          <div className="space-y-4">
            <SegmentedControl
              value={activeMotionPreset}
              onChange={(next) => commitMotion({ preset: next as StudioGsapMotionPreset })}
              options={MOTION_PRESET_OPTIONS}
            />
            <div className={RESPONSIVE_GRID}>
              <SelectField
                label="Direction"
                value={activeMotionDirection}
                onChange={(next) => commitMotion({ direction: next as StudioGsapMotionDirection })}
                options={MOTION_DIRECTION_OPTIONS}
              />
              <SelectField
                label="Ease"
                value={easeSelectValue}
                onChange={(next) => {
                  if (next === "CustomEase") return;
                  commitMotion({ ease: next, customEaseData: "" });
                }}
                options={easeSelectOptions}
              />
            </div>
            <div className={RESPONSIVE_GRID}>
              <DetailField
                label="Start"
                value={formatNumericValue(activeMotionStart)}
                onCommit={(next) => commitMotion({ start: parsePlainNumber(next) ?? 0 })}
              />
              <DetailField
                label="Duration"
                value={formatNumericValue(activeMotionDuration)}
                onCommit={(next) => commitMotion({ duration: parsePlainNumber(next) ?? 0.6 })}
              />
              <DetailField
                label="Distance"
                value={formatNumericValue(activeMotionDistance)}
                onCommit={(next) => commitMotion({ distance: parsePlainNumber(next) ?? 32 })}
              />
            </div>
          </div>
        </MotionSection>

        <MotionSection
          title="Ease Curve"
          accessory={
            <div className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-yellow-300">
              CustomEase
            </div>
          }
        >
          <div className="space-y-4">
            <EaseCurveEditor points={activeCustomEasePoints} onCommit={commitCustomEase} />
            <DetailField
              label="CustomEase path"
              value={customEaseData}
              onCommit={(next) => {
                const parsed = parseStudioCustomEaseData(next);
                if (parsed) commitCustomEase(parsed);
              }}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onClearMotion(element)}
                disabled={!motion}
                className="inline-flex h-8 items-center rounded-xl border border-neutral-700 bg-neutral-950 px-3 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600"
              >
                Clear motion
              </button>
            </div>
          </div>
        </MotionSection>
      </div>
    </div>
  );
});
