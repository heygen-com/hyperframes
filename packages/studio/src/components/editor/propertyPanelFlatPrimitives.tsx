import { useEffect, useRef, useState, type ReactNode } from "react";
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
/*  FlatGroupHeader — one-open-at-a-time accordion group header        */
/*  (fixed-headers + scrollable-open-section layout, design_handoff    */
/*  scrollable-open-section): renders ONLY the header bar — collapsed  */
/*  button, or open-state title bar with the collapse control. Never   */
/*  positioned (no sticky, no stacking offsets) — it always sits in    */
/*  normal document flow. The open group's body content is rendered by */
/*  PropertyPanelFlat.tsx directly, in a dedicated scrollable region,   */
/*  not as children here.                                               */
/* ------------------------------------------------------------------ */

export function FlatGroupHeader({
  title,
  isOpen,
  onToggleOpen,
  accessory,
  summary,
  animateEntrance,
}: {
  title: string;
  isOpen: boolean;
  onToggleOpen: () => void;
  accessory?: ReactNode;
  summary?: string;
  /** Play the fast entrance animation on this render — set only for the one
   *  group(s) actually transitioning (see PropertyPanelFlat's justToggledIds).
   *  Not derived from `isOpen`/remounting alone: React's key-based diffing
   *  can still shift an unrelated collapsed sibling's position in the
   *  before/after-open arrays (e.g. when the newly opened group isn't
   *  adjacent to the previously open one), and Chromium restarts a CSS
   *  entrance animation on such a position change even though nothing about
   *  that sibling actually changed — gating explicitly avoids that replay. */
  animateEntrance?: boolean;
}) {
  if (!isOpen) {
    return (
      <button
        type="button"
        data-flat-group-collapsed="true"
        onClick={onToggleOpen}
        className={`${animateEntrance ? "hf-flat-group-enter " : ""}flex min-h-10 w-full flex-shrink-0 items-center justify-between gap-2 border-b border-panel-hairline bg-panel-bg px-4 text-left`}
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
    <div
      className={`${animateEntrance ? "hf-flat-group-enter " : ""}flex min-h-10 flex-shrink-0 items-center justify-between bg-panel-bg px-4`}
    >
      <span className="text-[12px] font-semibold text-panel-text-0">{title}</span>
      <span className="flex items-center gap-2.5 text-panel-text-5">
        {accessory}
        <button type="button" onClick={onToggleOpen} title="Collapse" className="text-panel-text-3">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2 4l4 4 4-4z" />
          </svg>
        </button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlatSlider — full-width label/track/value row                      */
/* ------------------------------------------------------------------ */

/** Keyboard target for a slider keydown, or null for keys we don't handle. */
function sliderKeyTarget(
  key: string,
  current: number,
  min: number,
  max: number,
  step: number,
): number | null {
  if (key === "Home") return min;
  if (key === "End") return max;
  const deltas: Record<string, number> = {
    ArrowLeft: -step,
    ArrowDown: -step,
    ArrowRight: step,
    ArrowUp: step,
    PageDown: -step * 10,
    PageUp: step * 10,
  };
  const delta = deltas[key];
  if (delta === undefined) return null;
  return Math.max(min, Math.min(max, current + delta));
}

export function FlatSlider({
  label,
  value,
  min,
  max,
  step = 1,
  tier,
  displayValue,
  disabled,
  centerTick,
  onReset,
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
  centerTick?: boolean;
  onReset?: () => void;
  onCommit: (nextValue: number) => void;
}) {
  // `draft` gives the knob instant, drag-local visual feedback. `onCommit` is
  // throttled (not debounced) to at most once per 40ms: a real drag fires
  // pointermove faster than that, and a pure debounce (reset the timer on
  // every move) never commits until the pointer pauses or lifts — which kills
  // live preview updates during a continuous drag. Throttling still fires on
  // the leading edge and on a trailing timer, so the preview keeps updating
  // while dragging, with an immediate flush on release for the final value.
  const [draft, setDraft] = useState(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitAtRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  // True from pointerdown to pointerup/cancel. While dragging, the committed
  // prop echoing back through the parent must NOT reset `draft` — the echo is
  // up to 40ms stale (throttled commit), and syncing it mid-drag snaps the
  // knob backwards under the user's pointer.
  const draggingRef = useRef(false);
  // Tracks the last value actually sent to onCommit — separate from `value`
  // (the committed prop) because in a single pointerdown+pointerup click the
  // leading-edge commit fires before the parent has re-rendered with the new
  // prop, so the release flush must dedupe against what we just sent, not
  // against the stale prop, or the same value commits twice.
  const lastCommittedRef = useRef(value);

  useEffect(() => {
    if (draggingRef.current) return;
    setDraft(value);
    lastCommittedRef.current = value;
  }, [value]);
  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const clampedPct = Math.max(0, Math.min(100, ((draft - min) / Math.max(max - min, 1e-6)) * 100));

  const stepFromClientX = (clientX: number, rect: DOMRect) => {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  };
  const commitDraft = (nextDraft: number) => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    pendingRef.current = null;
    lastCommitAtRef.current = Date.now();
    if (nextDraft !== lastCommittedRef.current) {
      lastCommittedRef.current = nextDraft;
      onCommit(nextDraft);
    }
  };
  const scheduleCommit = (nextDraft: number) => {
    const elapsed = Date.now() - lastCommitAtRef.current;
    if (elapsed >= 40) {
      commitDraft(nextDraft);
      return;
    }
    pendingRef.current = nextDraft;
    if (!commitTimerRef.current) {
      commitTimerRef.current = setTimeout(() => {
        commitTimerRef.current = null;
        if (pendingRef.current !== null) commitDraft(pendingRef.current);
      }, 40 - elapsed);
    }
  };

  return (
    <div className="flex min-h-[28px] items-center gap-2.5">
      <span className="w-[86px] flex-shrink-0 text-[11px] text-panel-text-3">{label}</span>
      <div
        data-flat-slider-track="true"
        role="slider"
        aria-label={label}
        aria-valuenow={draft}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={`relative h-5 flex-1 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        onPointerDown={(e) => {
          if (disabled) return;
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const stepped = stepFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
          setDraft(stepped);
          scheduleCommit(stepped);
        }}
        onPointerMove={(e) => {
          if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const stepped = stepFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
          setDraft(stepped);
          scheduleCommit(stepped);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          if (disabled) return;
          if (!draggingRef.current) return;
          draggingRef.current = false;
          // Recompute from the event itself rather than reading the `draft`
          // closure — if pointerdown+pointerup land in the same React batch
          // (e.g. a very fast click), the onPointerUp handler can still be
          // bound to the pre-drag render, making `draft` stale.
          const stepped = stepFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
          setDraft(stepped);
          commitDraft(stepped);
        }}
        onPointerCancel={(e) => {
          draggingRef.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const next = sliderKeyTarget(e.key, draft, min, max, step);
          if (next === null) return;
          e.preventDefault();
          setDraft(next);
          commitDraft(next);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-panel-hover">
          {centerTick && (
            <div
              data-flat-slider-center-tick="true"
              className="absolute left-1/2 top-[-1px] h-1 w-px -translate-x-1/2 bg-panel-text-5"
            />
          )}
          {tier === "explicitCustom" && (
            <div
              data-flat-slider-fill="true"
              className="absolute inset-y-0 left-0 rounded-full bg-panel-text-5"
              style={{ width: `${clampedPct}%` }}
            />
          )}
        </div>
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
      {(centerTick || onReset) && (
        <span data-flat-slider-reset-slot="true" className="w-3.5 flex-shrink-0">
          {tier === "explicitCustom" && onReset && (
            <button
              type="button"
              data-flat-slider-reset="true"
              title="Remove — fall back to default"
              onClick={onReset}
              className="text-panel-text-3 hover:text-panel-text-1"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </span>
      )}
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
  options: Array<string | { value: string; label: string }>;
  tier: PropertyValueTier;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
  onReset?: () => void;
}) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
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
            {normalizedOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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
