export interface LayoutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type LayoutOverflow = Partial<Record<"left" | "right" | "top" | "bottom", number>>;

export type LayoutIssueCode =
  | "text_box_overflow"
  | "clipped_text"
  | "canvas_overflow"
  | "container_overflow"
  | "content_overlap";

export type LayoutIssueSeverity = "error" | "warning" | "info";

export interface LayoutIssue {
  code: LayoutIssueCode;
  severity: LayoutIssueSeverity;
  time: number;
  firstSeen?: number;
  lastSeen?: number;
  occurrences?: number;
  selector: string;
  containerSelector?: string;
  text?: string;
  message: string;
  rect: LayoutRect;
  containerRect?: LayoutRect;
  overflow?: LayoutOverflow;
  fixHint?: string;
}

export interface LayoutSummary {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issueCount: number;
}

export interface LayoutSampleOptions {
  duration: number;
  samples: number;
  at?: number[];
}

export function buildLayoutSampleTimes({ duration, samples, at }: LayoutSampleOptions): number[] {
  if (at?.length) {
    return uniqueSortedTimes(
      at.filter(
        (time) => Number.isFinite(time) && time >= 0 && (duration <= 0 || time <= duration),
      ),
    );
  }

  if (!Number.isFinite(duration) || duration <= 0 || samples <= 0) return [];

  const count = Math.max(1, Math.floor(samples));
  return Array.from({ length: count }, (_, index) => roundTime(((index + 0.5) / count) * duration));
}

export function computeOverflow(
  subject: LayoutRect,
  container: LayoutRect,
  tolerance: number,
): LayoutOverflow | null {
  const overflow: LayoutOverflow = {};

  if (subject.left < container.left - tolerance) {
    overflow.left = roundPx(container.left - subject.left);
  }
  if (subject.right > container.right + tolerance) {
    overflow.right = roundPx(subject.right - container.right);
  }
  if (subject.top < container.top - tolerance) {
    overflow.top = roundPx(container.top - subject.top);
  }
  if (subject.bottom > container.bottom + tolerance) {
    overflow.bottom = roundPx(subject.bottom - container.bottom);
  }

  return Object.keys(overflow).length > 0 ? overflow : null;
}

export function summarizeLayoutIssues(issues: LayoutIssue[]): LayoutSummary {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const infoCount = issues.filter((issue) => issue.severity === "info").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issueCount: issues.length,
  };
}

export function formatLayoutIssue(issue: LayoutIssue): string {
  const timeLabel =
    issue.occurrences && issue.occurrences > 1
      ? `t=${formatNumber(issue.firstSeen ?? issue.time)}-${formatNumber(issue.lastSeen ?? issue.time)}s (${issue.occurrences} samples)`
      : `t=${formatNumber(issue.time)}s`;
  const parts = [
    timeLabel,
    issue.code,
    issue.selector,
    issue.containerSelector ? `inside ${issue.containerSelector}` : "",
    issue.overflow ? `overflowed ${formatOverflow(issue.overflow)}` : "",
    issue.text ? quoteText(issue.text) : "",
  ].filter(Boolean);

  const line = `${parts.join(" ")} — ${issue.message}`;
  return issue.fixHint ? `${line}\n    Fix: ${issue.fixHint}` : line;
}

export function dedupeLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  const seen = new Set<string>();
  const result: LayoutIssue[] = [];

  for (const issue of issues) {
    const key = [
      issue.code,
      issue.severity,
      issue.time.toFixed(3),
      issue.selector,
      issue.containerSelector ?? "",
      issue.text ?? "",
      issue.overflow ? formatOverflow(issue.overflow) : "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }

  return result;
}

export function collapseStaticLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  const groups = new Map<
    string,
    {
      issue: LayoutIssue;
      firstSeen: number;
      lastSeen: number;
      occurrences: number;
    }
  >();

  for (const issue of issues) {
    const key = staticIssueKey(issue);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        issue,
        firstSeen: issue.time,
        lastSeen: issue.time,
        occurrences: 1,
      });
      continue;
    }

    existing.firstSeen = Math.min(existing.firstSeen, issue.time);
    existing.lastSeen = Math.max(existing.lastSeen, issue.time);
    existing.occurrences += 1;
  }

  return [...groups.values()].map(({ issue, firstSeen, lastSeen, occurrences }) => ({
    ...issue,
    time: firstSeen,
    firstSeen,
    lastSeen,
    occurrences,
  }));
}

