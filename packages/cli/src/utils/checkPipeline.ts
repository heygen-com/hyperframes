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
  OffPivotFrame,
  OffPivotRotationSample,
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
  browserGpuMode: "auto",
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
  /** One time-hoisted frame of every elongated rotating SVG figure's
   * material-point geometry + dial hub per layout sample; flattened by selector
   * to detect off_pivot_rotation. */
  indicatorFrames: OffPivotFrame[];
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

function captionCenterInZone(
  rect: CheckGeometryCandidate["rect"],
  zone: NonNullable<CheckOptions["captionZone"]>,
  canvas: Canvas,
): { inside: boolean; cy: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const inside =
    cx >= zone.x0 * canvas.width &&
    cx <= zone.x1 * canvas.width &&
    cy >= zone.y0 * canvas.height &&
    cy <= zone.y1 * canvas.height;
  return { inside, cy };
}

function captionFinding(
  candidate: CheckGeometryCandidate,
  options: CheckOptions,
  canvas: Canvas,
  time: number,
): { key: string; issue: AnchoredLayoutIssue } | null {
  const zone = options.captionZone;
  if (!zone || candidate.kind !== "text" || !candidateIsSized(candidate, canvas)) return null;
  // Backstop for mocks/non-browser sources; browser already strips via closest() (own attrs only here).
  if ("data-layout-allow-caption-zone" in candidate.dataAttributes) return null;
  const { inside, cy } = captionCenterInZone(candidate.rect, zone, canvas);
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
      fixHint:
        "Keep main content outside the configured caption band, or mark intentional lower-third copy with data-layout-allow-caption-zone.",
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
    indicatorFrames: [],
  };
  for (const time of mergeSampleTimes(grid.layoutSamples, motion.times)) {
    await driver.seek(time);
    // Findings collected for THIS sample time, so the overview overlay (below)
    // only ever annotates a frame with defects that are actually valid at
    // that render time — never a stale bbox from an earlier/later sample.
    const issuesAtTime: AnchoredLayoutIssue[] = [];
    if (layoutSet.has(time)) {
      const layoutIssues = await driver.collectLayout(time, options.tolerance, options.layout);
      collected.layoutIssues.push(...layoutIssues);
      issuesAtTime.push(...layoutIssues);
      collected.geometrySignatures.push(await driver.collectLayoutGeometry());
      collected.rotationSamples.push(...(await driver.collectRotationSample(time)));
      collected.indicatorFrames.push(await driver.collectOffPivotRotationSample(time));
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
  await collectMotionOverlapSamples(driver, grid, collected);
  return collected;
}

// Dense grid catches mid-motion text collisions the sparse layout grid seeks past; text-only overlap collection is cheap enough to afford it.
const OVERLAP_SAMPLE_FPS = 8;
// Ceiling that bounds dense seeks; past ~75s the grid degrades below 8fps rather than growing the seek budget without limit.
const OVERLAP_MAX_SAMPLES = 600;

function buildOverlapSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.min(
    OVERLAP_MAX_SAMPLES,
    Math.max(2, Math.ceil(duration * OVERLAP_SAMPLE_FPS) + 1),
  );
  const step = duration / (count - 1);
  return mergeSampleTimes(
    Array.from({ length: count }, (_, index) => Math.round(index * step * 1000) / 1000),
  );
}

/** Reruns content_overlap on a fine grid, unconditionally rather than gated on fingerprint change, since an animation aliased to the sparse grid collides between identical-fingerprint samples. */
async function collectMotionOverlapSamples(
  driver: CheckAuditDriver,
  grid: SampleGrid,
  collected: GridSamples,
): Promise<void> {
  const baseTimes = new Set(grid.layoutSamples);
  for (const time of buildOverlapSampleTimes(grid.duration)) {
    if (baseTimes.has(time)) continue;
    // Settle-free seek: collectOverlap reads getBoundingClientRect geometry, valid synchronously after setTime, so the dense pass skips the per-seek paint settle.
    await driver.seekGeometry(time);
    collected.layoutIssues.push(...(await driver.collectOverlap(time)));
  }
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

// rotation_pivot_drift: bbox center should stay fixed while the element spins.
const ROTATION_MIN_SAMPLES = 3;
// Minimum angle spread that counts as spinning rather than a static tilt.
const ROTATION_MIN_ANGLE_SPREAD_DEG = 20;
// Long-axis AABB growth ceiling (square@45° ≈ 1.41×); rejects non-rigid blow-ups before the model fit.
const ROTATION_MAX_SIZE_RATIO = 1.6;
// Relative slack when matching observed AABB to one rigid unrotated rectangle.
const ROTATION_RIGID_AABB_RATIO = 1.15;
// |cos2θ| below this → 45°-class sample; skip as an unrotated-size estimator (singular).
const ROTATION_RIGID_ESTIMATE_MIN_DET = 0.15;
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

/** Bucket items by a derived key, preserving insertion order within each bucket. */
function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const group = byKey.get(keyOf(item));
    if (group) group.push(item);
    else byKey.set(keyOf(item), [item]);
  }
  return byKey;
}

