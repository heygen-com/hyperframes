/**
 * Controls for one effect, generated from its registry entry.
 *
 * Nothing here knows what a compressor is. The registry declares each
 * parameter's range, step, unit and scale, and this renders whatever it finds —
 * so adding an effect or a knob upstream needs no change in the panel, and the
 * panel cannot offer a value the renderer would reject.
 */

import { useCallback } from "react";
import type {
  HfAudioFxDef,
  HfAudioFxNumberParam,
  HfAudioFxParam,
  HfAudioFxParamValues,
} from "@hyperframes/core/audio-fx";

/**
 * Frequency and time controls span three or four decades, so a linear slider
 * spends most of its travel somewhere useless. Those declare `scale: "log"` and
 * the slider position maps exponentially instead.
 */
function toSlider(p: HfAudioFxNumberParam, value: number): number {
  if (p.scale !== "log" || p.min <= 0) return value;
  const t = (Math.log(value) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min));
  return p.min + t * (p.max - p.min);
}

function fromSlider(p: HfAudioFxNumberParam, position: number): number {
  if (p.scale !== "log" || p.min <= 0) return position;
  const t = (position - p.min) / (p.max - p.min);
  return Math.exp(Math.log(p.min) + t * (Math.log(p.max) - Math.log(p.min)));
}

/** Enough precision to be honest without showing float noise. */
function display(p: HfAudioFxNumberParam, value: number): string {
  const decimals = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}

interface ParamRowProps {
  param: HfAudioFxParam;
  value: number | string;
  onChange(key: string, value: number | string): void;
  disabled?: boolean;
}

export function FxParamRow({ param, value, onChange, disabled }: ParamRowProps) {
  const handleNumber = useCallback(
    (raw: number) => {
      const p = param as HfAudioFxNumberParam;
      onChange(param.key, Math.min(p.max, Math.max(p.min, raw)));
    },
    [param, onChange],
  );

  if (param.kind === "enum") {
    return (
      <label className="hf-fx-row flex min-h-6 items-center gap-2" title={param.hint}>
        <span className="hf-fx-label w-[86px] flex-shrink-0 truncate text-[10px] text-panel-text-4">
          {param.label}
        </span>
        <select
          className="hf-fx-select min-w-0 flex-1 rounded-[3px] bg-panel-surface px-1 py-0.5 font-mono text-[10px] text-panel-text-0"
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(param.key, e.target.value)}
        >
          {param.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const numeric = typeof value === "number" ? value : Number(value);
  const current = Number.isFinite(numeric) ? numeric : param.default;

  return (
    <label className="hf-fx-row flex min-h-6 items-center gap-2" title={param.hint}>
      <span className="hf-fx-label w-[86px] flex-shrink-0 truncate text-[10px] text-panel-text-4">
        {param.label}
      </span>
      <input
        className="hf-fx-slider h-1 min-w-0 flex-1 accent-panel-accent"
        type="range"
        min={param.min}
        max={param.max}
        step={(param.max - param.min) / 1000}
        value={toSlider(param, current)}
        disabled={disabled}
        aria-label={param.label}
        onChange={(e) => handleNumber(fromSlider(param, Number(e.target.value)))}
      />
      <input
        className="hf-fx-number w-[54px] flex-shrink-0 rounded-[3px] bg-panel-surface px-1 py-0.5 text-right font-mono text-[10px] text-panel-text-0"
        type="number"
        min={param.min}
        max={param.max}
        step={param.step}
        value={display(param, current)}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) handleNumber(next);
        }}
      />
      {param.unit ? (
        <span className="hf-fx-unit w-[22px] flex-shrink-0 font-mono text-[9px] text-panel-text-4">
          {param.unit}
        </span>
      ) : null}
    </label>
  );
}

interface FxParamsProps {
  def: HfAudioFxDef;
  params: HfAudioFxParamValues;
  onChange(params: HfAudioFxParamValues): void;
  disabled?: boolean;
}

/** Every knob the effect declares, in registry order. */
export function FxParams({ def, params, onChange, disabled }: FxParamsProps) {
  const set = useCallback(
    (key: string, value: number | string) => onChange({ ...params, [key]: value }),
    [params, onChange],
  );
  return (
    <div className="hf-fx-params space-y-0.5 border-t border-panel-border-input px-1.5 py-1.5">
      {def.params.map((p) => (
        <FxParamRow
          key={p.key}
          param={p}
          value={params[p.key] ?? p.default}
          onChange={set}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export const __testables = { toSlider, fromSlider, display };
