import { useEffect, useRef, useState } from "react";
import { evaluateSpringEase, parseSpringBounce } from "@hyperframes/core/spring-ease";
import {
  evaluateWiggleEase,
  parseWiggleEase,
  type WiggleEaseConfig,
} from "@hyperframes/core/wiggle-ease";
import { EASE_PRESETS, easePresetLabel } from "./easePresetLibrary";
import { holdCurvePath, MiniCurveSvg, sampledPath } from "./easeCurveSvg";
import { EaseBezierField, SpringBounceField, WiggleField } from "./EaseParamFields";
import { EASE_CURVES, EASE_LABELS, resolveEaseCurveTuple } from "./gsapAnimationConstants";
import { roundToCenti } from "../../utils/rounding";
import type { AnimationKeyframeTarget } from "../../hooks/gsapTweenSynth";

export { MiniCurveSvg } from "./easeCurveSvg";

const EASE_MODES = ["curve", "spring", "wiggle"] as const;
type EaseMode = (typeof EASE_MODES)[number];

const EasePresetGrid = function EasePresetGrid({
  kind,
  currentEase,
  onSelect,
}: {
  kind: EaseMode;
  currentEase: string;
  onSelect: (ease: string) => void;
}) {
  return (
    <div className="mb-2 grid max-h-56 grid-cols-4 gap-1 overflow-y-auto pr-0.5">
      {EASE_PRESETS.filter((preset) => preset.kind === kind).map((preset) => {
        const isActive = currentEase === preset.ease;
        return (
          <button
            key={preset.id}
            type="button"
            data-ease-preset-id={preset.id}
            onClick={() => onSelect(preset.ease)}
            className={`flex flex-col items-center gap-0.5 rounded-md p-1 transition-colors ${
              isActive ? "bg-panel-accent/10 ring-1 ring-panel-accent/30" : "hover:bg-neutral-800"
            }`}
            title={preset.label}
          >
            <MiniCurveSvg ease={preset.ease} active={isActive} />
            <span
              className={`text-center text-[8px] leading-none ${
                isActive ? "text-panel-accent" : "text-neutral-500"
              }`}
            >
              {preset.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const round2 = roundToCenti;

// ── Graph geometry (Figma-style easing box) ─────────────────────────────────
// A geometrically-square unit plot ([0,1]×[0,1], equal X/Y scale so the curve
// isn't distorted), with fixed overshoot headroom above 1 and below 0 for
// back/elastic eases. The view is fixed (no per-curve zoom); handles are clamped
// to the visible range so they never drift off-screen.
const S = 184; // side of the unit (0..1) square, in viewBox units
const HR = 52; // overshoot headroom (top & bottom)
const PADH = 16; // horizontal breathing room
const SVGW = S + PADH * 2;
const SVGH = S + HR * 2;
const VMAX = 1 + HR / S; // top of visible view (progress overshoot headroom)
const VMIN = -HR / S; // bottom of visible view (undershoot headroom)
// Committed control points may extend PAST the visible view — heavy back/elastic
// presets reach ~1.55 / -0.55. Dragging clamps to this wider bound (cursor can
// leave the box via pointer capture) so those curves keep their fidelity instead
// of snapping to the view edge; the handle DOT is still clampView'd into view.
const DRAG_VMAX = 2;
const DRAG_VMIN = -1;
const ACCENT = "#3CE6AC";

type Pts = [number, number, number, number];
const DEFAULT_CURVE: Pts = EASE_CURVES["power2.out"];
const MODE_LABELS = { curve: "Curve", spring: "Spring", wiggle: "Wiggle" } satisfies Record<
  EaseMode,
  string
>;
const DEFAULT_EASE_BY_MODE = {
  curve: `custom(M0,0 C${DEFAULT_CURVE[0]},${DEFAULT_CURVE[1]} ${DEFAULT_CURVE[2]},${DEFAULT_CURVE[3]} 1,1)`,
  spring: "spring(0.42)",
  wiggle: "wiggle(3,easeInOut,0.12)",
} satisfies Record<EaseMode, string>;

function EaseModeToggle({ mode, onCommit }: { mode: EaseMode; onCommit: (ease: string) => void }) {
  return (
    <div
      className="mb-2 grid grid-cols-3 rounded-md bg-black/20 p-0.5"
      role="group"
      aria-label="Ease editor mode"
    >
      {EASE_MODES.map((candidateMode) => {
        const active = candidateMode === mode;
        return (
          <button
            key={candidateMode}
            type="button"
            data-ease-mode={candidateMode}
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              onCommit(DEFAULT_EASE_BY_MODE[candidateMode]);
            }}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              active ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {MODE_LABELS[candidateMode]}
          </button>
        );
      })}
    </div>
  );
}

// Figma-style ease-type dropdown: the current ease (glyph + name) as a button
// that opens the preset grid in a popover. This is where a preset is selected —
// the grid is no longer shown inline.
function EaseTypeDropdown({
  kind,
  ease,
  label,
  onSelect,
}: {
  kind: EaseMode;
  ease: string;
  label: string;
  onSelect: (ease: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mb-2">
      <button
        type="button"
        data-ease-type-dropdown=""
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-left transition-colors hover:border-white/20"
      >
        <MiniCurveSvg ease={ease} active size={16} />
        <span className="text-[11px] text-neutral-200">{label}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`ml-auto text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3l3 4 3-4z" />
        </svg>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-md border border-white/10 bg-neutral-900 p-2 shadow-xl">
          <EasePresetGrid
            kind={kind}
            currentEase={ease}
            onSelect={(next) => {
              onSelect(next);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function resolveEditableCurve(ease: string, springBounce: number | null): Pts | null {
  if (springBounce !== null) return DEFAULT_CURVE;
  if (ease === "hold") return DEFAULT_CURVE;
  if (ease.startsWith("custom(") || ease in EASE_CURVES) return resolveEaseCurveTuple(ease);
  return null;
}

function resolveEditorLabel(ease: string, springBounce: number | null, isWiggle: boolean): string {
  const presetLabel = easePresetLabel(ease);
  if (presetLabel !== null) return presetLabel;
  if (springBounce !== null) return "Custom spring";
  if (isWiggle) return "Custom wiggle";
  if (ease.startsWith("custom(")) return "Custom bezier";
  return EASE_LABELS[ease] ?? ease;
}

const xToSvg = (px: number) => PADH + S * px;
const yToSvg = (py: number) => HR + S * (1 - py);
const clampView = (py: number) => Math.max(VMIN, Math.min(VMAX, py));

function curvePathFor(
  ease: string,
  springBounce: number | null,
  wiggleConfig: WiggleEaseConfig | null,
  tuple: Pts,
): string {
  if (ease === "hold") return holdCurvePath(xToSvg(0), yToSvg(0), xToSvg(1), yToSvg(1));
  if (wiggleConfig !== null) {
    return sampledPath(64, xToSvg, yToSvg, (progress) =>
      evaluateWiggleEase(progress, wiggleConfig.wiggles, wiggleConfig.type, wiggleConfig.amplitude),
    );
  }
  if (springBounce !== null) {
    return sampledPath(64, xToSvg, yToSvg, (progress) =>
      evaluateSpringEase(progress, springBounce),
    );
  }
  const [x1, y1, x2, y2] = tuple;
  return `M${xToSvg(0)},${yToSvg(0)} C${xToSvg(x1)},${yToSvg(y1)} ${xToSvg(x2)},${yToSvg(y2)} ${xToSvg(1)},${yToSvg(1)}`;
}

function EaseParameterField({
  springBounce,
  wiggleConfig,
  tuple,
  onCommit,
}: {
  springBounce: number | null;
  wiggleConfig: WiggleEaseConfig | null;
  tuple: Pts;
  onCommit: (ease: string) => void;
}) {
  if (springBounce !== null) {
    return <SpringBounceField springBounce={springBounce} onCommit={onCommit} />;
  }
  if (wiggleConfig !== null) return <WiggleField config={wiggleConfig} onCommit={onCommit} />;
  return <EaseBezierField tuple={tuple} onCommit={onCommit} />;
}

export function EaseCurveSection({
  ease,
  onCustomEaseCommit,
  collidingAnimationTargets,
}: {
  ease: string;
  onCustomEaseCommit: (ease: string) => void;
  collidingAnimationTargets?: AnimationKeyframeTarget[];
}) {
  const [pendingEase, setPendingEase] = useState<{ source: string; value: string } | null>(null);
  const displayedEase = pendingEase?.source === ease ? pendingEase.value : ease;
  const springBounce = parseSpringBounce(displayedEase);
  const isSpring = springBounce !== null;
  const wiggleConfig = parseWiggleEase(displayedEase);
  const isWiggle = wiggleConfig !== null;
  const mode: EaseMode = isSpring ? "spring" : isWiggle ? "wiggle" : "curve";
  const curve = resolveEditableCurve(displayedEase, springBounce);

  const [draft, setDraft] = useState<Pts | null>(null);
  const [hover, setHover] = useState<"p1" | "p2" | null>(null);
  const draggingRef = useRef<"p1" | "p2" | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Keep the local draft displayed until the committed `ease` prop round-trips
  // back (write → reparse → re-render), then drop it. Clearing on pointer-up
  // instead would fall back to the STALE prop for a frame — the curve snaps to
  // the old value and jumps to the new one (the commit flicker). By the time
  // `ease` changes, `curve` already equals the draft, so the handoff is seamless.
  useEffect(() => {
    setDraft(null);
    setPendingEase(null);
  }, [ease]);

  const commitEase = (nextEase: string) => {
    setPendingEase({ source: ease, value: nextEase });
    onCustomEaseCommit(nextEase);
  };

  const activeTuple = draft ?? curve;
  const displayTuple = activeTuple ?? DEFAULT_CURVE;
  const [x1, y1, x2, y2] = displayTuple;

  // Anchors + control handles. Handle *display* is clamped to the view so an
  // extreme loaded overshoot rides the edge instead of disappearing.
  const a0 = { x: xToSvg(0), y: yToSvg(0) };
  const a1 = { x: xToSvg(1), y: yToSvg(1) };
  const p1 = { x: xToSvg(x1), y: yToSvg(clampView(y1)) };
  const p2 = { x: xToSvg(x2), y: yToSvg(clampView(y2)) };
  const curvePath = curvePathFor(displayedEase, springBounce, wiggleConfig, displayTuple);
  const showGraph = activeTuple !== null || isWiggle;
  const showHandles = !isSpring && !isWiggle;

  const handlePointerDown = (handle: "p1" | "p2", e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = handle;
    (e.target as SVGElement).setPointerCapture(e.pointerId);
    if (!draft) setDraft([x1, y1, x2, y2]);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current || !svgRef.current) return;
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * SVGW;
    const sy = ((e.clientY - rect.top) / rect.height) * SVGH;
    // px is clamped to [0,1] on purpose: a cubic-bezier ease must be monotonic in
    // time (handle1.x ≤ handle2.x), so handles can't pass each other or invert.
    const px = Math.max(0, Math.min(1, (sx - PADH) / S));
    // py uses the WIDER drag bound (not clampView), so dragging keeps overshoot
    // fidelity instead of pinning the committed value to the visible view edge.
    const py = Math.max(DRAG_VMIN, Math.min(DRAG_VMAX, 1 - (sy - HR) / S));
    const prev = draft ?? [x1, y1, x2, y2];
    const next: Pts =
      draggingRef.current === "p1"
        ? [round2(px), round2(py), prev[2], prev[3]]
        : [prev[0], prev[1], round2(px), round2(py)];
    setDraft(next);
  };

  const handlePointerUp = () => {
    if (!draggingRef.current || !draft) return;
    draggingRef.current = null;
    const path = `M0,0 C${draft[0]},${draft[1]} ${draft[2]},${draft[3]} 1,1`;
    // Commit only — the draft stays on screen and is cleared by the effect above
    // once the committed `ease` prop comes back, so the curve never flickers.
    commitEase(`custom(${path})`);
  };

  const top = yToSvg(1);
  const bottom = yToSvg(0);
  const left = xToSvg(0);
  const right = xToSvg(1);
  const label = resolveEditorLabel(displayedEase, springBounce, isWiggle);

  return (
    <div className="rounded-lg bg-neutral-900/50 p-2">
      <EaseTypeDropdown kind={mode} ease={displayedEase} label={label} onSelect={commitEase} />
      {collidingAnimationTargets && collidingAnimationTargets.length > 1 && (
        <p className="mb-1 text-[9px] text-neutral-500">
          Applies to {collidingAnimationTargets.length} properties
        </p>
      )}
      <EaseModeToggle mode={mode} onCommit={commitEase} />
      {showGraph ? (
        <>
          <div
            className="mx-auto overflow-hidden rounded-md border border-white/5 bg-black/20"
            style={{ aspectRatio: `${SVGW} / ${SVGH}`, width: "100%", maxWidth: 230 }}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${SVGW} ${SVGH}`}
              preserveAspectRatio="none"
              className="touch-none select-none"
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {/* Grid — quarter lines inside the unit square */}
              {[0.25, 0.5, 0.75].map((q) => (
                <line
                  key={`v${q}`}
                  x1={xToSvg(q)}
                  y1={top}
                  x2={xToSvg(q)}
                  y2={bottom}
                  stroke="white"
                  strokeOpacity="0.05"
                  strokeWidth="1"
                />
              ))}
              {[0.25, 0.5, 0.75].map((q) => (
                <line
                  key={`h${q}`}
                  x1={left}
                  y1={yToSvg(q)}
                  x2={right}
                  y2={yToSvg(q)}
                  stroke="white"
                  strokeOpacity="0.05"
                  strokeWidth="1"
                />
              ))}
              {/* Unit-square frame (progress 0 → 1) */}
              <rect
                x={left}
                y={top}
                width={S}
                height={bottom - top}
                fill="none"
                stroke="white"
                strokeOpacity="0.1"
                strokeWidth="1"
              />
              {/* Linear reference diagonal */}
              <line
                x1={a0.x}
                y1={a0.y}
                x2={a1.x}
                y2={a1.y}
                stroke="white"
                strokeOpacity="0.08"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              {/* Tangent handle lines */}
              {showHandles && (
                <>
                  <line
                    x1={a0.x}
                    y1={a0.y}
                    x2={p1.x}
                    y2={p1.y}
                    stroke={ACCENT}
                    strokeOpacity="0.5"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={a1.x}
                    y1={a1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={ACCENT}
                    strokeOpacity="0.5"
                    strokeWidth="1.5"
                  />
                </>
              )}
              {/* The curve */}
              <path
                d={curvePath}
                fill="none"
                stroke={ACCENT}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Anchors at (0,0) and (1,1) */}
              <circle cx={a0.x} cy={a0.y} r="3" fill={ACCENT} />
              <circle cx={a1.x} cy={a1.y} r="3" fill={ACCENT} />
              {/* Draggable control handles (large transparent hit area + visible dot) */}
              {showHandles &&
                [["p1", p1] as const, ["p2", p2] as const].map(([key, pt]) => (
                  <g key={key}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="14"
                      fill="transparent"
                      className="cursor-grab active:cursor-grabbing"
                      onPointerDown={(e) => handlePointerDown(key, e)}
                      onPointerEnter={() => setHover(key)}
                      onPointerLeave={() => setHover((h) => (h === key ? null : h))}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={hover === key || draggingRef.current === key ? 7 : 5.5}
                      fill="#0a0a1a"
                      stroke={ACCENT}
                      strokeWidth="2.5"
                      className="pointer-events-none transition-[r]"
                    />
                  </g>
                ))}
            </svg>
          </div>
          <EaseParameterField
            springBounce={springBounce}
            wiggleConfig={wiggleConfig}
            tuple={displayTuple}
            onCommit={commitEase}
          />
        </>
      ) : (
        <p className="px-0.5 py-1.5 text-[10px] leading-relaxed text-neutral-500">
          {label} preset: switch to Curve, Spring, or Wiggle above to shape it by hand.
        </p>
      )}
    </div>
  );
}
