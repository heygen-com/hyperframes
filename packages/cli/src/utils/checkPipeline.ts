import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { trackCheckReport, trackCommandFailure } from "../telemetry/events.js";
import { getRunId } from "../telemetry/runId.js";
import type { ProjectDir } from "./project.js";
import { lintProject, shouldBlockRender, type ProjectLintResult } from "./lintProject.js";
import {
  buildLayoutSampleTimes,
  buildTransitionSampleTimes,
  collapseStaticLayoutIssues,
  dedupeLayoutIssues,
  limitLayoutIssues,
  mergeSampleTimes,
  type LayoutIssue,
  type LayoutRect,
} from "./layoutAudit.js";
import {
  collectSamplingTargets,
  evaluateMotion,
  type Canvas,
  type MotionFrame,
} from "./motionAudit.js";
import { findMotionSpec, readMotionSpec } from "./motionSpec.js";
import { normalizeErrorMessage } from "./errorMessage.js";
import {
  parseColorRGBA,
  requiredContrastRatio,
  suggestCompliantForegroundColor,
  type Rgb,
} from "../commands/contrast-bg.js";
import { rectToBbox } from "./checkTypes.js";
import type {
  AnchoredLayoutIssue,
  CheckAnnotationBox,
  CheckAuditDriver,
  CheckBbox,
  CheckBrowserResult,
  CheckContrastFinding,
  CheckDependencies,
  CheckFinding,
  CheckFindingCropRequest,
  CheckGeometryCandidate,
  CheckOptions,
  CheckReport,
  CheckScreenshot,
  CheckSection,
  CheckSeverity,
  ContrastAuditEntry,
  GeometryCandidateRequest,
  MotionSpecResolution,
  RotationSample,
} from "./checkTypes.js";

export type {
  AnchoredLayoutIssue,
  CheckAnchor,
  CheckAuditDriver,
  CheckBrowserResult,
  CheckDependencies,
  CheckFinding,
  CheckFindingCropRequest,
  CheckOptions,
  CheckReport,
  CheckSection,
  ContrastAuditEntry,
  MotionSpecResolution,
} from "./checkTypes.js";

const MOTION_FPS = 20;
const MOTION_MAX_SAMPLES = 300;
const ZERO_BBOX: CheckBbox = { x: 0, y: 0, width: 0, height: 0 };
// Ignore normal in/out slide travel; only substantive frame breaches are actionable.
const FRAME_BREACH_FLOOR_PX = 120;
const FRAME_BREACH_FLOOR_FRACTION = 0.06;

export const DEFAULT_CHECK_OPTIONS: CheckOptions = {
  samples: 9,
  atTransitions: false,
  maxIssues: 80,
  collapseStatic: true,
  tolerance: 2,
  timeout: 3000,
  contrast: true,
  strict: false,
  snapshots: false,
};

/** Pick at most five evenly-strided points from the already-merged layout grid. */
export function selectContrastTimes(grid: number[]): number[] {
  if (grid.length <= 5) return [...grid];
  return Array.from({ length: 5 }, (_, index) => {
    const selected = Math.floor((index * (grid.length - 1)) / 4);
    return grid[selected] ?? grid[0] ?? 0;
  });
}

function buildMotionSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.min(MOTION_MAX_SAMPLES, Math.max(2, Math.ceil(duration * MOTION_FPS) + 1));
  const step = duration / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(index * step * 1000) / 1000);
}

interface SampleGrid {
  duration: number;
  layoutSamples: number[];
  captionSamples: number[];
  frameSamples: number[];
  transitionSamples: number[];
  transitionSamplesDropped: number;
  contrastSamples: number[];
}

function gateSampleTimes(
  duration: number,
  seeks: number[] | undefined,
  fallback: number,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const fractions = seeks && seeks.length > 0 ? seeks : [fallback];
  return mergeSampleTimes(fractions.map((fraction) => fraction * duration));
}

async function buildSampleGrid(
  driver: CheckAuditDriver,
  options: CheckOptions,
): Promise<SampleGrid> {
  const duration = await driver.getDuration();
  const baseSamples = buildLayoutSampleTimes({
    duration,
    samples: options.samples,
    at: options.at,
  });
  const transitions = options.atTransitions
    ? buildTransitionSampleTimes({
        duration,
        boundaries: await driver.getTransitionBoundaries(),
        cap: options.maxTransitionSamples,
      })
    : { times: [], dropped: 0 };
  const captionSamples = options.captionZone
    ? gateSampleTimes(duration, options.captionZone.seek, 1)
    : [];
  const frameSamples = options.frameCheck
    ? gateSampleTimes(duration, options.frameCheck.seek, 0.5)
    : [];
  const auditSamples = mergeSampleTimes(baseSamples, transitions.times);
  const layoutSamples = mergeSampleTimes(auditSamples, captionSamples, frameSamples);
  if (layoutSamples.length === 0) {
    throw new Error("Could not determine composition duration — no layout samples run");
  }
  return {
    duration,
    layoutSamples,
    captionSamples,
    frameSamples,
    transitionSamples: transitions.times,
    transitionSamplesDropped: transitions.dropped,
    contrastSamples: options.contrast ? selectContrastTimes(auditSamples) : [],
  };
}

interface MotionPlan {
  times: number[];
  selectors: string[];
  livenessScopes: string[];
  preflightIssues: AnchoredLayoutIssue[];
}

