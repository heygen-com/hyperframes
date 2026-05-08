import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { RotateCcw, X, Zap } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import {
  STUDIO_GSAP_EASE_OPTIONS,
  buildStudioGsapPresetMotion,
  clampStudioCustomEasePoints,
  controlPointsForGsapEase,
  parseStudioCustomEaseData,
  serializeStudioCustomEaseData,
  type StudioCustomEaseControlPoints,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioGsapMotionPreset,
} from "./studioMotion";

interface MotionPanelProps {
  element: DomEditSelection | null;
  motion: StudioGsapMotion | null;
  onClearSelection: () => void;
  onSetMotion: (
    element: DomEditSelection,
    motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
  ) => void;
  onClearMotion: (element: DomEditSelection) => void;
}

const FIELD =
  "min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-neutral-600";
const LABEL = "text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500";
const RESPONSIVE_GRID = "grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-3";

const MOTION_PRESET_OPTIONS: Array<{ label: string; value: StudioGsapMotionPreset }> = [
  { label: "Fade Up", value: "fade-up" },
  { label: "Slide", value: "slide" },
  { label: "Pop", value: "pop" },
];

const MOTION_DIRECTION_OPTIONS: StudioGsapMotionDirection[] = ["up", "down", "left", "right"];

function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function clampMotionNumber(
  value: number | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parsePlainNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function motionValueDistance(motion: StudioGsapMotion | null): number {
  if (!motion) return 32;
  return Math.max(Math.abs(motion.from.x ?? 0), Math.abs(motion.from.y ?? 0), 1);
}

function inferMotionPreset(motion: StudioGsapMotion | null): StudioGsapMotionPreset {
  if (!motion) return "fade-up";
  if (motion.from.scale != null || motion.to.scale != null) return "pop";
  if (motion.from.x != null || motion.to.x != null) return "slide";
  return "fade-up";
}

function inferMotionDirection(motion: StudioGsapMotion | null): StudioGsapMotionDirection {
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

function CommitField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commitDraft = () => {
    focusedRef.current = false;
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className="w-full min-w-0 bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
    />
  );
}

function DetailField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <CommitField value={value} disabled={disabled} onCommit={onCommit} />
      </div>
    </label>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-neutral-800 bg-neutral-950 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-9 rounded-xl text-[11px] font-semibold transition-colors ${
            option.value === value
              ? "bg-neutral-800 text-white shadow-sm"
              : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function MotionSection({
  title,
  children,
  accessory,
}: {
  title: string;
  children: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <section className="border-b border-neutral-800 px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Zap size={15} className="text-neutral-500" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-300">
            {title}
          </h3>
        </div>
        {accessory}
      </div>
      {children}
    </section>
  );
}

function cubicBezierPoint(t: number, p1: StudioCustomEaseControlPoints): { x: number; y: number } {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const t2 = t * t;
  return {
    x: 3 * inv2 * t * p1.x1 + 3 * inv * t2 * p1.x2 + t2 * t,
    y: 3 * inv2 * t * p1.y1 + 3 * inv * t2 * p1.y2 + t2 * t,
  };
}

function buildCurvePath(
  points: StudioCustomEaseControlPoints,
  map: (point: { x: number; y: number }) => { x: number; y: number },
): string {
  const commands: string[] = [];
  for (let index = 0; index <= 48; index += 1) {
    const point = map(cubicBezierPoint(index / 48, points));
    commands.push(`${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`);
  }
  return commands.join(" ");
}

function EaseCurveEditor({
  points,
  onCommit,
}: {
  points: StudioCustomEaseControlPoints;
  onCommit: (points: StudioCustomEaseControlPoints) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState(points);
  const draggingRef = useRef<"p1" | "p2" | null>(null);

  useEffect(() => {
    setDraft(points);
  }, [points]);

  const width = 324;
  const height = 214;
  const plot = { left: 46, top: 24, width: 242, height: 146 };
  const yMin = -0.4;
  const yMax = 1.4;

  const mapPoint = (point: { x: number; y: number }) => ({
    x: plot.left + point.x * plot.width,
    y: plot.top + ((yMax - point.y) / (yMax - yMin)) * plot.height,
  });

  const unmapPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    return clampStudioCustomEasePoints({
      x1: draggingRef.current === "p1" ? (x - plot.left) / plot.width : draft.x1,
      y1:
        draggingRef.current === "p1"
          ? yMax - ((y - plot.top) / plot.height) * (yMax - yMin)
          : draft.y1,
      x2: draggingRef.current === "p2" ? (x - plot.left) / plot.width : draft.x2,
      y2:
        draggingRef.current === "p2"
          ? yMax - ((y - plot.top) / plot.height) * (yMax - yMin)
          : draft.y2,
    });
  };

  const start = mapPoint({ x: 0, y: 0 });
  const end = mapPoint({ x: 1, y: 1 });
  const p1 = mapPoint({ x: draft.x1, y: draft.y1 });
  const p2 = mapPoint({ x: draft.x2, y: draft.y2 });
  const curvePath = buildCurvePath(draft, mapPoint);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    const next = unmapPointer(event);
    if (next) setDraft(next);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    onCommit(draft);
  };

  const startDrag = (handle: "p1" | "p2", event: PointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2">
        <div>
          <div className={LABEL}>CustomEase</div>
          <div className="mt-1 font-mono text-[10px] text-neutral-500">
            {serializeStudioCustomEaseData(draft)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const reset = controlPointsForGsapEase("power3.out");
            setDraft(reset);
            onCommit(reset);
          }}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
        >
          <RotateCcw size={13} />
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full select-none touch-none"
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {[0, 0.5, 1].map((value) => {
          const mapped = mapPoint({ x: 0, y: value });
          return (
            <g key={value}>
              <line
                x1={plot.left}
                x2={plot.left + plot.width}
                y1={mapped.y}
                y2={mapped.y}
                stroke="rgba(255,255,255,0.12)"
                strokeDasharray="5 8"
              />
              <text
                x={plot.left - 12}
                y={mapped.y + 4}
                textAnchor="end"
                className="fill-neutral-500 text-[10px] font-semibold"
              >
                {value}
              </text>
            </g>
          );
        })}
        <line
          x1={plot.left}
          x2={plot.left + plot.width}
          y1={plot.top + plot.height}
          y2={plot.top + plot.height}
          stroke="rgba(255,255,255,0.18)"
        />
        <line
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={plot.top + plot.height}
          stroke="rgba(255,255,255,0.18)"
        />
        <line x1={start.x} y1={start.y} x2={p1.x} y2={p1.y} stroke="rgba(255,221,87,0.34)" />
        <line x1={end.x} y1={end.y} x2={p2.x} y2={p2.y} stroke="rgba(255,221,87,0.34)" />
        <path d={curvePath} fill="none" stroke="#ffdd57" strokeWidth="4" strokeLinecap="round" />
        <circle cx={start.x} cy={start.y} r="5" fill="#ffdd57" />
        <circle cx={end.x} cy={end.y} r="5" fill="#ffdd57" />
        <circle
          cx={p1.x}
          cy={p1.y}
          r="9"
          fill="#141414"
          stroke="#ffdd57"
          strokeWidth="4"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => startDrag("p1", event)}
        />
        <circle
          cx={p2.x}
          cy={p2.y}
          r="9"
          fill="#141414"
          stroke="#ffdd57"
          strokeWidth="4"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => startDrag("p2", event)}
        />
        <text x={p1.x + 12} y={p1.y - 10} className="fill-neutral-400 text-[10px] font-semibold">
          P1
        </text>
        <text x={p2.x + 12} y={p2.y - 10} className="fill-neutral-400 text-[10px] font-semibold">
          P2
        </text>
      </svg>
      <div className="grid grid-cols-2 gap-2 border-t border-neutral-800 p-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-[10px] text-neutral-400">
          P1 {formatNumericValue(draft.x1)}, {formatNumericValue(draft.y1)}
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-[10px] text-neutral-400">
          P2 {formatNumericValue(draft.x2)}, {formatNumericValue(draft.y2)}
        </div>
      </div>
    </div>
  );
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
            <div className={LABEL}>Motion Target</div>
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
