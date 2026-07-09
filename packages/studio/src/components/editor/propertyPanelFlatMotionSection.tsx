import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./domEditing";
import { formatTimingValue, RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { parseTimingValue } from "./propertyPanelTimingSection";
import { CommitField } from "./propertyPanelPrimitives";

function deriveTimingFromAnimations(
  animations: GsapAnimation[],
): { start: number; duration: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of animations) {
    const s = a.resolvedStart ?? (typeof a.position === "number" ? a.position : 0);
    const d = a.duration ?? 0;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s + d);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return { start: lo, duration: hi - lo };
}

export function FlatTimingRow({
  element,
  animations = [],
  onSetAttribute,
}: {
  element: DomEditSelection;
  animations?: GsapAnimation[];
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
}) {
  const explicitStart = Number.parseFloat(element.dataAttributes.start ?? "0") || 0;
  const explicitDuration =
    Number.parseFloat(
      element.dataAttributes.duration ?? element.dataAttributes["hf-authored-duration"] ?? "0",
    ) || 0;

  const derived = explicitDuration > 0 ? null : deriveTimingFromAnimations(animations);
  const start = derived ? derived.start : explicitStart;
  const duration = derived ? derived.duration : explicitDuration;
  const end = start + duration;

  const commitStart = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null) return;
    void onSetAttribute("start", parsed.toFixed(2));
  };

  const commitDuration = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    void onSetAttribute("duration", parsed.toFixed(2));
  };

  const commitEnd = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= start) return;
    void onSetAttribute("duration", (parsed - start).toFixed(2));
  };

  const cell = (label: string, value: string, onCommit: (next: string) => void) => (
    <div className="grid gap-px">
      <span className="text-[9px] text-panel-text-4">{label}</span>
      <span className="border-b border-transparent font-mono text-[11px] text-panel-text-0 hover:border-panel-border-input">
        <CommitField value={value} onCommit={onCommit} />
      </span>
    </div>
  );

  return (
    <div className={RESPONSIVE_GRID}>
      {cell("Start", formatTimingValue(start), commitStart)}
      {cell("End", formatTimingValue(end), commitEnd)}
      {cell("Duration", formatTimingValue(duration), commitDuration)}
      {derived && (
        <p className="col-span-3 mt-1 text-[10px] leading-snug text-panel-text-3">
          Inferred from this element's animation — edit to pin an explicit clip range.
        </p>
      )}
    </div>
  );
}