async function planMotionSampling(
  driver: CheckAuditDriver,
  motion: MotionSpecResolution,
  duration: number,
): Promise<MotionPlan> {
  if (motion.kind !== "valid") {
    return { times: [], selectors: [], livenessScopes: [], preflightIssues: [] };
  }
  const targets = collectSamplingTargets(motion.spec.assertions);
  const preflightIssues = await driver.findAmbiguousSelectors(targets.selectors);
  const times =
    preflightIssues.length === 0 ? buildMotionSampleTimes(motion.spec.duration ?? duration) : [];
  return { times, ...targets, preflightIssues };
}

interface GridSamples {
  layoutIssues: AnchoredLayoutIssue[];
  motionFrames: MotionFrame[];
  contrastEntries: ContrastAuditEntry[];
  screenshots: CheckScreenshot[];
  contrastMs: number;
  /** One geometry+opacity fingerprint per layout sample (#U10 frozen-sweep guard). */
  geometrySignatures: string[];
  /** Every rotatable element's geometry at each layout sample; grouped by
   * selector after the run to detect rotation_pivot_drift. */
  rotationSamples: RotationSample[];
}

interface GeometrySeen {
  caption: Set<string>;
  frame: Set<string>;
}

function geometryRequest(
  time: number,
  grid: SampleGrid,
  options: CheckOptions,
): GeometryCandidateRequest | null {
  const text = grid.captionSamples.includes(time);
  const media = grid.frameSamples.includes(time);
  if (!text && !media) return null;
  const configuredTolerance = options.frameCheck?.tol;
  const tolerance = typeof configuredTolerance === "number" ? configuredTolerance : 2;
  return { text, media, tolerance };
}

function candidateIsSized(candidate: CheckGeometryCandidate, canvas: Canvas): boolean {
  if (candidate.elementRect.width < 4 || candidate.elementRect.height < 4) return false;
  return !(
    candidate.elementRect.width >= 0.95 * canvas.width &&
    candidate.elementRect.height >= 0.95 * canvas.height
  );
}

function geometryIssueAnchor(candidate: CheckGeometryCandidate, time: number) {
  return {
    selector: candidate.selector,
    dataAttributes: candidate.dataAttributes,
    sourceFile: candidate.sourceFile,
    bbox: candidate.bbox,
    time,
    rect: candidate.rect,
  };
}

function captionFinding(
  candidate: CheckGeometryCandidate,
  options: CheckOptions,
  canvas: Canvas,
  time: number,
): { key: string; issue: AnchoredLayoutIssue } | null {
  const zone = options.captionZone;
  if (!zone || candidate.kind !== "text" || !candidateIsSized(candidate, canvas)) return null;
  const cx = candidate.rect.left + candidate.rect.width / 2;
  const cy = candidate.rect.top + candidate.rect.height / 2;
  const inside =
    cx >= zone.x0 * canvas.width &&
    cx <= zone.x1 * canvas.width &&
    cy >= zone.y0 * canvas.height &&
    cy <= zone.y1 * canvas.height;
  if (!inside) return null;
  const text = candidate.text.slice(0, 48);
  const pctFromBottom = Math.round(((canvas.height - cy) / canvas.height) * 100);
  return {
    key: `${candidate.tag}|${text}`,
    issue: {
      ...geometryIssueAnchor(candidate, time),
      code: "caption_zone_collision",
      severity: zone.severity === "error" ? "error" : "warning",
      text,
      message: `<${candidate.tag}> "${text}" is centred in the reserved caption band (~${pctFromBottom}% up from the bottom).`,
      fixHint: "Keep main content outside the configured caption band.",
    },
  };
}

function maxOverflow(candidate: CheckGeometryCandidate): number {
  if (!candidate.overflow) return 0;
  return Math.max(
    candidate.overflow.left ?? 0,
    candidate.overflow.top ?? 0,
    candidate.overflow.right ?? 0,
    candidate.overflow.bottom ?? 0,
  );
}

function overflowMessage(candidate: CheckGeometryCandidate): string {
  const overflow = candidate.overflow ?? {};
  const edges: string[] = [];
  if (overflow.left) edges.push(`${overflow.left}px past the left`);
  if (overflow.top) edges.push(`${overflow.top}px past the top`);
  if (overflow.right) edges.push(`${overflow.right}px past the right`);
  if (overflow.bottom) edges.push(`${overflow.bottom}px past the bottom`);
  return `<${candidate.tag}> "${candidate.text.slice(0, 48)}" spills outside the frame (${edges.join(", ")}).`;
}

function frameFinding(
  candidate: CheckGeometryCandidate,
  options: CheckOptions,
  canvas: Canvas,
  time: number,
): { key: string; issue: AnchoredLayoutIssue } | null {
  if (!options.frameCheck || candidate.kind !== "media" || !candidateIsSized(candidate, canvas)) {
    return null;
  }
  const floor = Math.max(
    FRAME_BREACH_FLOOR_PX,
    FRAME_BREACH_FLOOR_FRACTION * Math.min(canvas.width, canvas.height),
  );
  if (maxOverflow(candidate) < floor) return null;
  const text = candidate.text.slice(0, 48);
  return {
    key: `${candidate.tag}|${text}|${Math.round(candidate.rect.left)},${Math.round(candidate.rect.top)}`,
    issue: {
      ...geometryIssueAnchor(candidate, time),
      code: "frame_out_of_frame",
      severity: options.frameCheck.severity === "error" ? "error" : "warning",
      text,
      overflow: candidate.overflow,
      message: overflowMessage(candidate),
      fixHint: "Keep media within the composition frame's safe area.",
    },
  };
}

