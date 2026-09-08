/* ------------------------------------------------------------------ */
/*  FlatToggle — the flat inspector's boolean row                      */
/*  (split out of propertyPanelFlatPrimitives.tsx to stay under the    */
/*  600-line file-size gate)                                            */
/* ------------------------------------------------------------------ */

import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { Toggle } from "../ui";

export function FlatToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const track = useTrackDesignInput();
  return (
    <div className="flex min-h-[30px] items-center justify-between">
      <span
        data-flat-toggle-label="true"
        className={`text-step-11 ${checked ? "text-text-2" : "text-text-3"}`}
      >
        {label}
      </span>
      <Toggle
        label={label}
        checked={checked}
        disabled={disabled}
        onCommit={onChange}
        onTrack={() => track("toggle", label)}
      />
    </div>
  );
}
