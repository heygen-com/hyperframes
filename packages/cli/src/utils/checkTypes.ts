import type { ProjectLintResult } from "./lintProject.js";
import type { LayoutIssue, LayoutOverflow, LayoutRect } from "./layoutAudit.js";
import type { Canvas, MotionFrame } from "./motionAudit.js";
import type { MotionSpec } from "./motionSpec.js";
import type { ProjectDir } from "./project.js";

export interface CheckOptions {
  samples: number;
  at?: number[];
  atTransitions: boolean;
  maxTransitionSamples?: number;
  maxIssues: number;
  collapseStatic: boolean;
  tolerance: number;
  timeout: number;
  contrast: boolean;
  strict: boolean;
  snapshots: boolean;
  captionZone?: CaptionZoneOptions;
  frameCheck?: FrameCheckOptions;
  /** Explicit --proxy/--no-proxy override; undefined preserves project config. */
  autoProxy?: boolean;
}

export interface CaptionZoneOptions {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  severity?: "error" | "warning";
  seek?: number[];
}

export interface FrameCheckOptions {
  tol?: number;
  severity?: "error" | "warning";
  seek?: number[];
}

export type CheckSeverity = "error" | "warning" | "info";

export interface CheckBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CheckAnchor {
  selector: string;
  dataAttributes: Record<string, string>;
  sourceFile: string;
  bbox: CheckBbox;
  time: number;
}

export interface CheckFinding extends CheckAnchor {
  code: string;
  severity: CheckSeverity;
  message: string;
  text?: string;
  fixHint?: string;
  url?: string;
  line?: number;
}

export interface AnchoredLayoutIssue extends LayoutIssue, CheckAnchor {}

export interface ContrastAuditEntry extends CheckAnchor {
  text: string;
  ratio: number;
  wcagAA: boolean;
  large: boolean;
  fg: string;
  bg: string;
}

export interface CheckContrastFinding extends CheckFinding {
  fg: string;
  bg: string;
  ratio: number;
  requiredRatio: number;
  suggestedColor: string;
  large: boolean;
}

export interface ContrastCapture {
  entries: ContrastAuditEntry[];
  pngBase64: string;
}

export interface GeometryCandidateRequest {
  text: boolean;
  media: boolean;
  tolerance: number;
}

/** A labeled rectangle drawn on an overview frame's annotation overlay
 * (`check --snapshots`) so one screenshot orients an agent across every
 * error finding at that sample time. */
export interface CheckAnnotationBox {
  label: string;
  bbox: CheckBbox;
}

/** A single crop to capture for `check --snapshots`'s per-finding evidence
 * PNGs — filename and bbox already resolved by the pipeline. */
export interface CheckFindingCropRequest {
  filename: string;
  time: number;
  bbox: CheckBbox;
}

export interface CheckGeometryCandidate extends CheckAnchor {
  kind: "text" | "media";
  tag: string;
  text: string;
  rect: LayoutRect;
  elementRect: LayoutRect;
  overflow?: LayoutOverflow;
}

/** One rotatable element's geometry at a single seeked sample, produced by
 * `__hyperframesRotationSample` (layout-audit.browser.js) and accumulated
 * across the grid to detect `rotation_pivot_drift`. */
export interface RotationSample {
  time: number;
  selector: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export type MotionSpecResolution =
  | { kind: "none" }
  | { kind: "valid"; path: string; spec: MotionSpec }
  | { kind: "invalid"; path: string; message: string };

export interface CheckAuditDriver {
  initialize(contrast: boolean): Promise<void>;
  getDuration(): Promise<number>;
  getTransitionBoundaries(): Promise<number[]>;
  getCanvas(): Promise<Canvas>;
  findAmbiguousSelectors(selectors: string[]): Promise<AnchoredLayoutIssue[]>;
  seek(time: number): Promise<void>;
  collectLayout(time: number, tolerance: number): Promise<AnchoredLayoutIssue[]>;
  /** Frozen-sweep guard (#U10): an opaque per-sample geometry+opacity
   * fingerprint of the current seeked state, for detecting a timeline that
   * never advances under seek. See layout-audit.browser.js. */
  collectLayoutGeometry(): Promise<string>;
  /** rotation_pivot_drift: every rotatable element's bbox center/size/angle at
   * the current seeked state. Accumulated across the grid — see checkPipeline. */
  collectRotationSample(time: number): Promise<RotationSample[]>;
  collectGeometryCandidates(
    time: number,
    request: GeometryCandidateRequest,
  ): Promise<CheckGeometryCandidate[]>;
  collectMotionFrame(
    time: number,
    selectors: string[],
    livenessScopes: string[],
  ): Promise<MotionFrame>;
  anchorMotionIssues(issues: LayoutIssue[]): Promise<AnchoredLayoutIssue[]>;
  collectContrast(time: number, annotations?: CheckAnnotationBox[]): Promise<ContrastCapture>;
}

export interface CheckScreenshot {
  time: number;
  pngBase64: string;
}

export interface CheckTimings {
  launchSettleMs: number;
  seekLoopMs: number;
  contrastMs: number;
}

export interface CheckBrowserResult {
  duration: number;
  layoutSamples: number[];
  transitionSamples: number[];
  transitionSamplesDropped: number;
  runtimeFindings: CheckFinding[];
  layoutIssues: AnchoredLayoutIssue[];
  motionIssues: AnchoredLayoutIssue[];
  motionSampleCount: number;
  contrastSamples: number[];
  contrastFindings: CheckContrastFinding[];
  contrastChecked: number;
  contrastPassed: number;
  screenshots: CheckScreenshot[];
  timings: CheckTimings;
}

/** The seek-grid audit loop, injected into checkBrowser so it never imports checkPipeline back. */
export type RunAuditGrid = (
  driver: CheckAuditDriver,
  options: CheckOptions,
  motion: MotionSpecResolution,
) => Promise<CheckBrowserResult>;

export interface CheckSection<T extends CheckFinding = CheckFinding> {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: T[];
}

export interface CheckReport {
  ok: boolean;
  strict: boolean;
  lint: CheckSection & { filesScanned: number };
  runtime: CheckSection;
  layout: CheckSection<AnchoredLayoutIssue> & {
    duration: number;
    samples: number[];
    transitionSamples: number[];
    transitionSamplesDropped: number;
    tolerance: number;
    totalIssueCount: number;
    truncated: boolean;
  };
  motion: CheckSection & { enabled: boolean; specPath?: string; samples: number };
  contrast: CheckSection<CheckContrastFinding> & {
    enabled: boolean;
    samples: number[];
    checked: number;
    passed: number;
  };
  snapshots: { enabled: boolean; files: string[]; times: number[]; findingFiles: string[] };
}

export interface CheckDependencies {
  lintProject(projectDir: string): Promise<ProjectLintResult>;
  resolveMotionSpec(projectDir: string): MotionSpecResolution;
  runBrowserCheck(
    project: ProjectDir,
    options: CheckOptions,
    motion: MotionSpecResolution,
  ): Promise<CheckBrowserResult>;
  writeSnapshot(
    projectDir: string,
    index: number,
    time: number,
    pngBase64: string,
  ): Promise<string>;
  captureFindingCrops(
    project: ProjectDir,
    options: CheckOptions,
    requests: CheckFindingCropRequest[],
  ): Promise<string[]>;
}

export function rectToBbox(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): CheckBbox {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}