function appendGeometryFinding(
  result: { key: string; issue: AnchoredLayoutIssue } | null,
  seen: Set<string>,
  issues: AnchoredLayoutIssue[],
): void {
  if (!result || seen.has(result.key)) return;
  seen.add(result.key);
  issues.push(result.issue);
}

async function collectGeometryAt(
  driver: CheckAuditDriver,
  options: CheckOptions,
  grid: SampleGrid,
  canvas: Canvas,
  time: number,
  seen: GeometrySeen,
): Promise<AnchoredLayoutIssue[]> {
  const request = geometryRequest(time, grid, options);
  if (!request) return [];
  const candidates = await driver.collectGeometryCandidates(time, request);
  const issues: AnchoredLayoutIssue[] = [];
  for (const candidate of candidates) {
    if (request.text) {
      appendGeometryFinding(captionFinding(candidate, options, canvas, time), seen.caption, issues);
    }
    if (request.media) {
      appendGeometryFinding(frameFinding(candidate, options, canvas, time), seen.frame, issues);
    }
  }
  return issues;
}

async function collectGridSamples(
  driver: CheckAuditDriver,
  options: CheckOptions,
  grid: SampleGrid,
  motion: MotionPlan,
): Promise<GridSamples> {
  const layoutSet = new Set(grid.layoutSamples);
  const motionSet = new Set(motion.times);
  const contrastSet = new Set(grid.contrastSamples);
  const geometryEnabled = grid.captionSamples.length > 0 || grid.frameSamples.length > 0;
  const canvas = geometryEnabled ? await driver.getCanvas() : null;
  const geometrySeen: GeometrySeen = { caption: new Set(), frame: new Set() };
  const collected: GridSamples = {
    layoutIssues: [],
    motionFrames: [],
    contrastEntries: [],
    screenshots: [],
    contrastMs: 0,
    geometrySignatures: [],
    rotationSamples: [],
  };
  for (const time of mergeSampleTimes(grid.layoutSamples, motion.times)) {
    await driver.seek(time);
    // Findings collected for THIS sample time, so the overview overlay (below)
    // only ever annotates a frame with defects that are actually valid at
    // that render time — never a stale bbox from an earlier/later sample.
    const issuesAtTime: AnchoredLayoutIssue[] = [];
    if (layoutSet.has(time)) {
      const layoutIssues = await driver.collectLayout(time, options.tolerance);
      collected.layoutIssues.push(...layoutIssues);
      issuesAtTime.push(...layoutIssues);
      collected.geometrySignatures.push(await driver.collectLayoutGeometry());
      collected.rotationSamples.push(...(await driver.collectRotationSample(time)));
    }
    if (canvas) {
      const geometryIssues = await collectGeometryAt(
        driver,
        options,
        grid,
        canvas,
        time,
        geometrySeen,
      );
      collected.layoutIssues.push(...geometryIssues);
      issuesAtTime.push(...geometryIssues);
    }
    if (motionSet.has(time)) {
      collected.motionFrames.push(
        await driver.collectMotionFrame(time, motion.selectors, motion.livenessScopes),
      );
    }
    if (contrastSet.has(time)) {
      const contrastStart = Date.now();
      // Annotation is a --snapshots-only nicety — skip building it (and the
      // driver's extra overlay screenshot) when nothing will use it; the call
      // shape without --snapshots stays exactly what it was before this existed.
      const capture = options.snapshots
        ? await driver.collectContrast(time, annotationBoxesFrom(issuesAtTime))
        : await driver.collectContrast(time);
      collected.contrastMs += Date.now() - contrastStart;
      collected.contrastEntries.push(...capture.entries);
      collected.screenshots.push({ time, pngBase64: capture.pngBase64 });
    }
  }
  return collected;
}

// Frozen-sweep guard (#U10): compositions this short can legitimately hold a
// single static frame the whole time (a title card) — never flag those.
const SWEEP_STATIC_MIN_DURATION_SEC = 3;
const ZERO_LAYOUT_RECT: LayoutRect = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
};

/**
 * Frozen-sweep guard (#U10): if every layout-grid sample produced the exact
 * same geometry+opacity fingerprint (see layout-audit.browser.js), the seek
 * never actually advanced the composition's timeline — every other green
 * verdict from this run is meaningless, not just a missed defect. Skips
 * short (<3s) compositions, single-sample runs (nothing to compare), and
 * runs where a `motion_frozen` finding already reported the same underlying
 * symptom (no double-reporting the one thing that's wrong).
 */
function detectSweepStatic(
  duration: number,
  geometrySignatures: string[],
  motionIssues: AnchoredLayoutIssue[],
): AnchoredLayoutIssue[] {
  if (duration < SWEEP_STATIC_MIN_DURATION_SEC) return [];
  if (geometrySignatures.length < 2) return [];
  if (motionIssues.some((issue) => issue.code === "motion_frozen")) return [];
  const [first, ...rest] = geometrySignatures;
  if (!first || rest.some((signature) => signature !== first)) return [];
  return [
    {
      code: "sweep_static",
      severity: "error",
      time: 0,
      selector: "[data-composition-id]",
      dataAttributes: {},
      sourceFile: "index.html",
      bbox: ZERO_BBOX,
      rect: ZERO_LAYOUT_RECT,
      message:
        "Timeline did not advance under seek; every green verdict on this run is unreliable.",
      fixHint:
        "Confirm the composition seeks a paused GSAP/CSS timeline under `data-*` timing attributes rather than only autoplaying.",
    },
  ];
}

