import { useState, useRef, useEffect, type ReactNode } from "react";
import { Zap } from "../../icons/SystemIcons";

export const FIELD =
  "min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-neutral-600";
export const LABEL = "text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500";
export const RESPONSIVE_GRID = "grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-3";

export function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function clampMotionNumber(
  value: number | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function parsePlainNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

// ── CommitField ──

export function CommitField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commitDraft = () => {
    focusedRef.current = false;
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className="w-full min-w-0 bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
    />
  );
}

// ── DetailField ──

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
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <CommitField value={value} disabled={disabled} onCommit={onCommit} />
      </div>
    </label>
  );
}

// ── SegmentedControl ──

export function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-neutral-800 bg-neutral-950 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-9 rounded-xl text-[11px] font-semibold transition-colors ${
            option.value === value
              ? "bg-neutral-800 text-white shadow-sm"
              : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ── SelectField ──

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

// ── MotionSection ──

export function MotionSection({
  title,
  children,
  accessory,
}: {
  title: string;
  children: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <section className="border-b border-neutral-800 px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Zap size={15} className="text-neutral-500" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-300">
            {title}
          </h3>
        </div>
        {accessory}
      </div>
      {children}
    </section>
  );
}
