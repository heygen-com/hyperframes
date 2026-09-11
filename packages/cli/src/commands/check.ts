import { defineCommand, parseArgs } from "citty";
import type { ArgsDef } from "citty";
import type { Example } from "./_examples.js";
import { parseAt } from "./layout.js";
import { c } from "../ui/colors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { formatLayoutIssue } from "../utils/layoutAudit.js";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  DEFAULT_CHECK_OPTIONS,
  checkExitCode,
  runCheckPipeline,
  type CheckFinding,
  type CheckOptions,
  type CheckReport,
  type CheckSection,
} from "../utils/checkPipeline.js";
import type { CaptionZoneOptions, FrameCheckOptions, LayoutOptions } from "../utils/checkTypes.js";
import { resolveLocalBrowserGpuMode } from "../browser/gpuPolicy.js";
import type { GoldenGateOptions, GoldenSummary } from "../golden/baseline.js";

export const examples: Example[] = [
  ["Run the full verification gate", "hyperframes check"],
  ["Output one agent-readable envelope", "hyperframes check --json"],
  ["Gate against committed golden baselines", "hyperframes check --golden"],
  ["Refresh the golden baselines", "hyperframes check --update-golden"],
  ["Persist the five audited contrast frames", "hyperframes check --snapshots"],
  ["Also fail on warnings", "hyperframes check --strict"],
];

export interface CheckCommandDependencies {
  resolveProject(dir: string | undefined): ProjectDir;
  runPipeline(project: ProjectDir, options: CheckOptions): Promise<CheckReport>;
  withMeta(value: object): object;
  /** Golden baseline gate; defaults to a lazy import so sharp only loads when requested. */
  runGolden?(project: ProjectDir, options: GoldenGateOptions): Promise<GoldenSummary>;
}

const DEFAULT_COMMAND_DEPENDENCIES: CheckCommandDependencies = {
  resolveProject,
  runPipeline: runCheckPipeline,
  withMeta,
};

const CHECK_COMMAND_ARGS = {
  dir: { type: "positional", description: "Project directory", required: false },
  json: { type: "boolean", description: "Output agent-readable JSON", default: false },
  // The sampling args below intentionally mirror the deprecated `layout`
  // command's grammar (check superseded it) — an inherited clone, not new code.
  // fallow-ignore-next-line code-duplication
  samples: {
    type: "string",
    description: "Number of midpoint samples across the duration (default: 9)",
    default: "9",
  },
  at: {
    type: "string",
    description: "Comma-separated timestamps in seconds (e.g., --at 1.5,4,7.25)",
  },
  "at-transitions": {
    type: "boolean",
    description:
      "Also sample at every tween start/end boundary (plus segment midpoints) to catch transient overlaps at transition seams",
    default: false,
  },
  "max-transition-samples": {
    type: "string",
    description:
      "Optional cap on transition-derived samples; when it truncates, the omitted count is reported (default: unlimited)",
  },
  "max-issues": {
    type: "string",
    description: "Maximum issues to print or return after static collapse (default: 80)",
    default: "80",
  },
  "collapse-static": {
    type: "boolean",
    description: "Collapse repeated static issues across samples (default: true)",
    default: true,
  },
  tolerance: {
    type: "string",
    description: "Allowed pixel overflow before reporting an issue (default: 2)",
    default: "2",
  },
  timeout: {
    type: "string",
    description:
      "Initial render-ready timeout in ms; also sets the navigation minimum (10s floor, default: 3000)",
    default: "3000",
  },
  contrast: {
    type: "boolean",
    description: "Run the WCAG AA contrast pass (enabled by default)",
    default: true,
  },
  strict: {
    type: "boolean",
    description: "Exit non-zero on warnings too",
    default: false,
  },
  proxy: {
    type: "boolean",
    description:
      "Auto-transcode browser-hostile video codecs (default: hyperframes.json media.autoProxy, which defaults on)",
    default: undefined,
  },
  "browser-gpu": {
    type: "boolean",
    description:
      "Use hardware browser GPU capture; pass --no-browser-gpu for deterministic SwiftShader (default: auto-detect, PRODUCER_BROWSER_GPU_MODE overrides)",
    default: undefined,
  },
  snapshots: {
    type: "boolean",
    description: "Save the five contrast-pass PNGs under snapshots/",
    default: false,
  },
  golden: {
    type: "boolean",
    description:
      "Also gate against committed golden baselines (golden/<compositionId>/<timeMs>.png): re-capture at the manifest times, pixel-diff, and fail on regressions",
    default: false,
  },
  "update-golden": {
    type: "boolean",
    description: "Refresh the golden baselines from the current render instead of gating",
    default: false,
  },
  "golden-threshold": {
    type: "string",
    description:
      "Per-channel pixel tolerance for the golden gate, 0-1 (default: golden.json threshold, else 0.1)",
  },
  "caption-zone": {
    type: "string",
    description:
      'Caption band "x0=0;y0=.82;x1=1;y1=1[;severity=warning|error][;seek=.5,1]" (fractions 0-1; defaults: warning, seek=1)',
  },
  "frame-check": {
    type: "string",
    description:
      'Bare --frame-check uses defaults (tol=2px, severity=warning, seek=.5; breach floor=max(120px, 6% of shorter canvas edge)); or pass "severity=error;seek=.25,.75;tol=4" to tune',
  },
  layout: {
    type: "string",
    description: 'Layout knobs: "proseCoverageFloor=0.05" (0–1; default 0.15).',
  },
} satisfies ArgsDef;