// rotation_pivot_drift thresholds. A spinning element's bbox center should be
// fixed; drift beyond this signals a wrong pivot (transformOrigin/svgOrigin).
const ROTATION_MIN_SAMPLES = 3;
// Degrees of angle spread that count as "actually spinning" (vs a static tilt).
const ROTATION_MIN_ANGLE_SPREAD_DEG = 20;
// Max bbox-width ratio across samples — above this it is scaling/entrancing,
// not spinning in place. A rigid anisotropic shape's axis-aligned bbox
// oscillates under rotation on its own (a plain square already swings 1.41x
// between flat and 45deg), so this must sit above that; 1.6 admits rotating
// squares/mild rectangles while still excluding gross scale/entrance growth
// and thin bars/lines whose bbox swings many-fold (e.g. a rotating reference
// arm). The bbox-CENTER drift below is the real spin-in-place discriminator.
const ROTATION_MAX_SIZE_RATIO = 1.6;
// Skip tiny decorative spinners; only sizable rotating figures matter.
const ROTATION_MIN_MEDIAN_AREA_PX = 2500;
const ROTATION_DRIFT_SIZE_FRACTION = 0.1;
const ROTATION_DRIFT_VIEWPORT_FRACTION = 0.02;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + upper) / 2 : upper;
}

/** Widest angular gap between any two samples, wrap-aware (0/360 continuity). */
function maxAngleSpread(angles: number[]): number {
  let max = 0;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < angles.length; j++) {
      const b = angles[j];
      if (b === undefined) continue;
      const raw = Math.abs(a - b) % 360;
      max = Math.max(max, Math.min(raw, 360 - raw));
    }
  }
  return max;
}

/** Largest distance between any two bbox centers across the samples. */
function maxCenterDrift(samples: RotationSample[]): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const first = samples[i];
    if (!first) continue;
    for (let j = i + 1; j < samples.length; j++) {
      const second = samples[j];
      if (!second) continue;
      max = Math.max(max, Math.hypot(first.cx - second.cx, first.cy - second.cy));
    }
  }
  return max;
}

function rotationDriftFinding(
  samples: RotationSample[],
  drift: number,
): AnchoredLayoutIssue | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  const rect: LayoutRect = {
    left: last.cx - last.w / 2,
    top: last.cy - last.h / 2,
    right: last.cx + last.w / 2,
    bottom: last.cy + last.h / 2,
    width: last.w,
    height: last.h,
  };
  return {
    code: "rotation_pivot_drift",
    // EF promotes this to error separately; keep it a warning here.
    severity: "warning",
    time: last.time,
    selector: last.selector,
    dataAttributes: {},
    sourceFile: "index.html",
    bbox: rectToBbox(rect),
    rect,
    message: `Rotating element's bounding-box center drifts ${Math.round(drift)}px across rotation — it is not spinning about its own center (check transformOrigin/svgOrigin).`,
    fixHint:
      "The bounding-box center should stay fixed while the element spins; check its transformOrigin/svgOrigin so rotation pivots about the element's own center rather than a point in a coordinate space it was resized out of.",
  };
}

function groupRotationSamplesBySelector(samples: RotationSample[]): Map<string, RotationSample[]> {
  const bySelector = new Map<string, RotationSample[]>();
  for (const sample of samples) {
    const group = bySelector.get(sample.selector);
    if (group) group.push(sample);
    else bySelector.set(sample.selector, [sample]);
  }
  return bySelector;
}

/** Enough samples to establish a spin trajectory (one frame can't). */
function hasEnoughRotationSamples(group: RotationSample[]): boolean {
  return group.length >= ROTATION_MIN_SAMPLES;
}

/** Real spin, not a fixed tilt: the rotation angle actually varies across the grid. */
function isActuallySpinning(group: RotationSample[]): boolean {
  return maxAngleSpread(group.map((s) => s.angle)) > ROTATION_MIN_ANGLE_SPREAD_DEG;
}

/** Rigid bbox size in BOTH dimensions. A scale/entrance animation is not pivot
 * drift; in particular top-anchored height scaling (fixed width, growing height)
 * moves the AABB center on its own — the earlier width-only guard let that through
 * as a false positive. */
function isRotationSizeStable(group: RotationSample[]): boolean {
  const widths = group.map((s) => s.w);
  const heights = group.map((s) => s.h);
  const minWidth = Math.min(...widths);
  const minHeight = Math.min(...heights);
  if (minWidth <= 0 || minHeight <= 0) return false;
  return (
    Math.max(...widths) / minWidth <= ROTATION_MAX_SIZE_RATIO &&
    Math.max(...heights) / minHeight <= ROTATION_MAX_SIZE_RATIO
  );
}

/** Skip tiny decorative spinners; only sizable rotating figures matter. */
function isSizableRotation(group: RotationSample[]): boolean {
  return median(group.map((s) => s.w * s.h)) >= ROTATION_MIN_MEDIAN_AREA_PX;
}

