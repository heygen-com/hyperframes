import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { parseAt } from "./layout.js";
import { c } from "../ui/colors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
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
import type { CaptionZoneOptions, FrameCheckOptions } from "../utils/checkTypes.js";

export const examples: Example[] = [
  ["Run the full verification gate", "hyperframes check"],
  ["Output one agent-readable envelope", "hyperframes check --json"],
  ["Persist the five audited contrast frames", "hyperframes check --snapshots"],
  ["Also fail on warnings", "hyperframes check --strict"],
];

export interface CheckCommandDependencies {
  resolveProject(dir: string | undefined): ProjectDir;
  runPipeline(project: ProjectDir, options: CheckOptions): Promise<CheckReport>;
  withMeta(value: object): object;
}

const DEFAULT_COMMAND_DEPENDENCIES: CheckCommandDependencies = {
  resolveProject,
  runPipeline: runCheckPipeline,
  withMeta,
};

export function createCheckCommand(
  dependencies: CheckCommandDependencies = DEFAULT_COMMAND_DEPENDENCIES,
) {
  return defineCommand({
    meta: {
      name: "check",
      description:
        "Run lint, runtime, layout, motion, and WCAG contrast verification in one browser session",
    },
    args: {
      dir: { type: "positional", description: "Project directory", required: false },
      json: { type: "boolean", description: "Output agent-readable JSON", default: false },
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
        description: "Ms to wait for scripts and media to settle initially (default: 3000)",
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
      snapshots: {
        type: "boolean",
        description: "Save the five contrast-pass PNGs under snapshots/",
        default: false,
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
    },
    async run({ args }) {
      const asJson = args.json === true;

      try {
        const project = dependencies.resolveProject(args.dir);
        const options = parseCheckOptions(args);
        if (!asJson) {
          console.log(`${c.accent("◆")}  Checking ${c.accent(project.name)}`);
        }
        const report = await dependencies.runPipeline(project, options);
        if (asJson) {
          console.log(JSON.stringify(dependencies.withMeta(report), null, 2));
        } else {
          printHumanReport(report);
        }
        process.exitCode = checkExitCode(report);
      } catch (error) {
        const message = normalizeErrorMessage(error);
        if (asJson) {
          console.log(
            JSON.stringify(dependencies.withMeta({ ok: false, error: message }), null, 2),
          );
        } else {
          console.error(`${c.error("✗")} Check failed: ${message}`);
        }
        process.exitCode = 1;
      }
    },
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
  };
}

const CAPTION_ZONE_FIELDS = new Set(["x0", "y0", "x1", "y1", "severity", "seek"]);

const FRAME_CHECK_FIELDS = new Set(["severity", "seek", "tol"]);

// Mirrors --caption-zone's spec grammar so the EF bridge's severity/seek/tol
// options survive the migration instead of being silently dropped by a
// boolean flag (bare --frame-check keeps today's defaults).
export function parseFrameCheck(value: unknown): FrameCheckOptions | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true || value === "") return {};
  if (typeof value !== "string") throw frameCheckError();
  const fields = parseFrameCheckFields(value);
  const severity = captionSeverity(fields.get("severity"));
  const seek = captionSeeks(fields.get("seek"));
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
    const { key, entry } = parseCaptionField(part);
    if (!FRAME_CHECK_FIELDS.has(key) || fields.has(key)) throw frameCheckError();
    fields.set(key, entry);
  }
  return fields;
}

function parseFrameCheckTolerance(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const tol = Number.parseFloat(raw);
  if (!Number.isFinite(tol) || tol < 0) throw frameCheckError();
  return tol;
}

function frameCheckError(): Error {
  return new Error(
    'Invalid --frame-check: use bare --frame-check or "severity=warning|error;seek=.25,.75;tol=4" (all fields optional)',
  );
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

function parseCaptionField(part: string): { key: string; entry: string } {
  const separator = part.indexOf("=");
  if (separator <= 0) throw captionZoneError();
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
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function captionSeverity(value: string | undefined): "error" | "warning" | undefined {
  if (value === undefined) return undefined;
  if (value === "error" || value === "warning") return value;
  throw captionZoneError();
}

function captionSeeks(value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  if (value === "") return [];
  const values = value.split(",").map(captionFraction);
  if (values.some((entry) => entry === null)) throw captionZoneError();
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

function printHumanReport(report: CheckReport): void {
  printSection("Lint", report.lint);
  printSection("Runtime", report.runtime);
  printLayoutSection("Layout", report.layout);
  printSection("Motion", report.motion);
  printContrastSection(report);
  printSnapshotSection(report);
  console.log();
  const label = report.ok ? c.success("Check passed") : c.error("Check failed");
  console.log(`${report.ok ? c.success("◇") : c.error("◇")}  ${label}`);
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