/** Bucket time-samples by their CSS selector so each element's trajectory can be
 * analyzed independently. Shared by rotation_pivot_drift and off_pivot_rotation. */
function groupBySelector<T extends { selector: string }>(samples: T[]): Map<string, T[]> {
  return groupBy(samples, (sample) => sample.selector);
}

/** Enough samples to establish a spin trajectory (one frame can't). */
function hasEnoughRotationSamples(group: RotationSample[]): boolean {
  return group.length >= ROTATION_MIN_SAMPLES;
}

/** Real spin, not a fixed tilt: the rotation angle actually varies across the grid. */
function isActuallySpinning(group: RotationSample[]): boolean {
  return maxAngleSpread(group.map((s) => s.angle)) > ROTATION_MIN_ANGLE_SPREAD_DEG;
}

/** AABB of an axis-aligned rectangle of size (elemW, elemH) after CSS rotation `angleDeg`. */
function aabbForRotatedRect(
  elemW: number,
  elemH: number,
  angleDeg: number,
): { w: number; h: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cosAbs = Math.abs(Math.cos(rad));
  const sinAbs = Math.abs(Math.sin(rad));
  return { w: elemW * cosAbs + elemH * sinAbs, h: elemW * sinAbs + elemH * cosAbs };
}

/** Invert one sample to unrotated (elemW, elemH); null when θ is near 45° (singular). */
function unrotatedSizeFromSample(sample: RotationSample): { w: number; h: number } | null {
  const rad = (sample.angle * Math.PI) / 180;
  const cosAbs = Math.abs(Math.cos(rad));
  const sinAbs = Math.abs(Math.sin(rad));
  const det = cosAbs * cosAbs - sinAbs * sinAbs; // cos(2θ)
  if (Math.abs(det) < ROTATION_RIGID_ESTIMATE_MIN_DET) return null;
  const elemW = (cosAbs * sample.w - sinAbs * sample.h) / det;
  const elemH = (cosAbs * sample.h - sinAbs * sample.w) / det;
  if (!(elemW > 0) || !(elemH > 0)) return null;
  return { w: elemW, h: elemH };
}

function aabbMatchesSample(expected: { w: number; h: number }, sample: RotationSample): boolean {
  if (expected.w <= 0 || expected.h <= 0 || sample.w <= 0 || sample.h <= 0) return false;
  return (
    Math.max(expected.w, sample.w) / Math.min(expected.w, sample.w) <= ROTATION_RIGID_AABB_RATIO &&
    Math.max(expected.h, sample.h) / Math.min(expected.h, sample.h) <= ROTATION_RIGID_AABB_RATIO
  );
}

function isSingularRotationAngle(angleDeg: number): boolean {
  const rad = (angleDeg * Math.PI) / 180;
  const cosAbs = Math.abs(Math.cos(rad));
  const sinAbs = Math.abs(Math.sin(rad));
  return Math.abs(cosAbs * cosAbs - sinAbs * sinAbs) < ROTATION_RIGID_ESTIMATE_MIN_DET;
}

function isNearSquareAabb(sample: RotationSample): boolean {
  if (sample.w <= 0 || sample.h <= 0) return false;
  return Math.max(sample.w, sample.h) / Math.min(sample.w, sample.h) <= ROTATION_RIGID_AABB_RATIO;
}