/** The size/motion gates a selector group must clear before the (viewport-
 * dependent) center-drift test. Each is a strict FP guard, deliberately so:
 * a false positive feeds destructive downstream auto-fixes. */
function isRotationDriftCandidate(group: RotationSample[]): boolean {
  return (
    hasEnoughRotationSamples(group) &&
    isActuallySpinning(group) &&
    isRotationSizeStable(group) &&
    isSizableRotation(group)
  );
}

/**
 * rotation_pivot_drift: an element that visibly SPINS (its rotation angle varies
 * across the seek grid) while its bounding-box CENTER travels is pivoting about
 * the wrong point — the classic symptom of a transformOrigin/svgOrigin authored
 * as hardcoded pixels against a coordinate space the element was later resized
 * out of (e.g. spokes set to `250px 250px` inside a 460px-rendered 500-viewBox
 * SVG). A correctly centered spinner holds its bbox center fixed.
 *
 * Cross-sample by necessity — one frame can't distinguish spin-in-place from
 * pivot drift. FP guards are deliberately strict because a false positive feeds
 * destructive downstream auto-fixes: requires real rotation, a stable bbox size
 * in both axes (excludes scale/entrance animations), a sizable element, and
 * honors `[data-layout-allow-orbit]` opt-outs (applied browser-side).
 *
 * Invariant: samples are grouped by `selector`, assumed stable across seeks.
 * An element without a stable id/class can fall back to a `nth-of-type(N)`
 * selector whose N shifts as siblings enter/exit — so in that fringe it may be
 * mis-grouped (a missed detection, or in a rare exit-then-enter aliasing case a
 * spurious one). Author-crafted rotating figures effectively always carry stable
 * anchors; a stable-anchor gate on the browser sampler is the structural fix.
 */
export function detectRotationPivotDrift(
  samples: RotationSample[],
  canvas: Canvas,
): AnchoredLayoutIssue[] {
  const findings: AnchoredLayoutIssue[] = [];
  const viewportFloor = ROTATION_DRIFT_VIEWPORT_FRACTION * Math.min(canvas.width, canvas.height);
  for (const group of groupRotationSamplesBySelector(samples).values()) {
    if (!isRotationDriftCandidate(group)) continue;
    const medianSize = median(group.map((s) => Math.max(s.w, s.h)));
    const threshold = Math.max(ROTATION_DRIFT_SIZE_FRACTION * medianSize, viewportFloor);
    const drift = maxCenterDrift(group);
    if (drift <= threshold) continue;
    const finding = rotationDriftFinding(group, drift);
    if (finding) findings.push(finding);
  }
  return findings;
}

/** Error-severity findings with real geometry become labeled overview boxes.
 * Contrast failures are annotated separately by the driver itself, since
 * they're only known once contrast measurement for this sample completes. */
function annotationBoxesFrom(issues: AnchoredLayoutIssue[]): CheckAnnotationBox[] {
  return issues
    .filter((issue) => issue.severity === "error" && issue.bbox.width > 0 && issue.bbox.height > 0)
    .map((issue, index) => ({ label: `${index + 1} ${issue.code}`, bbox: issue.bbox }));
}

export async function runAuditGrid(
  driver: CheckAuditDriver,
  options: CheckOptions,
  motion: MotionSpecResolution,
): Promise<CheckBrowserResult> {
  await driver.initialize(options.contrast);
  const grid = await buildSampleGrid(driver, options);
  const plan = await planMotionSampling(driver, motion, grid.duration);
  const seekLoopStart = Date.now();
  const collected = await collectGridSamples(driver, options, grid, plan);
  const seekLoopMs = Date.now() - seekLoopStart;

  let motionIssues = plan.preflightIssues;
  if (motion.kind === "valid" && motionIssues.length === 0 && collected.motionFrames.length > 0) {
    const evaluated = evaluateMotion(
      collected.motionFrames,
      motion.spec.assertions,
      await driver.getCanvas(),
    );
    motionIssues = await driver.anchorMotionIssues(evaluated);
  }
  const sweepFindings = detectSweepStatic(
    grid.duration,
    collected.geometrySignatures,
    motionIssues,
  );
  const rotationFindings = detectRotationPivotDrift(
    collected.rotationSamples,
    await driver.getCanvas(),
  );
  const contrast = buildContrastResults(collected.contrastEntries);
  return {
    duration: grid.duration,
    layoutSamples: grid.layoutSamples,
    transitionSamples: grid.transitionSamples,
    transitionSamplesDropped: grid.transitionSamplesDropped,
    runtimeFindings: [],
    layoutIssues: [...collected.layoutIssues, ...sweepFindings, ...rotationFindings],
    motionIssues,
    motionSampleCount: collected.motionFrames.length,
    contrastSamples: grid.contrastSamples,
    contrastFindings: contrast.findings,
    contrastChecked: collected.contrastEntries.length,
    contrastPassed: contrast.passed,
    screenshots: collected.screenshots,
    timings: { launchSettleMs: 0, seekLoopMs, contrastMs: collected.contrastMs },
  };
}

