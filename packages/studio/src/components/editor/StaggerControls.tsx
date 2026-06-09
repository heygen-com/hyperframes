import { memo, useState } from "react";
import { MetricField } from "./propertyPanelPrimitives";

export type StaggerOrder = "dom" | "reverse" | "center" | "edges" | "random";

interface StaggerControlsProps {
  elementCount: number;
  onApplyStagger: (offsetMs: number, order: StaggerOrder) => void;
}

const ORDER_OPTIONS: StaggerOrder[] = ["dom", "reverse", "center", "edges", "random"];
const ORDER_LABELS: Record<StaggerOrder, string> = {
  dom: "DOM order",
  reverse: "Reverse",
  center: "Center out",
  edges: "Edges in",
  random: "Random",
};

export const StaggerControls = memo(function StaggerControls({
  elementCount,
  onApplyStagger,
}: StaggerControlsProps) {
  const [offsetMs, setOffsetMs] = useState(80);
  const [order, setOrder] = useState<StaggerOrder>("dom");

  if (elementCount < 2) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-2 py-1.5">
      <span className="text-[10px] font-medium text-neutral-500">Stagger</span>
      <MetricField
        label="Offset"
        value={String(offsetMs)}
        suffix="ms"
        onCommit={(raw) => {
          const v = Number.parseInt(raw, 10);
          if (Number.isFinite(v) && v >= 0) setOffsetMs(v);
        }}
      />
      <select
        value={order}
        onChange={(e) => setOrder(e.target.value as StaggerOrder)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[10px] text-neutral-200 outline-none"
      >
        {ORDER_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {ORDER_LABELS[o]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onApplyStagger(offsetMs, order)}
        className="rounded-md bg-panel-accent/10 px-2 py-1 text-[10px] font-semibold text-panel-accent transition-colors hover:bg-panel-accent/20"
      >
        Apply ({elementCount})
      </button>
    </div>
  );
});
