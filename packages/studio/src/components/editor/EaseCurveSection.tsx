import { useCallback, useRef, useState } from "react";
import { EASE_CURVES, EASE_LABELS, parseCustomEaseFromString } from "./gsapAnimationConstants";
import { roundToCenti } from "../../utils/rounding";

// Figma-canonical ordering: linear, the three core eases, then the expressive
// (back / snappy) family. Each maps to a GSAP ease so it round-trips cleanly.
const PRESET_GRID_EASES = [
  "none",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "back.in",
  "back.out",
  "back.inOut",
  "expo.out",
] as const;

function MiniCurveSvg({
  curve,
  active,
}: {
  curve: [number, number, number, number];
  active: boolean;
}) {
  const [x1, y1, x2, y2] = curve;
  const s = 24;
  const p = 3;
  const g = s - p * 2;
  const sx = (px: number) => p + g * px;
  const sy = (py: number) => s - p - g * py;
  const d = `M${p},${s - p} C${sx(x1)},${sy(y1)} ${sx(x2)},${sy(y2)} ${s - p},${p}`;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <path
        d={d}
        fill="none"
        stroke={active ? "#3CE6AC" : "#737373"}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const EasePresetGrid = function EasePresetGrid({
  currentEase,
  onSelect,
}: {
  currentEase: string;
  onSelect: (ease: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1 mb-2">
      {PRESET_GRID_EASES.map((name) => {
        const curve = EASE_CURVES[name];
        if (!curve) return null;
        const isActive = currentEase === name;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            className={`flex flex-col items-center gap-0.5 rounded-md p-1 transition-colors ${
              isActive ? "bg-panel-accent/10 ring-1 ring-panel-accent/30" : "hover:bg-neutral-800"
            }`}
            title={EASE_LABELS[name] ?? name}
          >
            <MiniCurveSvg curve={curve} active={isActive} />
            <span
              className={`text-[8px] leading-none ${isActive ? "text-panel-accent" : "text-neutral-500"}`}
            >
              {(EASE_LABELS[name] ?? name).split(" ").slice(0, 2).join(" ")}
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

const xToSvg = (px: number) => PADH + S * px;
const yToSvg = (py: number) => HR + S * (1 - py);
const clampView = (py: number) => Math.max(VMIN, Math.min(VMAX, py));

function cubicAt(t: number, c0: number, c1: number, c2: number, c3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * c0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * c3;
}

export function EaseCurveSection({
  ease,
  duration,
  onCustomEaseCommit,
}: {
  ease: string;
  duration?: number;
  onCustomEaseCommit: (ease: string) => void;
}) {
  const isCustom = ease.startsWith("custom(");
  const curveFromPreset = EASE_CURVES[ease];
  const customPoints = isCustom ? parseCustomEaseFromString(ease) : null;
  const curve: Pts | null =
    isCustom && customPoints
      ? [customPoints.x1, customPoints.y1, customPoints.x2, customPoints.y2]
      : (curveFromPreset ?? null);

  const [draft, setDraft] = useState<Pts | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [hover, setHover] = useState<"p1" | "p2" | null>(null);
  const draggingRef = useRef<"p1" | "p2" | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number>(0);

  const play = useCallback(() => {
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      setProgress(t);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setTimeout(() => setProgress(null), 450);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const active = draft ?? curve;
  if (!active) return null;
  const [x1, y1, x2, y2] = active;

  // Anchors + control handles. Handle *display* is clamped to the view so an
  // extreme loaded overshoot rides the edge instead of disappearing.
  const a0 = { x: xToSvg(0), y: yToSvg(0) };
  const a1 = { x: xToSvg(1), y: yToSvg(1) };
  const p1 = { x: xToSvg(x1), y: yToSvg(clampView(y1)) };
  const p2 = { x: xToSvg(x2), y: yToSvg(clampView(y2)) };
  // Curve drawn from the true control points (so its shape is exact).
  const cp1 = { x: xToSvg(x1), y: yToSvg(y1) };
  const cp2 = { x: xToSvg(x2), y: yToSvg(y2) };
  const curvePath = `M${a0.x},${a0.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${a1.x},${a1.y}`;

  let dot: { x: number; y: number } | null = null;
  if (progress !== null) {
    dot = {
      x: xToSvg(cubicAt(progress, 0, x1, x2, 1)),
      y: yToSvg(cubicAt(progress, 0, y1, y2, 1)),
    };
  }

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
    onCustomEaseCommit(`custom(${path})`);
    setDraft(null);
  };

  const top = yToSvg(1);
  const bottom = yToSvg(0);
  const left = xToSvg(0);
  const right = xToSvg(1);
  const label = isCustom ? "Custom curve" : (EASE_LABELS[ease] ?? ease);
  const bezierText = `${x1} · ${y1} · ${x2} · ${y2}`;

  return (
    <div className="rounded-lg bg-neutral-900/50 p-2">
      <EasePresetGrid currentEase={ease} onSelect={(name) => onCustomEaseCommit(name)} />
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-neutral-500">Speed curve</span>
        <button
          type="button"
          onClick={play}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-panel-accent transition-colors hover:bg-panel-accent/10"
        >
          {progress !== null ? "Playing…" : "Preview"}
        </button>
      </div>
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
          {/* The curve */}
          <path d={curvePath} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" />
          {/* Anchors at (0,0) and (1,1) */}
          <circle cx={a0.x} cy={a0.y} r="3" fill={ACCENT} />
          <circle cx={a1.x} cy={a1.y} r="3" fill={ACCENT} />
          {/* Animated preview dot */}
          {dot && (
            <>
              <circle cx={dot.x} cy={dot.y} r="9" fill={ACCENT} fillOpacity="0.18" />
              <circle cx={dot.x} cy={dot.y} r="4.5" fill={ACCENT} />
            </>
          )}
          {/* Draggable control handles (large transparent hit area + visible dot) */}
          {[["p1", p1] as const, ["p2", p2] as const].map(([key, pt]) => (
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
      {/* Axis + value readout */}
      <div className="mt-1.5 flex items-center justify-between px-0.5 text-[9px] text-neutral-600">
        <span>{duration != null && duration > 0 ? "0s" : "start"}</span>
        <span className="tracking-wide text-neutral-500">time →</span>
        <span>{duration != null && duration > 0 ? `${duration}s` : "end"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between px-0.5">
        <span className="text-[10px] text-neutral-400">{label}</span>
        <span
          className="font-mono text-[9px] tracking-tight text-neutral-600"
          title="cubic-bezier control points"
        >
          {bezierText}
        </span>
      </div>
    </div>
  );
}