export async function runCheckPipeline(
  project: ProjectDir,
  options: CheckOptions,
  dependencies: CheckDependencies = DEFAULT_DEPENDENCIES,
): Promise<CheckReport> {
  let lintResult: ProjectLintResult;
  try {
    lintResult = await dependencies.lintProject(project.dir);
  } catch (error) {
    // The linter itself crashed (unreadable file, internal error) — distinct
    // from lint findings; a runtime-failure code would send the agent hunting
    // for a script problem that doesn't exist.
    return failureReport(options, runtimeFailure(error, "check_lint_failure"));
  }

  const lint = buildLintSection(lintResult);
  if (shouldBlockRender(true, false, lintResult.totalErrors, lintResult.totalWarnings)) {
    return buildReport(options, lint, emptyBrowserResult(), { kind: "none" }, [], []);
  }

  const motion = dependencies.resolveMotionSpec(project.dir);
  if (motion.kind === "invalid") {
    const finding = findingAtRoot(
      "motion_spec_invalid",
      "error",
      motion.message,
      relative(project.dir, motion.path) || "index.motion.json",
    );
    return buildReport(options, lint, emptyBrowserResult(), motion, [finding], []);
  }

  let browser: CheckBrowserResult;
  try {
    browser = await dependencies.runBrowserCheck(project, options, motion);
  } catch (error) {
    browser = emptyBrowserResult();
    browser.runtimeFindings.push(runtimeFailure(error));
  }

  const snapshotFiles = options.snapshots
    ? await writeContrastSnapshots(dependencies, project.dir, browser)
    : [];
  const report = buildReport(options, lint, browser, motion, [], snapshotFiles);
  return options.snapshots
    ? await withFindingCrops(dependencies, project, options, report)
    : report;
}

/** Persists the contrast pass's already-captured overview PNGs (or the
 * annotated versions — see `collectContrast`'s overlay). A write failure
 * becomes a runtime finding rather than aborting the whole report. */
async function writeContrastSnapshots(
  dependencies: CheckDependencies,
  projectDir: string,
  browser: CheckBrowserResult,
): Promise<string[]> {
  const files: string[] = [];
  for (let index = 0; index < browser.screenshots.length; index += 1) {
    const shot = browser.screenshots[index];
    if (!shot) continue;
    try {
      files.push(await dependencies.writeSnapshot(projectDir, index, shot.time, shot.pngBase64));
    } catch (error) {
      browser.runtimeFindings.push(runtimeFailure(error, "snapshot_write_failed"));
    }
  }
  return files;
}

/** Finding crops are bonus evidence, not gating — no eligible finding, or a
 * capture failure (e.g. a second Chrome launch failing), returns the report
 * unchanged rather than sinking an otherwise-good run. */
async function withFindingCrops(
  dependencies: CheckDependencies,
  project: ProjectDir,
  options: CheckOptions,
  report: CheckReport,
): Promise<CheckReport> {
  const cropRequests = selectFindingCropRequests(report);
  if (cropRequests.length === 0) return report;
  try {
    const findingFiles = await dependencies.captureFindingCrops(project, options, cropRequests);
    return { ...report, snapshots: { ...report.snapshots, findingFiles } };
  } catch (error) {
    // Still non-gating, but observable: rollouts need the crop-failure rate
    // (a second Chrome launch failing/timing out) without failing the run.
    console.error("   finding crops skipped: " + normalizeErrorMessage(error));
    trackCommandFailure("check-finding-crops", error);
    return report;
  }
}

const MAX_FINDING_CROPS = 12;

/** Which error findings get a `finding-NN-<code>.png` crop for `check --snapshots`:
 * error severity, a real (non-zero) bbox, capped at 12. Pure and order-preserving
 * so it's directly unit-testable without a browser. */
export function selectFindingCropRequests(report: CheckReport): CheckFindingCropRequest[] {
  const candidates: CheckFinding[] = [
    ...report.layout.findings,
    ...report.motion.findings,
    ...report.contrast.findings,
    ...report.runtime.findings,
  ];
  const requests: CheckFindingCropRequest[] = [];
  for (const finding of candidates) {
    if (requests.length >= MAX_FINDING_CROPS) break;
    if (finding.severity !== "error" || !hasRealBbox(finding.bbox)) continue;
    requests.push({
      filename: findingCropFilename(requests.length, finding.code),
      time: finding.time,
      bbox: finding.bbox,
    });
  }
  return requests;
}

function hasRealBbox(bbox: CheckBbox): boolean {
  return bbox.width > 0 && bbox.height > 0;
}

export function findingCropFilename(index: number, code: string): string {
  const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `finding-${String(index).padStart(2, "0")}-${safeCode}.png`;
}

export function checkExitCode(report: CheckReport): 0 | 1 {
  return report.ok ? 0 : 1;
}

// Same persistence rule the layout findings follow: a failure observed at a
// single contrast sample is usually text caught mid-entrance/exit (its real
// background not painted yet — white-on-white at exactly 1.0 is the classic
// shape), so it demotes to warning. A failure HELD at 2+ samples for the same
// element is a real, gating defect. Single-sample sweeps can't distinguish,
// so they keep full severity.
function contrastFailureHeld(
  entries: ContrastAuditEntry[],
): (entry: ContrastAuditEntry) => boolean {
  const sampledTimes = new Set(entries.map((entry) => entry.time)).size;
  const failureSamples = new Map<string, Set<number>>();
  for (const entry of entries) {
    if (entry.wcagAA) continue;
    const key = `${entry.selector}|${entry.text}`;
    const times = failureSamples.get(key) ?? new Set<number>();
    times.add(entry.time);
    failureSamples.set(key, times);
  }
  return (entry) =>
    sampledTimes < 2 || (failureSamples.get(`${entry.selector}|${entry.text}`)?.size ?? 0) >= 2;
}

