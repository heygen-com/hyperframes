import { type ReactNode } from "react";
import { RotateCcw } from "../../icons/SystemIcons";
import { CommitField } from "./propertyPanelPrimitives";
import {
  VALUE_TIER_LABEL_CLASS,
  VALUE_TIER_VALUE_CLASS,
  type PropertyValueTier,
} from "./propertyPanelValueTier";

/* ------------------------------------------------------------------ */
/*  FlatRow — single-column label/value property row                   */
/* ------------------------------------------------------------------ */

export function FlatRow({
  label,
  value,
  tier,
  disabled,
  liveCommit,
  suffix,
  dropdown,
  onCommit,
  onReset,
}: {
  label: string;
  value: string;
  tier: PropertyValueTier;
  disabled?: boolean;
  liveCommit?: boolean;
  suffix?: ReactNode;
  /** Renders a trailing 10px caret-down, for select-backed rows. */
  dropdown?: boolean;
  onCommit: (nextValue: string) => void;
  onReset?: () => void;
}) {
  return (
    <div className="group flex min-h-[30px] items-center justify-between gap-3">
      <span className={`text-[11px] ${VALUE_TIER_LABEL_CLASS[tier]}`}>{label}</span>
      <span className="flex min-w-0 flex-shrink-0 items-center gap-1.5">
        <span
          data-flat-row-value="true"
          className={`min-w-0 border-b pb-px font-mono text-[11px] ${VALUE_TIER_VALUE_CLASS[tier]} ${
            tier === "explicitCustom"
              ? "border-transparent group-hover:border-panel-accent/35"
              : "border-transparent group-hover:border-panel-border-input"
          }`}
        >
          <CommitField
            value={value}
            disabled={disabled}
            liveCommit={liveCommit}
            onCommit={onCommit}
          />
        </span>
        {suffix}
        {tier === "explicitCustom" && onReset && (
          <button
            type="button"
            data-flat-row-reset="true"
            title="Remove — fall back to default"
            onClick={onReset}
            className="flex-shrink-0 text-panel-text-3 opacity-0 transition-opacity hover:text-panel-text-1 group-hover:opacity-100"
          >
            <RotateCcw size={11} />
          </button>
        )}
        {dropdown && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className="flex-shrink-0 text-panel-text-5"
          >
            <path d="M2 3l3 4 3-4z" />
          </svg>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlatSegmentedRow — inline glyph runs, no container background      */
/* ------------------------------------------------------------------ */

export interface FlatSegmentOption {
  key: string;
  node: ReactNode;
  active: boolean;
}

export function FlatSegmentedRow({
  label,
  options,
  disabled,
  /** Index (0-based) after which to render a 12px spacer — for combined rows
   *  like Text's "Case · Style", which pack two independent option groups. */
  spacerAfterIndex,
  onChange,
}: {
  label: string;
  options: FlatSegmentOption[];
  disabled?: boolean;
  spacerAfterIndex?: number;
  onChange: (nextKey: string) => void;
}) {
  return (
    <div className="flex min-h-[32px] items-center justify-between">
      <span className="text-[11px] text-panel-text-3">{label}</span>
      <span className="flex items-center gap-0.5">
        {options.map((option, index) => (
          <span key={option.key} className="flex items-center">
            <button
              type="button"
              data-flat-segment="true"
              disabled={disabled}
              onClick={() => onChange(option.key)}
              className={`px-1.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed ${
                option.active
                  ? "border-b-2 border-panel-accent text-panel-text-0"
                  : "border-b-2 border-transparent text-panel-text-4 hover:text-panel-text-2"
              }`}
            >
              {option.node}
            </button>
            {spacerAfterIndex === index && <span className="w-3" aria-hidden="true" />}
          </span>
        ))}
      </span>
    </div>
  );
}