export function createCheckCommand(
  dependencies: CheckCommandDependencies = DEFAULT_COMMAND_DEPENDENCIES,
) {
  return defineCommand({
    meta: {
      name: "check",
      description:
        "Run lint, runtime, layout, motion, and WCAG contrast verification in one browser session",
    },
    args: CHECK_COMMAND_ARGS,
    async run({ rawArgs }) {
      const args = parseArgs(normalizeFrameCheckRawArgs(rawArgs), CHECK_COMMAND_ARGS);
      const asJson = args.json === true;

      try {
        setCommandExitCode(await executeCheck(dependencies, args, asJson));
      } catch (error) {
        const message = normalizeErrorMessage(error);
        if (asJson) {
          console.log(
            JSON.stringify(dependencies.withMeta({ ok: false, error: message }), null, 2),
          );
        } else {
          console.error(`${c.error("✗")} Check failed: ${message}`);
        }
        setCommandExitCode(1);
      }
    },
  });
}

async function resolveGoldenSummary(
  dependencies: CheckCommandDependencies,
  project: ProjectDir,
  goldenOptions: GoldenGateOptions | undefined,
): Promise<GoldenSummary | undefined> {
  if (!goldenOptions) return undefined;
  const runGolden = dependencies.runGolden ?? (await import("../golden/baseline.js")).runGoldenGate;
  return runGolden(project, goldenOptions);
}

function emitCheckReport(
  dependencies: CheckCommandDependencies,
  report: CheckReport,
  golden: GoldenSummary | undefined,
  ok: boolean,
  asJson: boolean,
): void {
  if (!asJson) {
    printHumanReport(report, golden);
    return;
  }
  const payload = golden ? { ...report, ok, golden } : report;
  console.log(JSON.stringify(dependencies.withMeta(payload), null, 2));
}

async function executeCheck(
  dependencies: CheckCommandDependencies,
  args: Record<string, unknown>,
  asJson: boolean,
): Promise<0 | 1> {
  const project = dependencies.resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const options = parseCheckOptions(args);
  const goldenOptions = parseGoldenGateArgs(args, options);
  if (!asJson) {
    console.log(`${c.accent("◆")}  Checking ${c.accent(project.name)}`);
  }
  const report = await dependencies.runPipeline(project, options);
  const golden = await resolveGoldenSummary(dependencies, project, goldenOptions);
  const ok = checkExitCode(report) === 0 && (golden?.ok ?? true);
  emitCheckReport(dependencies, report, golden, ok, asJson);
  return ok ? 0 : 1;
}

function normalizeFrameCheckRawArgs(rawArgs: string[]): string[] {
  return rawArgs.map((arg, index) => {
    if (arg !== "--frame-check") return arg;
    const next = rawArgs[index + 1];
    return next === undefined || next.startsWith("-") ? "--frame-check=" : arg;
  });
}