function buildContrastResults(entries: ContrastAuditEntry[]): {
  findings: CheckContrastFinding[];
  passed: number;
} {
  const findings: CheckContrastFinding[] = [];
  let passed = 0;
  const isHeld = contrastFailureHeld(entries);
  for (const entry of entries) {
    if (entry.wcagAA) {
      passed += 1;
      continue;
    }
    const held = isHeld(entry);
    const requiredRatio = requiredContrastRatio(entry.large);
    findings.push({
      code: "contrast_aa_failure",
      severity: held ? "error" : "warning",
      message: `Contrast is ${entry.ratio}:1; WCAG AA requires ${requiredRatio}:1.`,
      text: entry.text,
      fg: entry.fg,
      bg: entry.bg,
      ratio: entry.ratio,
      requiredRatio,
      suggestedColor: suggestedColor(entry.fg, entry.bg, requiredRatio),
      large: entry.large,
      selector: entry.selector,
      dataAttributes: entry.dataAttributes,
      sourceFile: entry.sourceFile,
      bbox: entry.bbox,
      time: entry.time,
    });
  }
  return { findings, passed };
}

function suggestedColor(fg: string, bg: string, requiredRatio: number): string {
  const foreground = parseColorRGBA(fg);
  const background = parseColorRGBA(bg);
  if (!foreground || !background) return fg;
  const fgRgb: Rgb = [foreground[0], foreground[1], foreground[2]];
  const bgRgb: Rgb = [background[0], background[1], background[2]];
  const suggested = suggestCompliantForegroundColor(fgRgb, bgRgb, requiredRatio);
  return `rgb(${suggested[0]},${suggested[1]},${suggested[2]})`;
}

function buildLintSection(result: ProjectLintResult): CheckReport["lint"] {
  const findings = result.results.flatMap(({ file, result: fileResult }) =>
    fileResult.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      selector:
        finding.selector ?? (finding.elementId ? `#${finding.elementId}` : "[data-composition-id]"),
      dataAttributes: {},
      sourceFile: finding.file ?? file,
      bbox: ZERO_BBOX,
      time: 0,
      fixHint: finding.fixHint,
    })),
  );
  return { ...section(findings), filesScanned: result.results.length };
}

function buildReport(
  options: CheckOptions,
  lint: CheckReport["lint"],
  browser: CheckBrowserResult,
  motion: MotionSpecResolution,
  extraMotionFindings: CheckFinding[],
  snapshotFiles: string[],
): CheckReport {
  const layout = shapeLayoutSection(browser.layoutIssues, browser, options);
  const shapedMotion = shapeLayoutFindings(browser.motionIssues, options);
  const motionFindings: CheckFinding[] = [...shapedMotion.findings, ...extraMotionFindings];
  const runtime = section(browser.runtimeFindings);
  const motionSection = section(motionFindings);
  const contrastSection = section(browser.contrastFindings);
  const warningCount =
    lint.warningCount +
    runtime.warningCount +
    layout.warningCount +
    motionSection.warningCount +
    contrastSection.warningCount;
  const errorCount =
    lint.errorCount +
    runtime.errorCount +
    layout.errorCount +
    motionSection.errorCount +
    contrastSection.errorCount;
  const report: CheckReport = {
    ok: errorCount === 0 && (!options.strict || warningCount === 0),
    strict: options.strict,
    lint,
    runtime,
    layout,
    motion: {
      ...motionSection,
      enabled: motion.kind !== "none",
      specPath: motion.kind === "none" ? undefined : motion.path,
      samples: browser.motionSampleCount,
    },
    contrast: {
      ...contrastSection,
      enabled: options.contrast,
      samples: browser.contrastSamples,
      checked: browser.contrastChecked,
      passed: browser.contrastPassed,
    },
    snapshots: {
      enabled: options.snapshots,
      files: snapshotFiles,
      times: options.snapshots ? browser.screenshots.map((shot) => shot.time) : [],
      findingFiles: [],
    },
  };
  trackCheckReport({
    contrastGate: options.contrast,
    motionGate: motion.kind !== "none",
    captionZoneGate: options.captionZone !== undefined,
    frameCheckGate: options.frameCheck !== undefined,
    snapshotsGate: options.snapshots,
    lintErrors: lint.errorCount,
    lintWarnings: lint.warningCount,
    runtimeErrors: runtime.errorCount,
    runtimeWarnings: runtime.warningCount,
    layoutErrors: layout.errorCount,
    layoutWarnings: layout.warningCount,
    motionErrors: motionSection.errorCount,
    motionWarnings: motionSection.warningCount,
    contrastErrors: contrastSection.errorCount,
    contrastWarnings: contrastSection.warningCount,
    launchSettleMs: browser.timings.launchSettleMs,
    seekLoopMs: browser.timings.seekLoopMs,
    contrastMs: browser.timings.contrastMs,
    gridPoints: browser.layoutSamples.length,
    contrastPoints: browser.contrastChecked,
    ok: report.ok,
    exitCode: checkExitCode(report),
    runId: getRunId(),
  });
  return report;
}

