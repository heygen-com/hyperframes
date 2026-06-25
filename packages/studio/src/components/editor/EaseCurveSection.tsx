import { useCallback, useRef, useState } from "react";
import { EASE_CURVES, EASE_LABELS, parseCustomEaseFromString } from "./gsapAnimationConstants";
import { roundToCenti } from "../../utils/rounding";

const PRESET_GRID_EASES = [
  "ae-ease",
  "ae-ease-in",
  "ae-ease-out",
  "none",
  "power2.out",
  "power2.in",
  "back.out",
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
  const curve: [number, number, number, number] | null =
    isCustom && customPoints
      ? [customPoints.x1, customPoints.y1, customPoints.x2, customPoints.y2]
      : (curveFromPreset ?? null);

  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const draggingRef = useRef<"p1" | "p2" | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number>(0);

  const play = useCallback(() => {
    const start = performance.now();
    const dur = 1000;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      setProgress(t);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setTimeout(() => setProgress(null), 400);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const active = draft ?? curve;
  if (!active) return null;
  const [x1, y1, x2, y2] = active;

  const w = 200;
  const h = 100;
  const pad = 14;
  const gw = w - pad * 2;
  const gh = h - pad * 2;

  const toSvg = (px: number, py: number) => ({
    x: pad + gw * px,
    y: h - pad - gh * py,
  });

  const curvePath = `M${pad},${h - pad} C${toSvg(x1, y1).x},${toSvg(x1, y1).y} ${toSvg(x2, y2).x},${toSvg(x2, y2).y} ${w - pad},${pad}`;

  let dotX = pad;
  let dotY = h - pad;
  if (progress !== null) {
    const t = progress;
    const mt = 1 - t;
    dotX = pad + gw * (mt * mt * mt * 0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t);
    dotY =
      h - pad - gh * (mt * mt * mt * 0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t);
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
    const sx = ((e.clientX - rect.left) / rect.width) * w;
    const sy = ((e.clientY - rect.top) / rect.height) * h;
    const px = Math.max(0, Math.min(1, (sx - pad) / gw));
    const py = Math.max(-1, Math.min(2, (h - pad - sy) / gh));
    const prev = draft ?? [x1, y1, x2, y2];
    const next: [number, number, number, number] =
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

  const p1 = toSvg(x1, y1);
  const p2 = toSvg(x2, y2);
  const start = toSvg(0, 0);
  const end = toSvg(1, 1);
  const label = isCustom ? "Custom curve" : (EASE_LABELS[ease] ?? ease);

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
        className="overflow-hidden rounded pt-[72px] -mt-[72px]"
        style={{ aspectRatio: `${w}/${h}` }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          style={{ overflow: "visible" }}
          className="touch-none select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <line
            x1={pad}
            y1={h - pad}
            x2={w - pad}
            y2={h - pad}
            stroke="white"
            strokeOpacity="0.06"
            strokeWidth="0.5"
          />
          <line
            x1={pad}
            y1={pad}
            x2={pad}
            y2={h - pad}
            stroke="white"
            strokeOpacity="0.06"
            strokeWidth="0.5"
          />
          <line
            x1={start.x}
            y1={start.y}
            x2={p1.x}
            y2={p1.y}
            stroke="rgba(52,211,153,0.25)"
            strokeWidth="1"
          />
          <line
            x1={end.x}
            y1={end.y}
            x2={p2.x}
            y2={p2.y}
            stroke="rgba(45,212,191,0.25)"
            strokeWidth="1"
          />
          <path d={curvePath} fill="none" stroke="#3CE6AC" strokeWidth="2" strokeLinecap="round" />
          {progress !== null && <circle cx={dotX} cy={dotY} r="4" fill="#3CE6AC" />}
          <circle
            cx={p1.x}
            cy={p1.y}
            r="5"
            fill="#0a0a1a"
            stroke="#3CE6AC"
            strokeWidth="2"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => handlePointerDown("p1", e)}
          />
          <circle
            cx={p2.x}
            cy={p2.y}
            r="5"
            fill="#0a0a1a"
            stroke="#3CE6AC"
            strokeWidth="2"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => handlePointerDown("p2", e)}
          />
          {duration != null && duration > 0 && (
            <>
              <text x={pad} y={h - 1} textAnchor="start" className="fill-neutral-600 text-[8px]">
                0s
              </text>
              <text
                x={pad + gw / 2}
                y={h - 1}
                textAnchor="middle"
                className="fill-neutral-600 text-[8px]"
              >
                {(duration / 2).toFixed(1)}s
              </text>
              <text x={w - pad} y={h - 1} textAnchor="end" className="fill-neutral-600 text-[8px]">
                {duration}s
              </text>
            </>
          )}
        </svg>
      </div>
      <p className="mt-1 text-center text-[10px] text-neutral-500">{label}</p>
    </div>
  );
}