function parseCheckOptions(args: Record<string, unknown>): CheckOptions {
  const maxTransitionSamples = positiveInteger(args["max-transition-samples"], 0);
  return {
    samples: positiveInteger(args.samples, DEFAULT_CHECK_OPTIONS.samples),
    at: parseAt(args.at),
    atTransitions: args["at-transitions"] === true,
    maxTransitionSamples: maxTransitionSamples > 0 ? maxTransitionSamples : undefined,
    maxIssues: positiveInteger(args["max-issues"], DEFAULT_CHECK_OPTIONS.maxIssues),
    collapseStatic: args["collapse-static"] !== false,
    tolerance: nonNegativeNumber(args.tolerance, DEFAULT_CHECK_OPTIONS.tolerance),
    timeout: Math.max(500, positiveInteger(args.timeout, DEFAULT_CHECK_OPTIONS.timeout)),
    contrast: args.contrast !== false,
    strict: args.strict === true,
    snapshots: args.snapshots === true,
    captionZone: parseCaptionZone(args["caption-zone"]),
    frameCheck: parseFrameCheck(args["frame-check"]),
    layout: parseLayout(args.layout),
    autoProxy: args.proxy as boolean | undefined,
    browserGpuMode: resolveLocalBrowserGpuMode(args["browser-gpu"] as boolean | undefined),
  };
}

/**
 * `--golden` / `--update-golden` / `--golden-threshold` → gate options, or
 * undefined when the golden gate was not requested. The threshold flag alone
 * does not enable the gate — it only tunes an explicitly requested run.
 */
export function parseGoldenGateArgs(
  args: Record<string, unknown>,
  options: Pick<CheckOptions, "timeout" | "autoProxy" | "browserGpuMode">,
): GoldenGateOptions | undefined {
  const update = args["update-golden"] === true;
  if (args.golden !== true && !update) return undefined;
  return {
    update,
    threshold: parseGoldenThreshold(args["golden-threshold"]),
    timeoutMs: options.timeout,
    autoProxy: options.autoProxy,
    browserGpuMode: options.browserGpuMode,
  };
}

export function parseGoldenThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === "string" ? value.trim() : "";
  const parsed = parseNumberStrict(raw);
  if (parsed === null || parsed < 0 || parsed > 1) {
    throw new Error("Invalid --golden-threshold: expected a number from 0 to 1");
  }
  return parsed;
}

const CAPTION_ZONE_FIELDS = new Set(["x0", "y0", "x1", "y1", "severity", "seek"]);

const FRAME_CHECK_FIELDS = new Set(["severity", "seek", "tol"]);

const LAYOUT_FIELDS = new Set(["proseCoverageFloor"]);

// Mirrors --caption-zone's spec grammar so the EF bridge's severity/seek/tol
// options survive the migration instead of being silently dropped by a
// boolean flag (bare --frame-check keeps today's defaults).
export function parseFrameCheck(value: unknown): FrameCheckOptions | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true || value === "") return {};
  if (typeof value !== "string") throw frameCheckError();
  if (value.startsWith("-")) throw swallowedOptionError("frame-check", value);
  const fields = parseFrameCheckFields(value);
  const severity = captionSeverity(fields.get("severity"), frameCheckError);
  const seek = captionSeeks(fields.get("seek"), frameCheckError);
  const tol = parseFrameCheckTolerance(fields.get("tol"));
  return {
    ...(severity ? { severity } : {}),
    ...(seek ? { seek } : {}),
    ...(tol !== undefined ? { tol } : {}),
  };
}

function parseFrameCheckFields(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const { key, entry } = parseCaptionField(part, frameCheckError);
    if (!FRAME_CHECK_FIELDS.has(key) || fields.has(key)) throw frameCheckError();
    fields.set(key, entry);
  }
  return fields;
}

function parseFrameCheckTolerance(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const tol = parseNumberStrict(raw);
  if (tol === null || tol < 0) throw frameCheckError();
  return tol;
}

function frameCheckError(): Error {
  return new Error(
    'Invalid --frame-check: use bare --frame-check or "severity=warning|error;seek=.25,.75;tol=4" (all fields optional)',
  );
}

function swallowedOptionError(flag: string, value: string): Error {
  return new Error(
    `Invalid --${flag}: value "${value}" appears to have swallowed the next option; use --${flag}= or move --${flag} to the end`,
  );
}

/** Parse `--layout "proseCoverageFloor=0.05"` (semicolon-separated key=value, like caption-zone). */
export function parseLayout(value: unknown): LayoutOptions | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true || value === "") throw layoutError();
  if (typeof value !== "string") throw layoutError();
  const fields = parseLayoutFields(value);
  const proseCoverageFloor = parseProseCoverageFloor(fields.get("proseCoverageFloor"));
  if (proseCoverageFloor === undefined) throw layoutError();
  return { proseCoverageFloor };
}