/**
 * All samples are 45°-class (no invertible estimator): a rigid rectangle projects to one
 * near-square AABB size at every such phase, so mutual AABB agreement is the rigidity proof.
 */
function fitsSingularPhaseRigidProjection(group: RotationSample[]): boolean {
  if (group.length === 0 || !group.every((s) => isSingularRotationAngle(s.angle))) return false;
  if (!group.every(isNearSquareAabb)) return false;
  const ref = group[0];
  if (!ref) return false;
  return group.every((sample) => aabbMatchesSample({ w: ref.w, h: ref.h }, sample));
}

/**
 * Every sample's AABB matches one fixed unrotated rectangle spun by that sample's angle.
 * Scale/entrance fails; partial-arc and all-singular (45°-class) rigid spins still pass.
 */
function fitsOneRigidRectangle(group: RotationSample[]): boolean {
  for (const ref of group) {
    const size = unrotatedSizeFromSample(ref);
    if (!size) continue;
    if (
      group.every((sample) =>
        aabbMatchesSample(aabbForRotatedRect(size.w, size.h, sample.angle), sample),
      )
    ) {
      return true;
    }
  }
  return fitsSingularPhaseRigidProjection(group);
}

/** Rigid spin: long AABB side stays bounded, and all samples fit one rotated rectangle. */
function isRotationSizeStable(group: RotationSample[]): boolean {
  if (group.some((s) => s.w <= 0 || s.h <= 0)) return false;
  const longSides = group.map((s) => Math.max(s.w, s.h));
  const minLong = Math.min(...longSides);
  if (minLong <= 0) return false;
  if (Math.max(...longSides) / minLong > ROTATION_MAX_SIZE_RATIO) return false;
  return fitsOneRigidRectangle(group);
}

/** Skip tiny decorative spinners; only sizable rotating figures matter. */
function isSizableRotation(group: RotationSample[]): boolean {
  return median(group.map((s) => s.w * s.h)) >= ROTATION_MIN_MEDIAN_AREA_PX;
}

/** Size/motion FP gates before the viewport-dependent center-drift test. */
function isRotationDriftCandidate(group: RotationSample[]): boolean {
  return (
    hasEnoughRotationSamples(group) &&
    isActuallySpinning(group) &&
    isRotationSizeStable(group) &&
    isSizableRotation(group)
  );
}