export function limitLayoutIssues(
  issues: LayoutIssue[],
  maxIssues: number,
): { issues: LayoutIssue[]; totalIssueCount: number; truncated: boolean } {
  const limit = Math.max(1, Math.floor(maxIssues));
  const sortedIssues = [...issues].sort((a, b) => {
    const severityDelta = severityRank(a.severity) - severityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return a.time - b.time;
  });
  return {
    issues: sortedIssues.slice(0, limit),
    totalIssueCount: issues.length,
    truncated: issues.length > limit,
  };
}

function severityRank(severity: LayoutIssueSeverity): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function staticIssueKey(issue: LayoutIssue): string {
  return [
    issue.code,
    issue.severity,
    issue.selector,
    issue.containerSelector ?? "",
    issue.text ?? "",
    issue.overflow ? formatOverflow(issue.overflow) : "",
  ].join("|");
}

function uniqueSortedTimes(times: number[]): number[] {
  const rounded = times.map(roundTime);
  return [...new Set(rounded)].sort((a, b) => a - b);
}

export interface TransitionSampleOptions {
  duration: number;
  boundaries: number[];
  /** Optional hard limit on the returned sample count. No limit when absent. */
  cap?: number;
}

export interface TransitionSamples {
  times: number[];
  /** Sample times omitted because of `cap`. Always 0 when no cap is given. */
  dropped: number;
}

/**
 * Build sample times from tween start/end boundaries: the boundaries
 * themselves plus the midpoint of every segment between consecutive
 * boundaries. Boundary frames are where transient overlaps live (#1380), but
 * sampling exactly at a boundary can land on an element at opacity 0 — the
 * segment midpoints catch the window where both sides of a transition are
 * partially visible. Every collected boundary is sampled unless the caller
 * passes an explicit `cap`, in which case the result is an evenly-strided
 * subset and `dropped` reports how many sample times were omitted.
 */
export function buildTransitionSampleTimes({
  duration,
  boundaries,
  cap,
}: TransitionSampleOptions): TransitionSamples {
  if (!Number.isFinite(duration) || duration <= 0) return { times: [], dropped: 0 };
  const inRange = uniqueSortedTimes(
    boundaries.filter((time) => Number.isFinite(time) && time >= 0 && time <= duration),
  );
  const withMidpoints = [...inRange];
  for (let i = 0; i < inRange.length - 1; i++) {
    const current = inRange[i];
    const next = inRange[i + 1];
    if (current === undefined || next === undefined) continue;
    withMidpoints.push(roundTime((current + next) / 2));
  }
  const merged = uniqueSortedTimes(withMidpoints);
  if (cap === undefined || merged.length <= Math.max(2, cap)) {
    return { times: merged, dropped: 0 };
  }
  const limit = Math.max(2, cap);
  const strided: number[] = [];
  for (let i = 0; i < limit; i++) {
    const pick = merged[Math.floor((i * (merged.length - 1)) / (limit - 1))];
    if (pick !== undefined) strided.push(pick);
  }
  const times = uniqueSortedTimes(strided);
  return { times, dropped: merged.length - times.length };
}

/** Merge sample-time lists into one deduplicated ascending list. */
export function mergeSampleTimes(...lists: number[][]): number[] {
  return uniqueSortedTimes(lists.flat());
}

function formatOverflow(overflow: LayoutOverflow): string {
  return (["left", "right", "top", "bottom"] as const)
    .flatMap((side) => {
      const value = overflow[side];
      return value == null ? [] : `${side} ${formatNumber(value)}px`;
    })
    .join(", ");
}

function quoteText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const truncated = normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  return `"${truncated}"`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}