function parseLayoutFields(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw layoutError();
    const key = trimmed.slice(0, separator).trim();
    const entry = trimmed.slice(separator + 1).trim();
    if (!LAYOUT_FIELDS.has(key) || fields.has(key)) throw layoutError();
    fields.set(key, entry);
  }
  return fields;
}

function parseProseCoverageFloor(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const floor = parseNumberStrict(raw);
  if (floor === null || floor < 0 || floor > 1) throw layoutError();
  return floor;
}

function layoutError(): Error {
  return new Error(
    'Invalid --layout: use "proseCoverageFloor=0.05" with a fraction from 0 to 1 (inclusive)',
  );
}

/** Reject trailing garbage that Number.parseFloat would silently accept (`4px`, `0.05abc`). */
function parseNumberStrict(raw: string): number | null {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseCaptionZone(value: unknown): CaptionZoneOptions | undefined {
  if (value === undefined || value === null) return undefined;
  const fields = parseCaptionFields(captionZoneString(value));
  const { x0, y0, x1, y1 } = parseCaptionBounds(fields);
  const severity = captionSeverity(fields.get("severity"));
  const seek = captionSeeks(fields.get("seek"));
  return {
    x0,
    y0,
    x1,
    y1,
    ...(severity ? { severity } : {}),
    ...(seek ? { seek } : {}),
  };
}

function captionZoneString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw captionZoneError();
  return value;
}

function parseCaptionFields(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const { key, entry } = parseCaptionField(part);
    if (!CAPTION_ZONE_FIELDS.has(key) || fields.has(key)) throw captionZoneError();
    fields.set(key, entry);
  }
  return fields;
}

function parseCaptionField(
  part: string,
  errorFactory: () => Error = captionZoneError,
): { key: string; entry: string } {
  const separator = part.indexOf("=");
  if (separator <= 0) throw errorFactory();
  return {
    key: part.slice(0, separator).trim(),
    entry: part.slice(separator + 1).trim(),
  };
}

function parseCaptionBounds(fields: Map<string, string>): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const x0 = requiredCaptionFraction(fields, "x0");
  const y0 = requiredCaptionFraction(fields, "y0");
  const x1 = requiredCaptionFraction(fields, "x1");
  const y1 = requiredCaptionFraction(fields, "y1");
  if (x0 > x1 || y0 > y1) throw captionZoneError();
  return { x0, y0, x1, y1 };
}

function requiredCaptionFraction(fields: Map<string, string>, key: string): number {
  const value = captionFraction(fields.get(key));
  if (value === null) throw captionZoneError();
  return value;
}

