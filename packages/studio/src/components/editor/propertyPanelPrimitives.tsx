import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DesignPanelInputProvider,
  useTrackDesignInput,
} from "../../contexts/DesignPanelInputContext";
import { Select, Slider, Tab, Tabs, TabsList } from "../ui";
import { LABEL } from "./propertyPanelHelpers";
import { CommitField } from "./propertyPanelCommitField";

export { CommitField } from "./propertyPanelCommitField";

/* ------------------------------------------------------------------ */
/*  MetricField                                                        */
/* ------------------------------------------------------------------ */

export function MetricField({
  label,
  value,
  disabled,
  liveCommit,
  scrub,
  suffix,
  tooltip,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  liveCommit?: boolean;
  scrub?: boolean;
  suffix?: string;
  tooltip?: string;
  onCommit: (nextValue: string) => void | Promise<unknown>;
}) {
  const track = useTrackDesignInput();
  const scrubRef = useRef<{ startX: number; startValue: number; pointerId: number } | null>(null);
  const commit = useCallback(
    (nextValue: string) => {
      if (nextValue !== value) track("metric", label);
      return onCommit(nextValue);
    },
    [label, onCommit, track, value],
  );

  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (disabled || !scrub) return;
      const parsed = parseFloat(value);
      if (!Number.isFinite(parsed)) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      scrubRef.current = { startX: e.clientX, startValue: parsed, pointerId: e.pointerId };
    },
    [disabled, scrub, value],
  );

  const handleScrubPointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const state = scrubRef.current;
      if (!state) return;
      const delta = e.clientX - state.startX;
      commit(String(Math.round(state.startValue + delta)));
    },
    [commit],
  );

  const handleScrubPointerUp = useCallback(() => {
    scrubRef.current = null;
  }, []);

  const scrubProps =
    scrub && !disabled
      ? ({
          className: "shrink-0 text-step-11 font-medium text-text-4 cursor-ew-resize select-none",
          onPointerDown: handleScrubPointerDown,
          onPointerMove: handleScrubPointerMove,
          onPointerUp: handleScrubPointerUp,
          onPointerCancel: handleScrubPointerUp,
          onLostPointerCapture: handleScrubPointerUp,
        } as const)
      : ({ className: "shrink-0 text-step-11 font-medium text-text-4" } as const);

  // The label sits outside the box, not inside it: R10 asks for a boundary that
  // differs from the label, and the old shared box put both behind one edge.
  return (
    <div className="flex min-w-0 items-center gap-3" title={tooltip}>
      <span {...scrubProps}>{label}</span>
      <CommitField value={value} disabled={disabled} liveCommit={liveCommit} onCommit={commit} />
      {suffix && <span className="shrink-0 text-step-10 text-text-4">{suffix}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Simple field components                                            */
/* ------------------------------------------------------------------ */

export function DetailField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const commit = (nextValue: string) => {
    if (nextValue !== value) track("text", label);
    onCommit(nextValue);
  };
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <CommitField value={value} disabled={disabled} onCommit={commit} />
    </label>
  );
}

export function SliderControl({
  trackName,
  value,
  min,
  max,
  step,
  displayValue,
  formatDisplayValue,
  disabled,
  onCommit,
}: {
  trackName: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  formatDisplayValue?: (nextValue: number) => string;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
}) {
  const track = useTrackDesignInput();
  // Only the readout needs the in-flight value; the shared Slider owns the
  // thumb's own draft, so this is a display mirror rather than a second
  // source of truth for the control.
  const [preview, setPreview] = useState(value);

  useEffect(() => {
    setPreview(value);
  }, [value]);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <Slider
        label={trackName}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onPreview={setPreview}
        onCommit={onCommit}
        onTrack={() => track("slider", trackName)}
      />
      <div className="min-w-[44px] rounded-md bg-input px-2 py-1.5 text-right text-step-11 font-medium text-text-1 tabular-nums">
        {formatDisplayValue?.(preview) ?? displayValue}
      </div>
    </div>
  );
}

export function SegmentedControl({
  trackName,
  options,
  value,
  disabled,
  onChange,
}: {
  trackName: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  // Real tabs, so the strip answers arrow keys, Home and End (KTD7). The
  // buttons this replaces carried `aria-pressed` and no keyboard handling at
  // all, so the only way through them was Tab, one segment at a time.
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const chosen = String(next);
        if (chosen !== value) track("segmented", trackName);
        onChange(chosen);
      }}
    >
      <TabsList
        aria-label={trackName}
        className="grid min-w-0 gap-[2px] rounded-md bg-input p-[2px]"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <Tab
            key={option.value}
            value={option.value}
            disabled={disabled}
            className="min-w-0 truncate px-2 font-medium"
          >
            {option.label}
          </Tab>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function SelectField({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  options: string[];
  onChange: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  // An authored value the caller does not offer as a preset stays representable
  // rather than silently reading back as the first option.
  const renderedOptions = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="shrink-0 text-step-11 font-medium text-text-4">{label}</span>
      <Select
        label={label}
        value={value}
        options={renderedOptions.map((option) => ({ label: option, value: option }))}
        disabled={disabled}
        onCommit={onChange}
        onTrack={() => track("select", label)}
      />
    </div>
  );
}

export function Section({
  title,
  icon: _icon,
  children,
  accessory,
  defaultCollapsed = false,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  accessory?: ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const collapseIcon = (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      // `duration-expand` is the panel expand and collapse token, and it zeroes
      // itself under `prefers-reduced-motion` (R14), which the hard-coded 150ms
      // it replaces could not.
      className={`shrink-0 text-text-5 transition-transform ease-standard duration-expand ${
        collapsed ? "-rotate-90" : ""
      }`}
    >
      <path d="M2 3l3 4 3-4z" />
    </svg>
  );

  const section = slugifyPanelSectionTitle(title);
  return (
    <DesignPanelInputProvider section={section}>
      <section className="min-w-0 border-t border-border" data-panel-section={section}>
        <div className="flex w-full items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          >
            <h3 className="text-step-12 font-semibold text-text-1">{title}</h3>
            {collapseIcon}
          </button>
          {accessory && <div className="flex shrink-0 items-center">{accessory}</div>}
        </div>
        {!collapsed && <div className="px-4 pb-3">{children}</div>}
      </section>
    </DesignPanelInputProvider>
  );
}

// Stable hook for e2e/automation to locate a section without depending on the
// display copy (h3 textContent matching breaks on wording tweaks or, if this
// panel is ever localized, on translation).
function slugifyPanelSectionTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