function shapeLayoutSection(
  issues: AnchoredLayoutIssue[],
  browser: CheckBrowserResult,
  options: CheckOptions,
): CheckReport["layout"] {
  const shaped = shapeLayoutFindings(issues, options, browser.layoutSamples.length);
  return {
    ...section(shaped.findings),
    duration: browser.duration,
    samples: browser.layoutSamples,
    transitionSamples: browser.transitionSamples,
    transitionSamplesDropped: browser.transitionSamplesDropped,
    tolerance: options.tolerance,
    totalIssueCount: shaped.totalIssueCount,
    truncated: shaped.truncated,
  };
}

function shapeLayoutFindings(
  issues: AnchoredLayoutIssue[],
  options: CheckOptions,
  totalSampleCount?: number,
): { findings: AnchoredLayoutIssue[]; totalIssueCount: number; truncated: boolean } {
  const deduped = dedupeLayoutIssues(issues);
  const all = options.collapseStatic
    ? collapseStaticLayoutIssues(deduped, totalSampleCount)
    : deduped;
  const limited = limitLayoutIssues(all, options.maxIssues);
  return {
    findings: limited.issues.map(ensureAnchoredLayoutIssue),
    totalIssueCount: limited.totalIssueCount,
    truncated: limited.truncated,
  };
}

function ensureAnchoredLayoutIssue(issue: LayoutIssue): AnchoredLayoutIssue {
  const sourceFile = Reflect.get(issue, "sourceFile");
  const dataAttributes = Reflect.get(issue, "dataAttributes");
  const bbox = Reflect.get(issue, "bbox");
  if (typeof sourceFile === "string" && isStringRecord(dataAttributes) && isBbox(bbox)) {
    return { ...issue, sourceFile, dataAttributes, bbox };
  }
  return {
    ...issue,
    sourceFile: "index.html",
    dataAttributes: {},
    bbox: rectToBbox(issue.rect),
  };
}

function section<T extends CheckFinding>(findings: T[]): CheckSection<T> {
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;
  return { ok: errorCount === 0, errorCount, warningCount, infoCount, findings };
}

function emptyBrowserResult(): CheckBrowserResult {
  return {
    duration: 0,
    layoutSamples: [],
    transitionSamples: [],
    transitionSamplesDropped: 0,
    runtimeFindings: [],
    layoutIssues: [],
    motionIssues: [],
    motionSampleCount: 0,
    contrastSamples: [],
    contrastFindings: [],
    contrastChecked: 0,
    contrastPassed: 0,
    screenshots: [],
    timings: { launchSettleMs: 0, seekLoopMs: 0, contrastMs: 0 },
  };
}

function runtimeFailure(error: unknown, code = "check_runtime_failure"): CheckFinding {
  return findingAtRoot(code, "error", normalizeErrorMessage(error), "index.html");
}

function findingAtRoot(
  code: string,
  severity: CheckSeverity,
  message: string,
  sourceFile: string,
): CheckFinding {
  return {
    code,
    severity,
    message,
    selector: "[data-composition-id]",
    dataAttributes: {},
    sourceFile,
    bbox: ZERO_BBOX,
    time: 0,
  };
}

function failureReport(options: CheckOptions, finding: CheckFinding): CheckReport {
  const lint = { ...section([]), filesScanned: 0 };
  const browser = emptyBrowserResult();
  browser.runtimeFindings.push(finding);
  return buildReport(options, lint, browser, { kind: "none" }, [], []);
}

function isBbox(value: unknown): value is CheckBbox {
  if (typeof value !== "object" || value === null) return false;
  return ["x", "y", "width", "height"].every((key) => typeof Reflect.get(value, key) === "number");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => typeof Reflect.get(value, key) === "string");
}

function resolveMotionSpec(projectDir: string): MotionSpecResolution {
  const path = findMotionSpec(projectDir);
  if (!path) return { kind: "none" };
  const result = readMotionSpec(path);
  return result.ok
    ? { kind: "valid", path, spec: result.spec }
    : {
        kind: "invalid",
        path,
        message: `Invalid motion spec ${path}: ${result.errors.join("; ")}`,
      };
}

async function runBrowserCheck(
  project: ProjectDir,
  options: CheckOptions,
  motion: MotionSpecResolution,
): Promise<CheckBrowserResult> {
  const module = await import("./checkBrowser.js");
  // runAuditGrid is handed over as a callback so checkBrowser never imports
  // this module back (no import cycle).
  return module.runBrowserCheck(project, options, motion, runAuditGrid);
}

async function writeSnapshot(
  projectDir: string,
  index: number,
  time: number,
  pngBase64: string,
): Promise<string> {
  const snapshotDir = join(projectDir, "snapshots");
  mkdirSync(snapshotDir, { recursive: true });
  const filename = `frame-${String(index).padStart(2, "0")}-at-${time.toFixed(1)}s.png`;
  const path = join(snapshotDir, filename);
  writeFileSync(path, Buffer.from(pngBase64, "base64"));
  return join("snapshots", filename);
}

async function captureFindingCrops(
  project: ProjectDir,
  options: CheckOptions,
  requests: CheckFindingCropRequest[],
): Promise<string[]> {
  const module = await import("./checkBrowser.js");
  // Handed over the same way runBrowserCheck is (checkBrowser never imports this module back).
  return module.captureFindingCrops(project, options, requests);
}

const DEFAULT_DEPENDENCIES: CheckDependencies = {
  lintProject,
  resolveMotionSpec,
  runBrowserCheck,
  writeSnapshot,
  captureFindingCrops,
};