function captionFraction(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = parseNumberStrict(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function captionSeverity(
  value: string | undefined,
  errorFactory: () => Error = captionZoneError,
): "error" | "warning" | undefined {
  if (value === undefined) return undefined;
  if (value === "error" || value === "warning") return value;
  throw errorFactory();
}

function captionSeeks(
  value: string | undefined,
  errorFactory: () => Error = captionZoneError,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (value === "") return [];
  const values = value.split(",").map(captionFraction);
  if (values.some((entry) => entry === null)) throw errorFactory();
  return values.flatMap((entry) => (entry === null ? [] : entry));
}

function captionZoneError(): Error {
  return new Error(
    'Invalid --caption-zone; use "x0=0;y0=.82;x1=1;y1=1[;severity=warning|error][;seek=.5,1]" with fractions from 0 to 1.',
  );
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function printHumanReport(report: CheckReport, golden?: GoldenSummary): void {
  printSection("Lint", report.lint);
  printSection("Runtime", report.runtime);
  printLayoutSection("Layout", report.layout);
  printSection("Motion", report.motion);
  printContrastSection(report);
  printSnapshotSection(report);
  if (golden) printGoldenSection(golden);
  console.log();
  const ok = report.ok && (golden?.ok ?? true);
  const label = ok ? c.success("Check passed") : c.error("Check failed");
  console.log(`${ok ? c.success("◇") : c.error("◇")}  ${label}`);
}

function printGoldenSection(golden: GoldenSummary): void {
  console.log();
  console.log(c.bold("Golden"));
  if (golden.updated) {
    console.log(
      `  ${c.success("◇")} ${golden.baselines.length} baseline(s) written for ${golden.compositionId}`,
    );
    for (const baseline of golden.baselines) console.log(`    ${c.dim(baseline)}`);
    return;
  }
  if (golden.ok) {
    console.log(
      `  ${c.success("◇")} ${golden.compared}/${golden.compared} frame(s) match the committed baselines`,
    );
    return;
  }
  for (const failure of golden.failed) {
    const detail =
      failure.reason === "pixel-diff"
        ? `${(failure.diffRatio * 100).toFixed(3)}% pixels differ (max channel delta ${failure.maxDelta})`
        : failure.reason;
    console.log(`  ${c.error("✗")} t=${failure.time}s ${detail}`);
  }
  console.log(
    `  ${c.dim(`${golden.failed.length} of ${golden.compared} frame(s) regressed vs golden/${golden.compositionId}/`)}`,
  );
  if (golden.diffSheet) {
    console.log(`  ${c.dim(`Diff sheet: ${golden.diffSheet}`)}`);
  }
  console.log(
    `  ${c.dim("Intended change? Refresh baselines with hyperframes check --update-golden")}`,
  );
}

function printSection(title: string, section: CheckSection): void {
  console.log();
  console.log(c.bold(title));
  if (section.findings.length === 0) {
    console.log(`  ${c.success("◇")} 0 errors, 0 warnings`);
    return;
  }
  for (const finding of section.findings) printFinding(finding);
  printCounts(section);
}

function printLayoutSection(title: string, section: CheckReport["layout"]): void {
  console.log();
  console.log(c.bold(title));
  if (section.findings.length === 0) {
    console.log(`  ${c.success("◇")} 0 issues across ${section.samples.length} sample(s)`);
  } else {
    for (const finding of section.findings) {
      const formatted = formatLayoutIssue(finding).replace(/\n/g, "\n    ");
      console.log(`  ${findingIcon(finding)} ${formatted}`);
    }
    printCounts(section);
  }
  if (section.transitionSamplesDropped > 0) {
    console.log(
      `  ${c.warn("⚠")} ${section.transitionSamplesDropped} transition sample(s) omitted`,
    );
  }
}

function printContrastSection(report: CheckReport): void {
  const section = report.contrast;
  console.log();
  console.log(c.bold("Contrast"));
  if (!section.enabled) {
    console.log(`  ${c.dim("◇")} skipped`);
    return;
  }
  if (section.findings.length === 0) {
    console.log(
      `  ${c.success("◇")} ${section.passed}/${section.checked} text checks pass WCAG AA`,
    );
    return;
  }
  for (const finding of section.findings) {
    console.log(
      `  ${c.error("✗")} ${finding.selector} ${finding.ratio}:1 (need ${finding.requiredRatio}:1, t=${finding.time}s)`,
    );
    console.log(`    ${c.dim(`Try ${finding.suggestedColor}; source ${finding.sourceFile}`)}`);
  }
  printCounts(section);
}

function printSnapshotSection(report: CheckReport): void {
  console.log();
  console.log(c.bold("Snapshots"));
  if (!report.snapshots.enabled) {
    console.log(`  ${c.dim("◇")} disabled`);
  } else {
    console.log(`  ${c.success("◇")} ${report.snapshots.files.length} PNG(s) saved`);
    for (const file of report.snapshots.files) console.log(`    ${c.dim(file)}`);
    if (report.snapshots.findingFiles.length > 0) {
      console.log(
        `  ${c.success("◇")} ${report.snapshots.findingFiles.length} finding crop(s) saved`,
      );
      for (const file of report.snapshots.findingFiles) console.log(`    ${c.dim(file)}`);
    }
  }
}

function printFinding(finding: CheckFinding): void {
  const where = `${finding.sourceFile} ${finding.selector} t=${finding.time}s`;
  console.log(`  ${findingIcon(finding)} ${finding.code}: ${finding.message}`);
  console.log(`    ${c.dim(where)}`);
  if (finding.fixHint) console.log(`    ${c.dim(`Fix: ${finding.fixHint}`)}`);
}

function findingIcon(finding: CheckFinding): string {
  if (finding.severity === "error") return c.error("✗");
  if (finding.severity === "warning") return c.warn("⚠");
  return c.dim("ℹ");
}

function printCounts(section: CheckSection): void {
  console.log(
    `  ${c.dim(`${section.errorCount} error(s), ${section.warningCount} warning(s), ${section.infoCount} info(s)`)}`,
  );
}

export default createCheckCommand();
