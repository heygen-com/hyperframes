import type { AgentJob, AgentTargetRef } from "./agentGlyphs";

/**
 * OverlayState — what the selection chrome shows while an agent works on that
 * element, so the canvas answers "is anything happening to this?" without
 * anyone opening the run tray.
 *
 * Two sources fill it. Studio contributes only what it knows as fact: the run
 * is queued, working, done or failed. Everything finer — reading, thinking, an
 * edit and what the edit is about — the agent declares by emitting one
 * `hf:overlay {…}` line, which the server parses onto `job.overlay`. A declared
 * state always wins, and nothing here guesses one from a harness' tool names.
 */

/**
 * The vocabulary. Studio only ever derives the four it owns as fact — `queued`
 * and `working` from its own queue, `done` and `failed` from the process exit.
 * `reading`, `thinking` and `editing` (and every scope) exist for the agent to
 * declare: reading tool names to guess between them would be a list that rots
 * every time a harness renames a tool, and a wrong guess is worse than a
 * truthful "working".
 */
export const OVERLAY_KINDS = [
  "queued",
  "working",
  "reading",
  "thinking",
  "editing",
  /** Stopped on a question, and going nowhere until the user answers it. */
  "asking",
  "done",
  "failed",
] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export const OVERLAY_SCOPES = ["text", "box", "motion", "content"] as const;
export type OverlayScope = (typeof OVERLAY_SCOPES)[number];

export interface OverlayState {
  kind: OverlayKind;
  scope?: OverlayScope;
  label?: string;
  accent?: string;
  /** Another element, when the state is not about the run's own target. */
  target?: { selector?: string; id?: string };
}

/** What the renderer needs: the state, and when it stops being true. */
export interface OverlayPaint {
  state: OverlayState;
  /** Epoch ms after which this must be repainted (a finished run fading out). */
  expiresAt?: number;
}

/** How long a finished run keeps saying so on the canvas. */
export const OVERLAY_TERMINAL_MS = 4000;

/** How Studio decides two references are the same element. */
export interface OverlayTargetable {
  selector?: string | null;
  sourceFile?: string | null;
  id?: string | null;
  selectorIndex?: number | null;
}

function sameFile(a?: string | null, b?: string | null): boolean {
  return (a ?? "") === (b ?? "");
}

/**
 * Whether a recorded reference points at this element.
 *
 * A DOM id is unique within a document, so it settles the question on its own.
 * Without one, the pair (selector, index) is the identity — the index matters:
 * a composition with twelve `.card`s would otherwise light all twelve up for a
 * run about the third.
 */
export function refMatchesSelection(
  ref: AgentTargetRef | undefined,
  selection: OverlayTargetable | null,
): boolean {
  if (!ref || !selection) return false;
  if (ref.id && selection.id)
    return ref.id === selection.id && sameFile(ref.sourceFile, selection.sourceFile);
  if (!ref.selector || !selection.selector) return false;
  if (!sameFile(ref.sourceFile, selection.sourceFile)) return false;
  if (ref.selector !== selection.selector) return false;
  // An absent index means "the only one", which is index 0 to the DOM walker.
  return (ref.selectorIndex ?? 0) === (selection.selectorIndex ?? 0);
}

/** The element a run is about: its own target, or any element it also covers. */
export function jobTargetsSelection(job: AgentJob, selection: OverlayTargetable | null): boolean {
  if (refMatchesSelection(job.targetRef, selection)) return true;
  return (job.targetRefs ?? []).some((ref) => refMatchesSelection(ref, selection));
}

/**
 * The answer to show beside an element, out of every run this project has.
 *
 * Only the newest finished run about that element is ever a candidate. Walking
 * further back is what makes bubbles stale: dismissing the answer to the run
 * you just watched would resurface the one before it, and the canvas would tell
 * you about an edit two edits ago. A run still in flight also suppresses it —
 * whatever the last one said is about to be superseded.
 *
 * `since` is when this tab started listening. Run history is restored from disk
 * on load, so without it every reload would pop bubbles for yesterday's runs.
 */
export function answerForSelection(
  jobs: AgentJob[],
  selection: OverlayTargetable | null,
  { since, isDismissed }: { since: number; isDismissed: (jobId: string) => boolean },
): AgentJob | null {
  if (!selection) return null;
  const mine = jobs.filter((job) => jobTargetsSelection(job, selection));
  if (
    mine.some(
      (job) => job.status !== "done" && job.status !== "failed" && job.status !== "cancelled",
    )
  )
    return null;

  // Jobs arrive newest-first, so the first settled one is the latest word.
  const latest = mine.find((job) => job.status === "done" || job.status === "failed");
  if (!latest?.message) return null;
  if ((latest.endedAt ?? 0) < since) return null;
  return isDismissed(latest.id) ? null : latest;
}

