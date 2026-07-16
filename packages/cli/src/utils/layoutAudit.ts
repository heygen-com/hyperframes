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
  | "content_overlap"
  | "text_occluded"
  | "text_not_painted"
  | "caption_zone_collision"
  | "frame_out_of_frame"
  // Coordinate-frame findings — geometry computed in one frame, rendered in another.
  | "escaped_container"
  | "panel_out_of_canvas"
  | "connector_detached"
  // Frozen-sweep guard (#U10) — a whole-run meta-finding, not a per-sample
  // geometry observation; never persistence-tiered (see `applyPersistenceTier`).
  | "sweep_static"
  // Motion-verification findings (#1437) — evaluated against the seeked timeline.
  | "motion_appears_late"
  | "motion_out_of_order"
  | "motion_off_frame"
  | "motion_frozen"
  | "motion_selector_missing"
  | "motion_selector_ambiguous";

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
  /** `text_occluded` only: approximate fraction (0-1) of the occlusion probe
   * grid that hit an opaque occluder — see layout-audit.browser.js. */
  coveredFraction?: number;
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

/**
 * Whether a computed `overflow*` value clips its box. Mirrors the rule the
 * browser audit (layout-audit.browser.js) uses to decide that text spilling
 * past such an ancestor is intentionally masked (odometer/ticker reels) rather
 * than a `text_box_overflow` defect. Kept here as the one unit-testable seam of
 * that suppression: only `visible` (and the `clip visible` no-op) must NOT clip
 * — every clipping value must, or real masked overflow gets reported as a bug.
 */
export function overflowValueClips(value: string | null | undefined): boolean {
  return !!value && value !== "visible" && value !== "clip visible";
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
      framePositionKey(issue),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }

  return result;
}

// Persistence-tier thresholds (#U10, adapted from Adam Rosler's visual-linter
// design). The approach doc frames these as held-duration floors — ignore
// under ~250ms, re-promote content_overlap at >= ~500ms — measured against
// the SAME firstSeen/lastSeen span this collapse step already tracks. At the
// default 9-sample grid over a multi-second composition, a single collapsed
// occurrence is held 0ms (one entrance/exit transient sample) and two
// collapsed occurrences are already >= one sample-to-sample gap, which is
// well past 500ms — so "held under 250ms" reduces to `occurrences <= 1` and
// "held >= 500ms" reduces to `occurrences >= 2`. Tiering below is written in
// those sample-count terms (the mapping the approach doc asks to document),
// with the literal ms span (CONTENT_OVERLAP_HELD_ERROR_MS) kept as a fallback
// for callers whose samples really are spaced close enough together for the
// ms floor to matter on its own (dense `--at`/`--at-transitions` runs). The
// ~250ms ignore floor needs no separate constant — see the occurrences <= 1
// branch below.
const CONTENT_OVERLAP_HELD_ERROR_MS = 500;
const HELD_ACROSS_SAMPLES_MIN_OCCURRENCES = 2;

// Tiering only applies to layout-audit.browser.js's own per-sample seek-grid
// findings — the ones this collapse step's firstSeen/lastSeen span was built
// to describe. `caption_zone_collision`/`frame_out_of_frame` (a different
// script, U3) and the `motion_*`/`sweep_static` codes (evaluated once over
// the whole run, not per grid sample) already carry their own singular
// dedupe/severity semantics; re-interpreting their occurrence count as a
// held-duration signal would misread it.
const PERSISTENCE_TIERED_CODES: ReadonlySet<LayoutIssueCode> = new Set([
  "text_box_overflow",
  "clipped_text",
  "canvas_overflow",
  "container_overflow",
  "content_overlap",
  "text_occluded",
  "escaped_container",
  "panel_out_of_canvas",
  "connector_detached",
]);

