import { parseSpringBounce } from "@hyperframes/core/spring-ease";
import {
  parseWiggleEase,
  type WiggleEaseConfig,
  type WiggleType,
} from "@hyperframes/core/wiggle-ease";
import { roundToCenti } from "../../utils/rounding";
import { MiniCurveSvg } from "./easeCurveSvg";

type Pts = [number, number, number, number];

const round2 = roundToCenti;
const WIGGLE_TYPES = ["easeOut", "easeInOut", "anticipate", "uniform"] as const;
const WIGGLE_DEFAULT_AMPLITUDE = {
  easeOut: 0.16,
  easeInOut: 0.08,
  anticipate: 0.12,
  uniform: 0.14,
} satisfies Record<WiggleType, number>;

function isWiggleType(value: string): value is WiggleType {
  return WIGGLE_TYPES.some((type) => type === value);
}

function commitWiggle(
  onCommit: (ease: string) => void,
  count: number,
  type: WiggleType,
  amplitude: number,
): void {
  const ease = `wiggle(${count},${type},${roundToCenti(amplitude)})`;
  if (parseWiggleEase(ease)) onCommit(ease);
}

// Editable cubic-bezier control points, Figma-style ("0.33, 0, 0, 1"). Commits
// on Enter/blur; remounts (via key) when the tuple changes from a drag or preset
// pick so the text always mirrors the live curve.
export function EaseBezierField({
  tuple,
  onCommit,
}: {
  tuple: Pts;
  onCommit: (ease: string) => void;
}) {
  const text = tuple.join(", ");
  const commit = (raw: string) => {
    const nums = raw
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value));
    if (nums.length !== 4) return;
    const [x1, y1, x2, y2] = nums as [number, number, number, number];
    onCommit(`custom(M0,0 C${round2(x1)},${round2(y1)} ${round2(x2)},${round2(y2)} 1,1)`);
  };
  return (
    <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
      <MiniCurveSvg
        ease={`custom(M0,0 C${tuple[0]},${tuple[1]} ${tuple[2]},${tuple[3]} 1,1)`}
        active
        size={14}
      />
      <input
        key={text}
        type="text"
        defaultValue={text}
        aria-label="Cubic bezier control points"
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        className="w-full rounded border border-white/10 bg-black/20 px-1.5 py-1 font-mono text-[10px] text-neutral-300 outline-none focus:border-panel-accent/50"
      />
    </div>
  );
}

export function SpringBounceField({
  springBounce,
  onCommit,
}: {
  springBounce: number;
  onCommit: (ease: string) => void;
}) {
  return (
    <label className="mt-1.5 flex items-center gap-2 px-0.5 text-[10px] text-neutral-400">
      Bounce
      <input
        type="number"
        aria-label="Spring bounce"
        min="0"
        max="1"
        step="0.01"
        value={springBounce}
        onInput={(event) => {
          if (event.currentTarget.value === "") return;
          const value = Number(event.currentTarget.value);
          if (!Number.isFinite(value)) return;
          const bounce = parseSpringBounce(`spring(${value})`);
          if (bounce !== null) onCommit(`spring(${round2(bounce)})`);
        }}
        className="w-16 rounded border border-white/10 bg-black/20 px-1.5 py-1 font-mono text-[10px] text-neutral-300 outline-none focus:border-panel-accent/50"
      />
    </label>
  );
}

export function WiggleField({
  config,
  onCommit,
}: {
  config: WiggleEaseConfig;
  onCommit: (ease: string) => void;
}) {
  const amplitude = config.amplitude ?? WIGGLE_DEFAULT_AMPLITUDE[config.type];
  return (
    <div className="mt-1.5 flex items-center gap-2 px-0.5 text-[10px] text-neutral-400">
      <label className="flex items-center gap-1">
        Count
        <input
          type="number"
          aria-label="Wiggle count"
          min="1"
          step="1"
          value={config.wiggles}
          onInput={(event) => {
            if (event.currentTarget.value === "") return;
            commitWiggle(onCommit, Number(event.currentTarget.value), config.type, amplitude);
          }}
          className="w-14 rounded border border-white/10 bg-black/20 px-1.5 py-1 font-mono text-[10px] text-neutral-300 outline-none focus:border-panel-accent/50"
        />
      </label>
      <label className="flex items-center gap-1">
        Type
        <select
          aria-label="Wiggle type"
          value={config.type}
          onChange={(event) => {
            if (isWiggleType(event.currentTarget.value)) {
              commitWiggle(onCommit, config.wiggles, event.currentTarget.value, amplitude);
            }
          }}
          className="rounded border border-white/10 bg-black/20 px-1.5 py-1 text-[10px] text-neutral-300 outline-none focus:border-panel-accent/50"
        >
          {WIGGLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        Amplitude
        <input
          type="number"
          aria-label="Wiggle amplitude"
          min="0"
          max="1"
          step="0.01"
          value={amplitude}
          onInput={(event) => {
            if (event.currentTarget.value === "") return;
            commitWiggle(onCommit, config.wiggles, config.type, Number(event.currentTarget.value));
          }}
          className="w-16 rounded border border-white/10 bg-black/20 px-1.5 py-1 font-mono text-[10px] text-neutral-300 outline-none focus:border-panel-accent/50"
        />
      </label>
    </div>
  );
}