/** Flags a spinning element whose bbox center drifts — wrong transformOrigin/svgOrigin (elongated rotators included). */
export function detectRotationPivotDrift(
  samples: RotationSample[],
  canvas: Canvas,
): AnchoredLayoutIssue[] {
  const findings: AnchoredLayoutIssue[] = [];
  const viewportFloor = ROTATION_DRIFT_VIEWPORT_FRACTION * Math.min(canvas.width, canvas.height);
  for (const group of groupBySelector(samples).values()) {
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

// off_pivot_rotation thresholds. A pointer must actually sweep, sit on a
// resolvable dial hub, and its recovered center-of-rotation must land far from
// that hub relative to the pointer's own length.
//
// The fit MUST be OVERDETERMINED: any 3 non-collinear points fit a circle with
// ~zero residual, so a 3-sample "clean circle" guard is vacuous — arbitrary
// endpoint deformation or translation would read as a perfect orbit. Require
// >=5 distinct time-samples so the least-squares residual actually measures
// whether the trajectory lies on one circle.
const INDICATOR_MIN_SAMPLES = 5;
const INDICATOR_MIN_ANGLE_SPREAD_DEG = 20;
const INDICATOR_MIN_HUB_CIRCLES = 2;
// The Kåsa fit's RMS residual normalized by the fitted radius. With >=5 samples
// a genuine rotation lands well under this; non-circular motion (deformation,
// translation, skew, jitter/scatter) blows past it, so we skip rather than
// misread it as an off-hub pivot.
const INDICATOR_MAX_FIT_RESIDUAL_FRACTION = 0.05;
// Rigid-body guard: rotation preserves shape, so the pairwise distance between
// the two tracked material points must stay ~constant. If it swings more than
// this fraction of its median across the window the element is deforming, not
// rotating rigidly — do not flag.
const INDICATOR_MAX_RIGID_LEN_VARIATION = 0.15;
// Drift beyond this fraction of the pointer length is a wrong pivot. A correctly
// hubbed needle recovers a center within a few px of the hub (≈0); a base/edge
// pivot mistake puts the recovered center a large fraction of the needle away.
const INDICATOR_DRIFT_LENGTH_FRACTION = 0.35;

interface CircleFit {
  cx: number;
  cy: number;
  radius: number;
  residual: number;
}

/** Kåsa algebraic circle fit; null when the points are near-collinear/degenerate
 * (no stable center recoverable).
 *
 * KEEP IN SYNC with `fitCirclePoints` in
 * packages/cli/src/commands/layout-audit.browser.js — the browser sampler needs
 * the same fit to resolve arc-drawn dial hubs, but it is injected as a raw
 * string (no import across the puppeteer boundary), so the math is intentionally
 * duplicated per-language. Any change to the algorithm must land in both. */
function fitCircle(points: Array<{ x: number; y: number }>): CircleFit | null {
  const count = points.length;
  if (count < 3) return null;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / count;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / count;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const point of points) {
    const u = point.x - meanX;
    const v = point.y - meanY;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const determinant = suu * svv - suv * suv;
  if (Math.abs(determinant) < 1e-6) return null;
  const rhsU = (suuu + suvv) / 2;
  const rhsV = (svvv + svuu) / 2;
  const uc = (rhsU * svv - rhsV * suv) / determinant;
  const vc = (rhsV * suu - rhsU * suv) / determinant;
  const cx = uc + meanX;
  const cy = vc + meanY;
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / count);
  // RMS radial residual: penalizes any point straying off the fitted circle
  // more sharply than a mean-absolute error, so an overdetermined fit exposes
  // non-circular trajectories instead of averaging them away.
  let squaredError = 0;
  for (const point of points) {
    const delta = Math.hypot(point.x - cx, point.y - cy) - radius;
    squaredError += delta * delta;
  }
  return { cx, cy, radius, residual: Math.sqrt(squaredError / count) };
}

/** A dial hub that is present for a SUSTAINED majority of the sampled window,
 * not just the final frame — a transient single-frame hub is not a reliable
 * anchor. The representative center is the median across the frames that carry
 * one, so a stray frame can't yank it. */
const INDICATOR_MIN_HUB_PRESENCE_FRACTION = 0.6;

interface ResolvedHub {
  hx: number;
  hy: number;
}

function resolveHub(group: OffPivotRotationSample[]): ResolvedHub | null {
  const present = group.filter(
    (s) => s.hx !== null && s.hy !== null && s.hubCount >= INDICATOR_MIN_HUB_CIRCLES,
  );
  if (present.length < INDICATOR_MIN_HUB_PRESENCE_FRACTION * group.length) return null;
  const hx = median(present.map((s) => s.hx as number));
  const hy = median(present.map((s) => s.hy as number));
  return { hx, hy };
}

/** Rigid-body guard: a rotation preserves the figure's shape, so the distance
 * between the two tracked material points stays ~constant. Arbitrary endpoint
 * deformation (morphing, stretching) changes it — reject so it isn't misread as
 * an off-hub orbit. */
function isRigidBody(group: OffPivotRotationSample[]): boolean {
  const lengths = group.map((s) => s.len).filter((len) => len > 0);
  if (lengths.length < group.length) return false;
  const mid = median(lengths);
  if (mid <= 0) return false;
  const spread = Math.max(...lengths) - Math.min(...lengths);
  return spread <= INDICATOR_MAX_RIGID_LEN_VARIATION * mid;
}

/** Recover the center-of-rotation from whichever major-axis endpoint traces the
 * larger orbit (more movement → more numerically stable), rejecting scattered
 * fits. The fit is OVERDETERMINED (>=INDICATOR_MIN_SAMPLES points) so a high RMS
 * residual genuinely means the trajectory is not one circle. */
function recoverPivot(group: OffPivotRotationSample[]): CircleFit | null {
  if (group.length < INDICATOR_MIN_SAMPLES) return null;
  const endpointA = group.map((s) => ({ x: s.ax, y: s.ay }));
  const endpointB = group.map((s) => ({ x: s.bx, y: s.by }));
  const fits = [fitCircle(endpointA), fitCircle(endpointB)].filter(
    (fit): fit is CircleFit => fit !== null,
  );
  if (fits.length === 0) return null;
  // Scoped-known blind spot: we keep the wider-radius endpoint fit and, if it
  // fails the residual gate below, return null rather than falling back to the
  // narrower fit. Deliberately conservative — a missed pointer (false negative)
  // over threading both fits and risking a spurious pivot on a noisy arc.
  const best = fits.reduce((widest, fit) => (fit.radius > widest.radius ? fit : widest));
  if (best.radius <= 0) return null;
  if (best.residual > INDICATOR_MAX_FIT_RESIDUAL_FRACTION * best.radius) return null;
  return best;
}

/** An off-pivot sample with its frame time reattached for grouping/annotation.
 * The wire shape ({@link OffPivotFrame}) hoists time to the frame; the detector
 * flattens back to timed samples so the last frame's time anchors the finding. */
type TimedIndicatorSample = OffPivotRotationSample & { time: number };

function offPivotRotationFinding(
  group: TimedIndicatorSample[],
  drift: number,
): AnchoredLayoutIssue | null {
  const last = group[group.length - 1];
  if (!last) return null;
  const rect: LayoutRect = {
    left: Math.min(last.ax, last.bx) - 4,
    top: Math.min(last.ay, last.by) - 4,
    right: Math.max(last.ax, last.bx) + 4,
    bottom: Math.max(last.ay, last.by) + 4,
    width: Math.abs(last.bx - last.ax) + 8,
    height: Math.abs(last.by - last.ay) + 8,
  };
  return {
    code: "off_pivot_rotation",
    severity: "warning",
    time: last.time,
    selector: last.selector,
    dataAttributes: {},
    sourceFile: "index.html",
    bbox: rectToBbox(rect),
    rect,
    message: `Gauge/dial pointer rotates about a point ${Math.round(drift)}px from the dial hub — its center-of-rotation is off the hub, so it points wrong or overshoots the track (check the rotating group's pivot: translate to the hub before rotate, or set svgOrigin/transform-origin to the hub).`,
    fixHint:
      "The pointer's center-of-rotation must coincide with the dial hub. Rotate the group about the hub (e.g. transform-origin/svgOrigin set to the hub center, or translate the group so its rotation pivot lands on the hub) rather than about the element's own bbox center.",
  };
}

/**
 * off_pivot_rotation: a gauge needle / clock hand / radar sweep / dial pointer
 * that rotates about the WRONG pivot — its center-of-rotation is far from the
 * dial's hub, so the pointer aims wrong, runs off the track, or leaves the canvas.
 *
 * This is a HUB-REFERENCED check by necessity: a correctly-swept needle's bbox
 * center orbits identically to a broken one (the pivot sits at the needle's
 * base/edge either way), so no element-intrinsic measure separates them. The
 * browser sampler records two fixed MATERIAL points on the pointer per frame; a
 * circle fit recovers the true center-of-rotation, which is then compared to the
 * dial's static hub (the screen point shared by the most non-rotating circles).
 *
 * FP guards are strict and STRUCTURAL (evaluated across the whole sampled
 * window, not a single frame): requires real sweep (angle varies), a hub present
 * for a sustained majority of frames (≥2 concentric static circles), a
 * rigid-body trajectory (the two tracked points keep a constant separation), an
 * OVERDETERMINED circle fit (≥5 samples, low RMS residual), and drift exceeding a
 * fraction of the pointer's own length. When no sustained hub reference resolves
 * it does not fire, so a lone decorative rotator can't trip it.
 */
interface IndicatorCandidate {
  hubKey: string;
  angleAboutHub: number;
  drift: number;
  length: number;
  finding: AnchoredLayoutIssue | null;
}

/** Distinct angular positions about the hub among a set of candidates (nested
 * blade parts share one angle; orbiting bodies spread to several). Exported for
 * direct unit coverage of the multi-body/orbit-atom suppression guard. */
export function countAngularBodies(angles: number[]): number {
  const clusters: number[] = [];
  for (const angle of angles) {
    if (
      !clusters.some((rep) => Math.min(Math.abs(angle - rep), 360 - Math.abs(angle - rep)) <= 25)
    ) {
      clusters.push(angle);
    }
  }
  return clusters.length;
}

/** The pointer's angular position about the resolved hub, averaged across the
 * window so the multi-body clustering compares a stable per-body angle rather
 * than a single-frame snapshot. */
function angleAboutHub(group: OffPivotRotationSample[], hub: ResolvedHub): number {
  const midX = median(group.map((s) => (s.ax + s.bx) / 2));
  const midY = median(group.map((s) => (s.ay + s.by) / 2));
  return (Math.atan2(midY - hub.hy, midX - hub.hx) * 180) / Math.PI;
}

/** Gate one element's samples into a candidate, applying every structural FP
 * guard. Returns null when the element is not an off-pivot-able dial pointer. */
function buildIndicatorCandidate(group: TimedIndicatorSample[]): IndicatorCandidate | null {
  if (group.length < INDICATOR_MIN_SAMPLES) return null;
  if (maxAngleSpread(group.map((s) => s.angle)) <= INDICATOR_MIN_ANGLE_SPREAD_DEG) return null;
  const hub = resolveHub(group);
  if (!hub) return null;
  if (!isRigidBody(group)) return null;
  const pivot = recoverPivot(group);
  if (!pivot) return null;
  const drift = Math.hypot(pivot.cx - hub.hx, pivot.cy - hub.hy);
  const length = median(group.map((s) => s.len));
  const eligible = drift > INDICATOR_DRIFT_LENGTH_FRACTION * length;
  return {
    // Scoped-known blind spot: hubs bucketed by rounded screen coords, so two
    // separate dials whose screen hubs land in the same 5px bucket merge into
    // one multi-body group (rare — distinct dials stacked at ~identical screen
    // position). Key by owning <svg> identity if that pattern shows up.
    hubKey: `${Math.round(hub.hx / 5)}:${Math.round(hub.hy / 5)}`,
    angleAboutHub: angleAboutHub(group, hub),
    drift,
    length,
    finding: eligible ? offPivotRotationFinding(group, drift) : null,
  };
}

/** Per hub: multiple bodies at distinct angular positions = an orbit/atom/radial
 * system, not a single dial pointer — suppress. A real pointer (group + nested
 * blades) collapses to one angular cluster. Otherwise emit one finding per hub,
 * keeping the longest pointer. */
function selectHubFindings(candidates: IndicatorCandidate[]): AnchoredLayoutIssue[] {
  const byHub = groupBy(candidates, (candidate) => candidate.hubKey);
  const findings: AnchoredLayoutIssue[] = [];
  for (const group of byHub.values()) {
    // Count angular bodies only over ELIGIBLE (off-pivot) candidates. Sibling
    // hands that are correctly hubbed (finding === null) are not orbiting
    // bodies, so counting them would falsely suppress a lone off-pivot hand on
    // a multi-hand clock/dial whose other hands pivot correctly.
    const eligible = group.filter((c) => c.finding !== null);
    if (countAngularBodies(eligible.map((c) => c.angleAboutHub)) >= 2) continue;
    const best = group
      .filter((c) => c.finding !== null)
      .reduce<IndicatorCandidate | null>(
        (max, c) => (!max || c.length > max.length ? c : max),
        null,
      );
    if (best?.finding) findings.push(best.finding);
  }
  return findings;
}

export function detectOffPivotRotation(frames: OffPivotFrame[]): AnchoredLayoutIssue[] {
  const timed: TimedIndicatorSample[] = frames.flatMap((frame) =>
    frame.samples.map((sample) => ({ ...sample, time: frame.time })),
  );
  const candidates: IndicatorCandidate[] = [];
  for (const group of groupBySelector(timed).values()) {
    const candidate = buildIndicatorCandidate(group);
    if (candidate) candidates.push(candidate);
  }
  return selectHubFindings(candidates);
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
  const offPivotFindings = detectOffPivotRotation(collected.indicatorFrames);
  const contrast = buildContrastResults(collected.contrastEntries);
  return {
    duration: grid.duration,
    layoutSamples: grid.layoutSamples,
    transitionSamples: grid.transitionSamples,
    transitionSamplesDropped: grid.transitionSamplesDropped,
    runtimeFindings: [],
    layoutIssues: [
      ...collected.layoutIssues,
      ...sweepFindings,
      ...rotationFindings,
      ...offPivotFindings,
    ],
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
