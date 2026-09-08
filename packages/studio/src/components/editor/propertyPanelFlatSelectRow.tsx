import { RotateCcw } from "../../icons/SystemIcons";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { Select } from "../ui";
import {
  VALUE_TIER_LABEL_CLASS,
  VALUE_TIER_VALUE_CLASS,
  type PropertyValueTier,
} from "./propertyPanelValueTier";

/* ------------------------------------------------------------------ */
/*  FlatSelectRow — label/value row backed by the shared Select        */
/* ------------------------------------------------------------------ */

export function FlatSelectRow({
  label,
  ariaLabel,
  value,
  options,
  tier,
  disabled,
  onChange,
  onReset,
}: {
  label: string;
  /** Accessible name when a caller renders the visible label OUTSIDE this
   *  row (label="" to avoid a duplicate) — e.g. Grade's "Preset" row, which
   *  shows its own label span and would otherwise leave the trigger
   *  unnamed. Falls back to `label` when omitted. */
  ariaLabel?: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  tier: PropertyValueTier;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
  onReset?: () => void;
}) {
  const track = useTrackDesignInput();
  const trackName = ariaLabel || label;
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  // A valid authored value outside the preset list (e.g. a `mix-blend-mode`
  // or `object-position` this row doesn't offer as a preset) must not be
  // silently dropped: a select whose value matches no item has nothing to
  // display, and choosing any preset would then overwrite the real persisted
  // value with something the user never saw. Prepend the current value so it
  // is always representable, matching legacy `SelectField`'s same guard.
  const renderedOptions =
    value && !normalizedOptions.some((option) => option.value === value)
      ? [{ value, label: value }, ...normalizedOptions]
      : normalizedOptions;
  return (
    <div className="group flex min-h-[30px] items-center justify-between gap-3">
      <span className={`text-step-11 ${VALUE_TIER_LABEL_CLASS[tier]}`}>{label}</span>
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        {/* Same box as the row's CommitField sibling (R10): the field's own
            boundary is what says "this is editable", and the tier tints it.
            Width floors at the metric field's 96px so a row of short values
            stays a column, and ceilings before a long option ("900 · Black",
            "color-burn") can push the label off the row. */}
        <Select
          label={trackName}
          value={value}
          options={renderedOptions}
          disabled={disabled}
          className={`w-auto min-w-24 max-w-40 font-mono ${VALUE_TIER_VALUE_CLASS[tier]} ${
            tier === "explicitCustom" ? "border-accent/30 hover:border-accent/70" : ""
          }`}
          onCommit={onChange}
          onTrack={() => track("select", trackName)}
        />
        {tier === "explicitCustom" && onReset && (
          <button
            type="button"
            data-flat-select-reset="true"
            title="Remove — fall back to default"
            disabled={disabled}
            onClick={() => {
              track("button", `Reset ${trackName}`);
              onReset();
            }}
            className="shrink-0 text-text-3 opacity-0 transition-opacity hover:text-text-1 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </span>
    </div>
  );
}