/**
 * Where a run's state belongs on the canvas.
 *
 * Normally that is the element the run targets. A declaration can name another
 * one — how an agent says "I am reading the heading to rewrite the caption" —
 * and then it redirects the paint entirely rather than showing in both places.
 */
export function jobPaintsSelection(job: AgentJob, selection: OverlayTargetable | null): boolean {
  const declared = job.overlay?.target;
  if (declared?.id || declared?.selector) {
    if (declared.id && selection?.id) return declared.id === selection.id;
    return Boolean(declared.selector) && declared.selector === selection?.selector;
  }
  return jobTargetsSelection(job, selection);
}

function ordinal(position: number): string {
  const rest = position % 100;
  if (rest >= 11 && rest <= 13) return `${position}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[position % 10] ?? "th";
  return `${position}${suffix}`;
}

/**
 * What this run should paint right now, or null when it should paint nothing.
 *
 * `queuePosition` is 1-based within the waiting queue; without it a waiting run
 * just says it is queued rather than inventing a place in line.
 */
export function deriveOverlayState(
  job: AgentJob,
  { queuePosition, now = Date.now() }: { queuePosition?: number; now?: number } = {},
): OverlayPaint | null {
  // The agent's own declaration wins over anything inferred from the stream,
  // for as long as the run is live. A finished process cannot still be editing.
  // A question the user has to answer outranks whatever the agent last said it
  // was doing: the run is not doing that any more, it is waiting.
  if (job.overlay && (job.status === "running" || job.status === "queued")) {
    return { state: job.overlay };
  }

  if (job.status === "queued") {
    return {
      state: {
        kind: "queued",
        label: queuePosition ? `${ordinal(queuePosition)} in line` : "Queued",
      },
    };
  }

  // A run that stopped to ask says so on the element itself, not only in the
  // tray: the person looking at the canvas is the one being waited on, and a
  // run silently parked reads as a run that has hung.
  if (job.status === "awaiting-permission") {
    return { state: { kind: "asking", label: job.permission?.tool ?? "Needs you" } };
  }

  // A live run with nothing declared: it is working, and the harness' own
  // activity line is the only honest label for what it is working on.
  if (job.status === "running") {
    return { state: { kind: "working", label: job.activity.trim() || "Working" } };
  }

  // A finished run says so for a beat, then hands the canvas back. A run with
  // no end time cannot be timed out of the way, so it never takes the canvas.
  if (!job.endedAt) return null;
  const expiresAt = job.endedAt + OVERLAY_TERMINAL_MS;
  if (now >= expiresAt) return null;
  if (job.status === "done") return { state: { kind: "done", label: "Done" }, expiresAt };
  if (job.status === "failed" || job.status === "cancelled") {
    return {
      state: { kind: "failed", label: job.status === "cancelled" ? "Stopped" : "Failed" },
      expiresAt,
    };
  }
  return null;
}

/**
 * The state to paint on the element in front of the user, out of every run this
 * project has. Active runs win over finished ones, and the newest active run
 * wins over an older one — an element being edited twice shows the live edit.
 */
export function overlayPaintForSelection(
  jobs: AgentJob[],
  selection: OverlayTargetable | null,
  now = Date.now(),
): OverlayPaint | null {
  const mine = jobs.filter((job) => jobPaintsSelection(job, selection));
  if (mine.length === 0) return null;

  // Jobs arrive newest-first; the queue runs oldest-first, so place in line is
  // read off the reverse.
  const queue = jobs.filter((job) => job.status === "queued").reverse();
  // What is happening beats what is waiting. Queueing more work behind a live
  // run must not replace "Edit · index.html" with "2nd in line" — the badge is
  // about the element, and what the element is having done to it right now is
  // the run in flight. Queue depth is the tray's job to report.
  // Being waited on beats working, which beats waiting in line: the one state
  // the user can do something about is the one worth showing them.
  const job =
    mine.find((entry) => entry.status === "awaiting-permission") ??
    mine.find((entry) => entry.status === "running") ??
    mine.find((entry) => entry.status === "queued") ??
    mine[0];
  if (!job) return null;

  const queuePosition = queue.indexOf(job) + 1;
  return deriveOverlayState(job, { queuePosition: queuePosition || undefined, now });
}
