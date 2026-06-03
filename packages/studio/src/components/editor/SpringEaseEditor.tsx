import { useState, useRef, useEffect, useCallback } from "react";
import { generateSpringEaseData, SPRING_PRESETS } from "@hyperframes/core/spring-ease";
import { LABEL } from "./MotionPanelFields";
import { RotateCcw } from "../../icons/SystemIcons";

interface SpringParams {
  mass: number;
  stiffness: number;
  damping: number;
}

const DEFAULT_SPRING: SpringParams = { mass: 1, stiffness: 180, damping: 12 };

const SLIDERS: {
  key: keyof SpringParams;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "mass", label: "Mass", min: 0.1, max: 5, step: 0.1 },
  { key: "stiffness", label: "Stiffness", min: 10, max: 500, step: 10 },
  { key: "damping", label: "Damping", min: 1, max: 50, step: 1 },
];

function springValue(mass: number, stiffness: number, damping: number, t: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    );
  }
  if (zeta === 1) {
    return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  }
  const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 + (s1 * Math.exp(s2 * t) - s2 * Math.exp(s1 * t)) / (s2 - s1);
}

function springSimDuration(mass: number, stiffness: number, damping: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) return Math.min(5 / (zeta * w0), 10);
  const decayRate = zeta * w0 - w0 * Math.sqrt(zeta * zeta - 1);
  return Math.min(4 / Math.max(decayRate, 0.01), 10);
}

function buildSpringPath(
  params: SpringParams,
  mapFn: (point: { x: number; y: number }) => { x: number; y: number },
): string {
  const steps = 64;
  const simDur = springSimDuration(params.mass, params.stiffness, params.damping);
  const commands: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const simT = t * simDur;
    const y = springValue(params.mass, params.stiffness, params.damping, simT);
    const mapped = mapFn({ x: t, y });
    commands.push(`${i === 0 ? "M" : "L"}${mapped.x.toFixed(2)},${mapped.y.toFixed(2)}`);
  }
  return commands.join(" ");
}

export function SpringEaseEditor({
  onCommit,
}: {
  onCommit: (easeId: string, easeData: string) => void;
}) {
  const [params, setParams] = useState<SpringParams>(DEFAULT_SPRING);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleCommit = useCallback(
    (next: SpringParams) => {
      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = setTimeout(() => {
        const data = generateSpringEaseData(next.mass, next.stiffness, next.damping);
        const id = `spring-m${next.mass}-k${next.stiffness}-d${next.damping}`;
        onCommit(id, data);
      }, 120);
    },
    [onCommit],
  );

  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
    };
  }, []);

  const updateParam = (key: keyof SpringParams, value: number) => {
    const next = { ...params, [key]: value };
    setParams(next);
    scheduleCommit(next);
  };

  const applyPreset = (preset: (typeof SPRING_PRESETS)[number]) => {
    const next: SpringParams = {
      mass: preset.mass,
      stiffness: preset.stiffness,
      damping: preset.damping,
    };
    setParams(next);
    const data = generateSpringEaseData(next.mass, next.stiffness, next.damping);
    onCommit(preset.name, data);
  };

  const reset = () => {
    setParams(DEFAULT_SPRING);
    const data = generateSpringEaseData(
      DEFAULT_SPRING.mass,
      DEFAULT_SPRING.stiffness,
      DEFAULT_SPRING.damping,
    );
    onCommit("spring-bouncy", data);
  };

  // SVG layout matching EaseCurveEditor proportions
  const width = 324;
  const height = 214;
  const plot = { left: 46, top: 24, width: 242, height: 146 };
  const yMin = -0.2;
  const yMax = 1.3;

  const mapPoint = (point: { x: number; y: number }) => ({
    x: plot.left + point.x * plot.width,
    y: plot.top + ((yMax - point.y) / (yMax - yMin)) * plot.height,
  });

  const curvePath = buildSpringPath(params, mapPoint);
  const start = mapPoint({ x: 0, y: 0 });
  const end = mapPoint({ x: 1, y: 1 });

  const activePreset = SPRING_PRESETS.find(
    (p) =>
      p.mass === params.mass && p.stiffness === params.stiffness && p.damping === params.damping,
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2">
        <div>
          <div className={LABEL}>Spring Ease</div>
          <div className="mt-1 font-mono text-[10px] text-neutral-500">
            {activePreset?.label ?? `m${params.mass} k${params.stiffness} d${params.damping}`}
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
        >
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      {/* Curve preview */}
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full select-none touch-none">
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
        <path d={curvePath} fill="none" stroke="#ffdd57" strokeWidth="4" strokeLinecap="round" />
        <circle cx={start.x} cy={start.y} r="5" fill="#ffdd57" />
        <circle cx={end.x} cy={end.y} r="5" fill="#ffdd57" />
      </svg>

      {/* Presets */}
      <div className="flex gap-1.5 border-t border-neutral-800 px-3 py-2">
        {SPRING_PRESETS.map((preset) => {
          const isActive =
            preset.mass === params.mass &&
            preset.stiffness === params.stiffness &&
            preset.damping === params.damping;
          return (
            <button
              key={preset.name}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`flex-1 rounded-lg px-1.5 py-1.5 text-[10px] font-semibold transition-colors ${
                isActive
                  ? "border border-yellow-400/40 bg-yellow-400/10 text-yellow-300"
                  : "border border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Sliders */}
      <div className="space-y-3 border-t border-neutral-800 px-3 py-3">
        {SLIDERS.map((slider) => (
          <div key={slider.key}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                {slider.label}
              </span>
              <span className="min-w-[36px] text-right font-mono text-[10px] text-neutral-400">
                {params[slider.key]}
              </span>
            </div>
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={params[slider.key]}
              onChange={(e) => updateParam(slider.key, Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-yellow-400 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-yellow-400"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
