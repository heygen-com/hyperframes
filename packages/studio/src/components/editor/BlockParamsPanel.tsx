import { memo, useState, useCallback } from "react";
import type { BlockParam } from "@hyperframes/core/registry";

interface BlockParamsPanelProps {
  blockName: string;
  blockTitle: string;
  params: BlockParam[];
  compositionPath: string;
  onClose: () => void;
}

export const BlockParamsPanel = memo(function BlockParamsPanel({
  blockTitle,
  params,
  compositionPath: _compositionPath,
  onClose,
}: BlockParamsPanelProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of params) {
      initial[p.key] = p.default;
    }
    return initial;
  });

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="text-[11px] font-semibold text-neutral-200 truncate">{blockTitle}</div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
          Parameters
        </div>
        {params.map((param) => (
          <ParamControl
            key={param.key}
            param={param}
            value={values[param.key] ?? param.default}
            onChange={(v) => handleChange(param.key, v)}
          />
        ))}
      </div>
    </div>
  );
});

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: BlockParam;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-neutral-400">{param.label}</label>

      {param.type === "color" && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-7 h-7 rounded border border-neutral-700 bg-transparent cursor-pointer"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] text-neutral-200 font-mono focus:outline-none focus:border-neutral-700"
          />
        </div>
      )}

      {param.type === "number" && (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1"
          />
          <span className="text-[10px] text-neutral-400 w-8 text-right tabular-nums">{value}</span>
        </div>
      )}

      {param.type === "text" && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] text-neutral-200 focus:outline-none focus:border-neutral-700"
        />
      )}

      {param.type === "select" && param.options && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] text-neutral-200 focus:outline-none focus:border-neutral-700"
        >
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
