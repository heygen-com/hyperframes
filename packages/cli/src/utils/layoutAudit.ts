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
  | "container_overflow";

export interface LayoutIssue {
  code: LayoutIssueCode;
  severity: "error" | "warning";
  time: number;
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

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issueCount: issues.length,
  };
}

export function formatLayoutIssue(issue: LayoutIssue): string {
  const parts = [
    `t=${formatNumber(issue.time)}s`,
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

function uniqueSortedTimes(times: number[]): number[] {
  const rounded = times.map(roundTime);
  return [...new Set(rounded)].sort((a, b) => a - b);
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