export function collapseStaticLayoutIssues(
  issues: LayoutIssue[],
  totalSampleCount?: number,
): LayoutIssue[] {
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

  // A run that only ever sampled one point in time can't distinguish a
  // transient from a persistent finding — skip tiering entirely rather than
  // guess (see `applyPersistenceTier`).
  const sampleCount = totalSampleCount ?? new Set(issues.map((issue) => issue.time)).size;
  const multiSampleRun = sampleCount > 1;

  return [...groups.values()].map(({ issue, firstSeen, lastSeen, occurrences }) =>
    applyPersistenceTier(
      { ...issue, time: firstSeen, firstSeen, lastSeen, occurrences },
      multiSampleRun,
    ),
  );
}

/**
 * Held-duration severity tiering (#U10). A finding observed at only one
 * sample among several (held 0ms) is an entrance/exit transient, not a held
 * defect — demote to info so it stays in the data (verbose/--json output)
 * without gating the run. Two codes re-promote once held: `content_overlap`
 * warning->error when the collision is sustained rather than a crossfade blip
 * (resolves the TODO in layout-audit.browser.js's `overlapIssue`), and
 * `canvas_overflow` info->warning when the breach is held, canvas-scale
 * (>= 5% of the short edge) AND partially visible — a fully off-canvas rect
 * is a parked entrance, not drift. Codes without a promotion rule are left
 * untouched when held — persistence, not the code, decides their tier.
 */
function applyPersistenceTier(issue: LayoutIssue, multiSampleRun: boolean): LayoutIssue {
  if (!multiSampleRun) return issue;
  if (!PERSISTENCE_TIERED_CODES.has(issue.code)) return issue;

  const occurrences = issue.occurrences ?? 1;
  // A single collapsed occurrence is held 0ms by construction (firstSeen ===
  // lastSeen) — always under the ignore floor, so occurrences <= 1 is a
  // complete (not approximate) test for "held under 250ms".
  if (occurrences <= 1) {
    return { ...issue, severity: "info" };
  }
  if (issue.code === "content_overlap" && isContentOverlapHeldLongEnough(issue, occurrences)) {
    return { ...issue, severity: "error" };
  }
  if (issue.code === "canvas_overflow" && isCanvasBreachHeldLarge(issue, occurrences)) {
    return { ...issue, severity: "warning" };
  }
  return issue;
}

// A held, canvas-scale, PARTIALLY visible breach is drift; a fully off-canvas rect is a parked entrance.
function isCanvasBreachHeldLarge(issue: LayoutIssue, occurrences: number): boolean {
  if (
    occurrences < HELD_ACROSS_SAMPLES_MIN_OCCURRENCES ||
    !issue.overflow ||
    !issue.containerRect
  ) {
    return false;
  }
  const breach = Math.max(
    ...Object.values(issue.overflow).filter((value) => typeof value === "number"),
  );
  if (breach < Math.min(issue.containerRect.width, issue.containerRect.height) * 0.05) return false;
  const container = issue.containerRect;
  const overlapX =
    Math.min(issue.rect.right, container.right) - Math.max(issue.rect.left, container.left);
  const overlapY =
    Math.min(issue.rect.bottom, container.bottom) - Math.max(issue.rect.top, container.top);
  return overlapX > 0 && overlapY > 0;
}

// Split out of applyPersistenceTier so the two independent "held long enough"
// signals (sample count vs. wall-clock span) read as one boolean question
// instead of adding a third compound branch to the tiering ladder above.
function isContentOverlapHeldLongEnough(issue: LayoutIssue, occurrences: number): boolean {
  if (occurrences >= HELD_ACROSS_SAMPLES_MIN_OCCURRENCES) return true;
  const firstSeen = issue.firstSeen ?? issue.time;
  const lastSeen = issue.lastSeen ?? issue.time;
  const heldMs = (lastSeen - firstSeen) * 1000;
  return heldMs >= CONTENT_OVERLAP_HELD_ERROR_MS;
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
    framePositionKey(issue),
  ].join("|");
}

function framePositionKey(issue: LayoutIssue): string {
  // connector_detached shares it: id-less paths collapse to one selector, so distinct lines need geometry in the key.
  return issue.code === "frame_out_of_frame" || issue.code === "connector_detached"
    ? `${Math.round(issue.rect.left)},${Math.round(issue.rect.top)}`
    : "";
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
