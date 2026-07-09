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

/* ------------------------------------------------------------------ */
/*  FlatGroup — one-open-at-a-time accordion group (controlled)        */
/* ------------------------------------------------------------------ */

export function FlatGroup({
  title,
  isOpen,
  isPinned,
  onToggleOpen,
  onTogglePin,
  accessory,
  summary,
  children,
}: {
  title: string;
  isOpen: boolean;
  isPinned: boolean;
  onToggleOpen: () => void;
  onTogglePin: () => void;
  accessory?: ReactNode;
  summary?: string;
  children: ReactNode;
}) {
  if (!isOpen) {
    return (
      <button
        type="button"
        data-flat-group-collapsed="true"
        onClick={onToggleOpen}
        className="flex min-h-10 w-full items-center justify-between gap-2 border-b border-panel-hairline px-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[12px] font-medium text-panel-text-2">{title}</span>
          {summary && (
            <span className="min-w-0 truncate font-mono text-[9px] text-panel-text-4">
              {summary}
            </span>
          )}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          className="flex-shrink-0 text-panel-text-5"
        >
          <path d="M4 2l4 4-4 4z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="border-b border-panel-hairline px-4 py-3" data-flat-group-open="true">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-panel-text-0">{title}</span>
        <span className="flex items-center gap-2.5 text-panel-text-5">
          {accessory}
          <button
            type="button"
            data-flat-group-pin="true"
            title={isPinned ? "Unpin" : "Pin"}
            onClick={onTogglePin}
            className={isPinned ? "text-panel-accent" : "text-panel-text-5 hover:text-panel-text-3"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 1h4v3.2l1.4 1.4V7H7v4L6 12l-1-1V7H2.6V5.6L4 4.2z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            title="Collapse"
            className="text-panel-text-3"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 4l4 4 4-4z" />
            </svg>
          </button>
        </span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PinnedZoneDivider                                                   */
/* ------------------------------------------------------------------ */

export function PinnedZoneDivider() {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="h-px flex-1 bg-panel-hairline" aria-hidden="true" />
      <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-panel-text-5">
        one open below
      </span>
      <span className="h-px flex-1 bg-panel-hairline" aria-hidden="true" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlatSlider — full-width label/track/value row                      */
/* ------------------------------------------------------------------ */

export function FlatSlider({
  label,
  value,
  min,
  max,
  step = 1,
  tier,
  displayValue,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  tier: "default" | "explicitCustom";
  displayValue: string;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
}) {
  const clampedPct = Math.max(0, Math.min(100, ((value - min) / Math.max(max - min, 1e-6)) * 100));

  const commitFromClientX = (clientX: number, rect: DOMRect) => {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    onCommit(Math.max(min, Math.min(max, stepped)));
  };

  return (
    <div className="flex min-h-[28px] items-center gap-2.5">
      <span className="w-[86px] flex-shrink-0 text-[11px] text-panel-text-3">{label}</span>
      <div
        data-flat-slider-track="true"
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-disabled={disabled}
        className={`relative h-0.5 flex-1 rounded-full bg-panel-hover ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        onPointerDown={(e) => {
          if (disabled) return;
          commitFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
        }}
      >
        {tier === "explicitCustom" && (
          <div
            data-flat-slider-fill="true"
            className="absolute inset-y-0 left-0 rounded-full bg-panel-text-5"
            style={{ width: `${clampedPct}%` }}
          />
        )}
        <div
          data-flat-slider-knob="true"
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            tier === "explicitCustom" ? "h-2 w-2 bg-white" : "h-[7px] w-[7px] bg-panel-text-4"
          }`}
          style={{ left: `${clampedPct}%` }}
        />
      </div>
      <span
        data-flat-slider-value="true"
        className={`w-11 flex-shrink-0 text-right font-mono text-[10px] ${
          tier === "explicitCustom" ? "text-panel-text-0" : "text-panel-text-3"
        }`}
      >
        {displayValue}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlatSelectRow — label/value row backed by a native <select>        */
/* ------------------------------------------------------------------ */

export function FlatSelectRow({
  label,
  value,
  options,
  tier,
  disabled,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  options: string[];
  tier: PropertyValueTier;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
  onReset?: () => void;
}) {
  return (
    <div className="group flex min-h-[30px] items-center justify-between">
      <span className={`text-[11px] ${VALUE_TIER_LABEL_CLASS[tier]}`}>{label}</span>
      <span className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`appearance-none bg-transparent text-right font-mono text-[11px] outline-none disabled:cursor-not-allowed ${VALUE_TIER_VALUE_CLASS[tier]}`}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className="flex-shrink-0 text-panel-text-5"
          >
            <path d="M2 3l3 4 3-4z" />
          </svg>
        </label>
        {tier === "explicitCustom" && onReset && (
          <button
            type="button"
            data-flat-select-reset="true"
            title="Remove — fall back to default"
            onClick={onReset}
            className="flex-shrink-0 text-panel-text-3 opacity-0 transition-opacity hover:text-panel-text-1 group-hover:opacity-100"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlatToggle — 24×14 pill switch                                     */
/* ------------------------------------------------------------------ */

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
  return (
    <div className="flex min-h-[30px] items-center justify-between">
      <span
        data-flat-toggle-label="true"
        className={`text-[11px] ${checked ? "text-panel-text-2" : "text-panel-text-3"}`}
      >
        {label}
      </span>
      <button
        type="button"
        data-flat-toggle="true"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[14px] w-6 flex-shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-panel-accent/35" : "bg-panel-hover"
        }`}
      >
        <span
          data-flat-toggle-knob="true"
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
            checked ? "right-0.5 bg-panel-accent" : "left-0.5 bg-panel-text-4"
          }`}
        />
      </button>
    </div>
  );
}
