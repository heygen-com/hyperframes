import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCcw } from "../../icons/SystemIcons";
import {
  DesignPanelInputProvider,
  useTrackDesignInput,
} from "../../contexts/DesignPanelInputContext";
import { adjustNumericToken, FIELD, LABEL, parseNumericToken } from "./propertyPanelHelpers";

const INSPECTOR_COMMIT_DELAY_MS = 350;

export function FieldLabel({
  label,
  labelNode,
  disabled,
  onReset,
}: {
  label: string;
  labelNode?: ReactNode;
  disabled?: boolean;
  onReset?: () => void;
}) {
  return (
    <span className="group inline-flex min-w-0 items-center gap-1">
      {labelNode ?? <span className={LABEL}>{label}</span>}
      {onReset && (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Reset ${label}`}
          title={`Reset ${label} to authored value`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onReset();
          }}
          className="pointer-events-none inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-neutral-500 opacity-0 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 disabled:cursor-not-allowed"
        >
          <RotateCcw size={10} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export function useDebouncedCommit<T>({
  sourceValue,
  onPreview,
  onCommit,
  delayMs = INSPECTOR_COMMIT_DELAY_MS,
}: {
  sourceValue: T;
  onPreview: (nextValue: T) => void;
  onCommit: (nextValue: T) => void;
  delayMs?: number;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ value: T; commit: (nextValue: T) => void } | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) pending.commit(pending.value);
  }, []);

  useEffect(() => flush, [flush, onCommit, sourceValue]);

  const preview = useCallback(
    (nextValue: T) => {
      onPreview(nextValue);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (Object.is(nextValue, sourceValue)) {
        timerRef.current = null;
        pendingRef.current = null;
        return;
      }
      pendingRef.current = { value: nextValue, commit: onCommit };
      timerRef.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush, onCommit, onPreview, sourceValue],
  );

  const commit = useCallback(
    (nextValue: T) => {
      onPreview(nextValue);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      if (!Object.is(nextValue, sourceValue)) onCommit(nextValue);
    },
    [onCommit, onPreview, sourceValue],
  );

  return { preview, commit, flush };
}

export function CommitField({
  value,
  disabled,
  liveCommit,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  liveCommit?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const valueRef = useRef(value);
  const draftRef = useRef(draft);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);

  valueRef.current = value;
  draftRef.current = draft;

  const { preview: previewDraft, commit: commitDraft } = useDebouncedCommit({
    sourceValue: value,
    onPreview: setDraft,
    onCommit,
    delayMs: 120,
  });

  useEffect(() => {
    if (focusedRef.current && dirtyRef.current) return;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (disabled || document.activeElement !== el) return;
      const delta = e.deltaY === 0 ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      const nextDraft = adjustNumericToken(draftRef.current, delta < 0 ? 1 : -1, e);
      if (!nextDraft) return;
      e.preventDefault();
      e.stopPropagation();
      dirtyRef.current = true;
      setDraft(nextDraft);
      scheduleCommitRef.current(nextDraft);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [disabled]);

  const scheduleCommitRef = useRef(previewDraft);
  scheduleCommitRef.current = previewDraft;

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        dirtyRef.current = true;
        if (liveCommit) previewDraft(e.target.value);
        else setDraft(e.target.value);
      }}
      onBlur={() => {
        const wasDirty = dirtyRef.current;
        focusedRef.current = false;
        dirtyRef.current = false;
        if (wasDirty) commitDraft(draft);
        else setDraft(valueRef.current);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        const nextDraft = adjustNumericToken(draft, e.key === "ArrowUp" ? 1 : -1, e);
        if (!nextDraft) return;
        e.preventDefault();
        dirtyRef.current = true;
        previewDraft(nextDraft);
      }}
      title={parseNumericToken(value) ? "Scroll or use Arrow keys to adjust" : undefined}
      className="min-w-0 w-full bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
    />
  );
}

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
  onReset,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  liveCommit?: boolean;
  scrub?: boolean;
  suffix?: string;
  tooltip?: string;
  onReset?: () => void;
  onCommit: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const scrubRef = useRef<{ startX: number; startValue: number; pointerId: number } | null>(null);
  const commit = useCallback(
    (nextValue: string) => {
      if (nextValue !== value) track("metric", label);
      onCommit(nextValue);
    },
    [label, onCommit, track, value],
  );
  const [scrubDraft, setScrubDraft] = useState<{ value: string; source: string } | null>(null);
  const previewScrubDraft = useCallback(
    (nextValue: string) => setScrubDraft({ value: nextValue, source: value }),
    [value],
  );
  const { preview: previewScrub, flush: flushScrub } = useDebouncedCommit({
    sourceValue: value,
    onPreview: previewScrubDraft,
    onCommit: commit,
  });
  const displayedValue = scrubDraft?.source === value ? scrubDraft.value : value;

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
      previewScrub(String(Math.round(state.startValue + delta)));
    },
    [previewScrub],
  );

  const handleScrubPointerUp = useCallback(() => {
    scrubRef.current = null;
    flushScrub();
  }, [flushScrub]);

  const scrubProps =
    scrub && !disabled
      ? ({
          className:
            "flex-shrink-0 text-[11px] font-medium text-neutral-500 cursor-ew-resize select-none",
          onPointerDown: handleScrubPointerDown,
          onPointerMove: handleScrubPointerMove,
          onPointerUp: handleScrubPointerUp,
        } as const)
      : ({ className: "flex-shrink-0 text-[11px] font-medium text-neutral-500" } as const);

  return (
    <div className={FIELD} title={tooltip}>
      <div className="flex min-w-0 items-center gap-3">
        <FieldLabel
          label={label}
          disabled={disabled}
          onReset={onReset}
          labelNode={<span {...scrubProps}>{label}</span>}
        />
        <CommitField
          value={displayedValue}
          disabled={disabled}
          liveCommit={liveCommit}
          onCommit={commit}
        />
        {suffix && <span className="flex-shrink-0 text-[10px] text-neutral-600">{suffix}</span>}
      </div>
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
  onReset,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onReset?: () => void;
  onCommit: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const commit = (nextValue: string) => {
    if (nextValue !== value) track("text", label);
    onCommit(nextValue);
  };
  return (
    <label className="grid min-w-0 gap-1.5">
      <FieldLabel label={label} disabled={disabled} onReset={onReset} />
      <div className={FIELD}>
        <CommitField value={value} disabled={disabled} onCommit={commit} />
      </div>
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
  trackName?: string;
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
  const [draft, setDraft] = useState(value);
  const interactionChangedRef = useRef(false);
  const commitDraft = useCallback(
    (nextDraft: number) => {
      if (interactionChangedRef.current) {
        interactionChangedRef.current = false;
        if (trackName) track("slider", trackName);
      }
      onCommit(nextDraft);
    },
    [onCommit, track, trackName],
  );
  const { preview: previewDraft, flush } = useDebouncedCommit({
    sourceValue: value,
    onPreview: setDraft,
    onCommit: commitDraft,
  });

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          interactionChangedRef.current = true;
          previewDraft(n);
        }}
        onMouseUp={flush}
        onTouchEnd={flush}
        onBlur={flush}
        className="h-4 min-w-0 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-panel-border [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0C0C0E,0_1px_3px_rgba(0,0,0,0.5)] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb:active]:cursor-grabbing"
      />
      <div className="min-w-[44px] rounded-md bg-panel-input px-2 py-1.5 text-right text-[11px] font-medium text-panel-text-1 tabular-nums">
        {formatDisplayValue?.(draft) ?? displayValue}
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
  return (
    <div
      className="grid min-w-0 gap-[2px] rounded-md bg-panel-input p-[2px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) track("segmented", trackName);
            onChange(option.value);
          }}
          className={`min-w-0 truncate rounded px-2 py-[5px] text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
            option.value === value
              ? "bg-panel-hover text-white"
              : "text-panel-text-4 hover:text-panel-text-2"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SelectField({
  label,
  value,
  disabled,
  disableUnlistedValue,
  onReset,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  disableUnlistedValue?: boolean;
  onReset?: () => void;
  options: string[];
  onChange: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const hasUnlistedValue = Boolean(value && !options.includes(value));
  const renderedOptions = hasUnlistedValue ? [value, ...options] : options;
  return (
    <label className={`${FIELD} flex items-center gap-3`}>
      <FieldLabel
        label={label}
        disabled={disabled}
        onReset={onReset}
        labelNode={
          <span className="flex-shrink-0 text-[11px] font-medium text-neutral-500">{label}</span>
        }
      />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          track("select", label);
          onChange(e.target.value);
        }}
        className="min-w-0 w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
      >
        {renderedOptions.map((option) => (
          <option
            key={option}
            value={option}
            disabled={disableUnlistedValue && hasUnlistedValue && option === value}
          >
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({
  title,
  children,
  accessory,
  disabledReason,
  defaultCollapsed = false,
}: {
  title: string;
  children: ReactNode;
  accessory?: ReactNode;
  disabledReason?: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const collapseIcon = collapsed ? (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="flex-shrink-0 text-panel-text-5"
    >
      <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      className="flex-shrink-0 text-panel-text-5"
    >
      <path d="M2 3l3 4 3-4z" />
    </svg>
  );

  const section = slugifyPanelSectionTitle(title);
  return (
    <DesignPanelInputProvider section={section}>
      <section className="min-w-0 border-t border-panel-border" data-panel-section={section}>
        <div className="flex w-full items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          >
            <h3 className="text-[12px] font-semibold text-panel-text-1">{title}</h3>
            {collapseIcon}
          </button>
          {accessory && <div className="flex flex-shrink-0 items-center">{accessory}</div>}
        </div>
        {!collapsed && (
          <div className="px-4 pb-3">
            {disabledReason && (
              <p
                data-disabled-reason
                className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400"
              >
                {disabledReason}
              </p>
            )}
            {children}
          </div>
        )}
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
