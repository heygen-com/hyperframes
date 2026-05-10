import { memo, useState, useCallback } from "react";
import type { BlockParam } from "./blockCatalog";

interface BlockParamsPanelProps {
  blockName: string;
  params: BlockParam[];
  onParamChange: (key: string, value: string) => void;
}

export const BlockParamsPanel = memo(function BlockParamsPanel({
  blockName,
  params,
  onParamChange,
}: BlockParamsPanelProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of params) initial[p.key] = p.default;
    return initial;
  });

  const handleChange = useCallback(
    (key: string, value: string) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      onParamChange(key, value);
    },
    [onParamChange],
  );

  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
        {blockName} Parameters
      </div>
      <div className="flex flex-col gap-2.5">
        {params.map((param) => (
          <div key={param.key} className="flex items-center gap-2">
            <label className="min-w-[60px] truncate text-[10px] text-neutral-500">
              {param.label}
            </label>
            {param.type === "color" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={values[param.key] || param.default}
                  onChange={(e) => handleChange(param.key, e.target.value)}
                  className="h-6 w-6 cursor-pointer rounded border border-neutral-700 bg-transparent"
                />
                <span className="font-mono text-[10px] text-neutral-500">{values[param.key]}</span>
              </div>
            )}
            {param.type === "number" && (
              <div className="flex flex-1 items-center gap-1.5">
                <input
                  type="range"
                  min={param.min ?? 0}
                  max={param.max ?? 100}
                  step={0.1}
                  value={values[param.key] || param.default}
                  onChange={(e) => handleChange(param.key, e.target.value)}
                  className="flex-1 accent-neutral-400"
                />
                <span className="w-8 text-right font-mono text-[10px] text-neutral-500">
                  {Number(values[param.key] || param.default).toFixed(1)}
                </span>
              </div>
            )}
            {param.type === "text" && (
              <input
                type="text"
                value={values[param.key] || param.default}
                onChange={(e) => handleChange(param.key, e.target.value)}
                className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-200 outline-none focus:border-neutral-600"
              />
            )}
            {param.type === "select" && (
              <select
                value={values[param.key] || param.default}
                onChange={(e) => handleChange(param.key, e.target.value)}
                className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-200 outline-none"
              >
                {param.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
