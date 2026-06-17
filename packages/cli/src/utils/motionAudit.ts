import type { LayoutIssue, LayoutRect } from "./layoutAudit.js";
import type { MotionAssertion } from "./motionSpec.js";

/** Opacity at/above which an element counts as "appeared" (RFC: opacity ≥ threshold). */
const APPEAR_OPACITY = 0.5;
/** Pixels an element may exceed the canvas edge before it counts as off-frame. */
const FRAME_TOLERANCE = 1;
/** Default longest allowed fully-static window for keepsMoving, in seconds. */
const DEFAULT_MAX_STATIC_SEC = 2;

export interface FrameSample {
  rect: LayoutRect;
  opacity: number;
  visible: boolean;
}

/** One seeked frame of the dense motion grid. */
export interface MotionFrame {
  time: number;
  /** Per asserted selector: its sample this frame, or null when it matched nothing. */
  data: Record<string, FrameSample | null>;
  /** Liveness signature per scope ("*" = whole canvas; otherwise a withinSelector). */
  liveness: Record<string, string>;
}

export interface Canvas {
  width: number;
  height: number;
}

const ZERO_RECT: LayoutRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

export function ambiguousIssue(selector: string): LayoutIssue {
  return {
    code: "motion_selector_ambiguous",
    severity: "error",
    time: 0,
    selector,
    message: `${selector} matches multiple elements — use a more specific selector so the assertion targets exactly one`,
    rect: ZERO_RECT,
    fixHint:
      "Use #id or :nth-child() instead of a class selector when multiple elements share the same class.",
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function everMatched(frames: MotionFrame[], selector: string): boolean {
  return frames.some((frame) => frame.data[selector] != null);
}

/** First frame where the selector is visible at/above the appear threshold. */
function firstAppear(
  frames: MotionFrame[],
  selector: string,
): { time: number; rect: LayoutRect } | null {
  for (const frame of frames) {
    const sample = frame.data[selector];
    if (sample && sample.visible && sample.opacity >= APPEAR_OPACITY) {
      return { time: frame.time, rect: sample.rect };
    }
  }
  return null;
}

function missingIssue(selector: string, time: number): LayoutIssue {
  return {
    code: "motion_selector_missing",
    severity: "error",
    time,
    selector,
    message: `${selector} matched no element in any sampled frame — check the selector`,
    rect: ZERO_RECT,
    fixHint: "Verify the selector exists in the composition and is spelled correctly.",
  };
}

function appearsBy(frames: MotionFrame[], selector: string, bySec: number): LayoutIssue[] {
  if (!everMatched(frames, selector)) return [missingIssue(selector, 0)];
  const appear = firstAppear(frames, selector);
  if (appear && appear.time <= bySec) return [];
  return [
    {
      code: "motion_appears_late",
      severity: "error",
      time: appear ? appear.time : bySec,
      selector,
      message: appear
        ? `appears at ${round(appear.time)}s but should be visible by ${round(bySec)}s (check its entrance reveal fires under seek)`
        : `never reaches visible opacity but should be visible by ${round(bySec)}s (check its entrance reveal fires under seek)`,
      rect: appear ? appear.rect : ZERO_RECT,
      fixHint:
        "The renderer seeks a paused timeline; a forward-only reveal can be skipped. Ensure the entrance is applied at this time, not only played through.",
    },
  ];
}

function before(frames: MotionFrame[], a: string, b: string): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (!everMatched(frames, a)) issues.push(missingIssue(a, 0));
  if (!everMatched(frames, b)) issues.push(missingIssue(b, 0));
  if (issues.length > 0) return issues;

  const appearA = firstAppear(frames, a);
  const appearB = firstAppear(frames, b);
  const timeA = appearA ? appearA.time : Number.POSITIVE_INFINITY;
  const timeB = appearB ? appearB.time : Number.POSITIVE_INFINITY;
  if (timeA < timeB) return [];

  const label = (t: number) => (Number.isFinite(t) ? `${round(t)}s` : "never");
  return [
    {
      code: "motion_out_of_order",
      severity: "error",
      time: Number.isFinite(timeA) ? timeA : 0,
      selector: a,
      message: `${a} should appear before ${b}, but ${a} appears at ${label(timeA)} and ${b} at ${label(timeB)} — reorder the entrances`,
      rect: appearA ? appearA.rect : ZERO_RECT,
      fixHint: `Make ${a}'s entrance land before ${b}'s on the timeline.`,
    },
  ];
}

function isOffFrame(r: LayoutRect, canvas: Canvas): boolean {
  return (
    r.left < -FRAME_TOLERANCE ||
    r.top < -FRAME_TOLERANCE ||
    r.right > canvas.width + FRAME_TOLERANCE ||
    r.bottom > canvas.height + FRAME_TOLERANCE
  );
}

// Note: off-frame check uses sample.visible (opacity ≥ 0.2 from the browser sampler);
// the first-appear anchor uses APPEAR_OPACITY (0.5). Elements fading in between those
// thresholds are tracked for position but don't start the window — intentional.
function staysInFrame(frames: MotionFrame[], selector: string, canvas: Canvas): LayoutIssue[] {
  if (!everMatched(frames, selector)) return [missingIssue(selector, 0)];
  const appear = firstAppear(frames, selector);
  if (!appear) return [];

  for (const frame of frames) {
    const sample = frame.data[selector];
    if (frame.time < appear.time || !sample || !sample.visible) continue;
    if (!isOffFrame(sample.rect, canvas)) continue;
    const r = sample.rect;
    return [
      {
        code: "motion_off_frame",
        severity: "error",
        time: frame.time,
        selector,
        message: `${selector} drifts off the ${canvas.width}×${canvas.height} canvas at ${round(frame.time)}s (box ${r.left},${r.top}→${r.right},${r.bottom})`,
        rect: r,
        fixHint:
          "Clamp the element's motion so its box stays within the canvas for the whole shot.",
      },
    ];
  }
  return [];
}

function keepsMoving(
  frames: MotionFrame[],
  within: string | undefined,
  maxStaticSec: number,
): LayoutIssue[] {
  // "*" is reserved for whole-canvas scope; motionSpec.ts rejects it as a user-supplied withinSelector.
  const scope = within ?? "*";
  if (within && frames.every((frame) => !frame.liveness[scope])) {
    return [missingIssue(within, 0)];
  }

  const issues: LayoutIssue[] = [];
  const first = frames[0];
  if (!first) return issues;
  let runStart = first.time;
  let runSig = first.liveness[scope] ?? "";
  const flush = (endTime: number) => {
    const span = endTime - runStart;
    if (span > maxStaticSec) {
      issues.push({
        code: "motion_frozen",
        severity: "error",
        time: runStart,
        selector: within ?? "composition",
        message: `nothing moves${within ? ` within ${within}` : ""} between ${round(runStart)}s and ${round(endTime)}s (${round(span)}s static) — should keep moving`,
        rect: ZERO_RECT,
        fixHint:
          "Add or extend motion so no shot freezes for this long, or shorten the static hold.",
      });
    }
  };

  let lastTime = runStart;
  for (const frame of frames.slice(1)) {
    lastTime = frame.time;
    const sig = frame.liveness[scope] ?? "";
    if (sig !== runSig) {
      flush(frame.time);
      runStart = frame.time;
      runSig = sig;
    }
  }
  flush(lastTime);
  return issues;
}

/**
 * Evaluate motion assertions against the dense `element × time` matrix.
 * Pure — no browser. Findings reuse the LayoutIssue shape and flow through
 * inspect's existing dedupe/collapse/limit/format pipeline.
 */
export function evaluateMotion(
  frames: MotionFrame[],
  assertions: MotionAssertion[],
  canvas: Canvas,
): LayoutIssue[] {
  if (frames.length === 0) return [];
  return assertions.flatMap((assertion) => {
    switch (assertion.kind) {
      case "appearsBy":
        return appearsBy(frames, assertion.selector, assertion.bySec);
      case "before":
        return before(frames, assertion.a, assertion.b);
      case "staysInFrame":
        return staysInFrame(frames, assertion.selector, canvas);
      case "keepsMoving":
        return keepsMoving(
          frames,
          assertion.withinSelector,
          assertion.maxStaticSec ?? DEFAULT_MAX_STATIC_SEC,
        );
    }
  });
}

/**
 * Selectors and liveness scopes the in-page sampler must read for a spec.
 * Selectors feed the per-element matrix; scopes feed keepsMoving liveness.
 */
export function collectSamplingTargets(assertions: MotionAssertion[]): {
  selectors: string[];
  livenessScopes: string[];
} {
  const selectors = new Set<string>();
  const scopes = new Set<string>();
  for (const assertion of assertions) {
    switch (assertion.kind) {
      case "appearsBy":
      case "staysInFrame":
        selectors.add(assertion.selector);
        break;
      case "before":
        selectors.add(assertion.a);
        selectors.add(assertion.b);
        break;
      case "keepsMoving":
        scopes.add(assertion.withinSelector ?? "*");
        break;
    }
  }
  return { selectors: [...selectors], livenessScopes: [...scopes] };
}
