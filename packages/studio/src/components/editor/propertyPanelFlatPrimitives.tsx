import { useEffect, useRef, type ReactNode } from "react";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { RotateCcw } from "../../icons/SystemIcons";
import { Slider } from "../ui";
import { CommitField } from "./propertyPanelPrimitives";
import {
  VALUE_TIER_LABEL_CLASS,
  VALUE_TIER_VALUE_CLASS,
  type PropertyValueTier,
} from "./propertyPanelValueTier";

export const FLAT_PREVIEW_GRID = "grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1";

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
  onPreview,
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
  onPreview?: (nextValue: string) => void;
  onCommit: (nextValue: string) => void | Promise<unknown>;
  onReset?: () => void;
}) {
  const track = useTrackDesignInput();
  return (
    <div className="group flex min-h-[30px] items-center justify-between gap-3">
      <span className={`text-step-11 ${VALUE_TIER_LABEL_CLASS[tier]}`}>{label}</span>
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        {/* The value's boundary is the field's own box now (R10), not an
            underline drawn around it: two edges around one control read as two
            controls. The tier still tints that box, so an explicitly set
            property is still the one wearing the accent. */}
        <CommitField
          value={value}
          disabled={disabled}
          liveCommit={liveCommit}
          align="right"
          className={`w-24 font-mono ${VALUE_TIER_VALUE_CLASS[tier]} ${
            tier === "explicitCustom" ? "border-accent/30 hover:border-accent/70" : ""
          }`}
          onPreview={onPreview}
          onCommit={(nextValue) => {
            track("metric", label);
            return onCommit(nextValue);
          }}
        />
        {suffix}
        {tier === "explicitCustom" && onReset && (
          <button
            type="button"
            data-flat-row-reset="true"
            title="Remove — fall back to default"
            onClick={() => {
              track("button", `Reset ${label}`);
              onReset();
            }}
            className="shrink-0 text-panel-text-3 opacity-0 transition-opacity hover:text-panel-text-1 group-hover:opacity-100"
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
            className="shrink-0 text-panel-text-5"
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
  /** Accessible name — the glyph alone (e.g. two indistinguishable "A"
   *  buttons for upright vs. italic) isn't a valid accessible name on its
   *  own. */
  label: string;
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
  const track = useTrackDesignInput();
  return (
    <div className="flex min-h-[32px] items-center justify-between">
      <span className="text-[11px] text-panel-text-3">{label}</span>
      <span className="flex items-center gap-0.5">
        {options.map((option, index) => (
          <span key={option.key} className="flex items-center">
            <button
              type="button"
              data-flat-segment="true"
              aria-label={option.label}
              aria-pressed={option.active}
              disabled={disabled}
              onClick={() => {
                if (!option.active) track("segmented", label);
                onChange(option.key);
              }}
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
        className={`${animateEntrance ? "hf-flat-group-enter " : ""}flex min-h-10 w-full shrink-0 items-center justify-between gap-2 border-b border-panel-hairline bg-panel-bg px-4 text-left`}
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
          className="shrink-0 text-panel-text-5"
        >
          <path d="M4 2l4 4-4 4z" />
        </svg>
      </button>
    );
  }

  return (
    <div
      className={`${animateEntrance ? "hf-flat-group-enter " : ""}flex min-h-10 shrink-0 items-center justify-between bg-panel-bg px-4`}
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

/** At most one durable write per this many ms while a drag is in flight. */
const COMMIT_INTERVAL_MS = 40;

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
  const track = useTrackDesignInput();
  // The shared Slider owns the thumb, the keyboard, the pointer capture and
  // the abort. What stays here is the write RATE, because this row has exactly
  // one channel: a caller's `onCommit` writes the style, and that write IS the
  // live canvas preview. So the continuous `onPreview` stream is throttled to
  // at most one write per COMMIT_INTERVAL_MS rather than dropped. A debounce
  // would be wrong: it never fires until the pointer pauses, which is exactly
  // when a preview is least wanted.
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitAtRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  // What was last handed to `onCommit`. Separate from the `value` prop: a
  // leading-edge write lands before the parent has re-rendered, so the release
  // flush has to dedupe against what was sent, not against the stale prop.
  const lastCommittedRef = useRef(value);
  // Always the current render's `onCommit`, read inside the throttle timer
  // instead of closed over at schedule time. A caller whose onCommit spreads
  // other current state (Grade's `...grading, details: {...}`) would otherwise
  // let a queued write fire a frame later with a stale snapshot and silently
  // revert whatever the user changed on another control in between.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);
  useEffect(
    () => () => {
      if (!commitTimerRef.current) return;
      clearTimeout(commitTimerRef.current);
      // Flush rather than drop a queued edit. This only runs if the row
      // unmounts mid-drag (the selection changes away), and discarding the
      // last dragged position would look like data loss.
      if (pendingRef.current !== null) onCommitRef.current(pendingRef.current);
    },
    [],
  );

  const commitNow = (next: number) => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    pendingRef.current = null;
    lastCommitAtRef.current = Date.now();
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onCommitRef.current(next);
  };
  const scheduleCommit = (next: number) => {
    const elapsed = Date.now() - lastCommitAtRef.current;
    if (elapsed >= COMMIT_INTERVAL_MS) {
      commitNow(next);
      return;
    }
    pendingRef.current = next;
    if (commitTimerRef.current) return;
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      if (pendingRef.current !== null) commitNow(pendingRef.current);
    }, COMMIT_INTERVAL_MS - elapsed);
  };

  return (
    <div className="flex min-h-[28px] items-center gap-2.5">
      <span className="w-[86px] shrink-0 text-step-11 text-text-3">{label}</span>
      <div className="relative flex min-w-0 flex-1 items-center">
        <Slider
          label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onPreview={scheduleCommit}
          onCommit={commitNow}
          onTrack={() => track("slider", label)}
          className="w-full"
        />
        {centerTick && (
          // After the slider so it paints over the track, and inert so it
          // cannot swallow a press aimed at the track under it.
          <div
            data-flat-slider-center-tick="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-px -translate-x-1/2 -translate-y-1/2 bg-text-5"
          />
        )}
      </div>
      <span
        data-flat-slider-value="true"
        className={`w-11 shrink-0 text-right font-mono text-step-10 ${
          tier === "explicitCustom" ? "text-text-0" : "text-text-3"
        }`}
      >
        {displayValue}
      </span>
      {(centerTick || onReset) && (
        <span data-flat-slider-reset-slot="true" className="w-3.5 shrink-0">
          {tier === "explicitCustom" && onReset && (
            <button
              type="button"
              data-flat-slider-reset="true"
              title="Remove — fall back to default"
              disabled={disabled}
              onClick={() => {
                track("button", `Reset ${label}`);
                onReset();
              }}
              className="text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export { FlatSelectRow } from "./propertyPanelFlatSelectRow";
