import { captureArtifactRevision } from "../utils/artifactCapture.js";
import { pngDimensions } from "../utils/pngDimensions.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  recordArtifacts,
  type ArtifactCapture,
  type ArtifactInput,
  type ArtifactRecord,
} from "@hyperframes/studio-server/history";
import { formatFindingTimes } from "../utils/checkFindings.js";
import { withProjectLock } from "../utils/projectLock.js";
import { reportArtifacts } from "../utils/toolContext.js";
import { defineCommand, parseArgs } from "citty";
import type { ArgsDef } from "citty";
import type { Example } from "./_examples.js";
import { parseAt } from "./layout.js";
import { c } from "../ui/colors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { swallowedFlagUsageError } from "../utils/reject-unknown-flags.js";
import { formatLayoutIssue } from "../utils/layoutAudit.js";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  DEFAULT_CHECK_OPTIONS,
  checkExitCode,
  prelaunchBrowserForNextCheck,
  runCheckPipeline,
  selectFindingCropRequests,
  type CheckFinding,
  type CheckOptions,
  type CheckReport,
  type CheckSection,
} from "../utils/checkPipeline.js";
import type { CaptionZoneOptions, FrameCheckOptions, LayoutOptions } from "../utils/checkTypes.js";
import { resolveLocalBrowserGpuMode } from "../browser/gpuPolicy.js";
import { preResolveHostileMediaProxies, type PreparedMediaFile } from "../utils/checkBrowser.js";

export const examples: Example[] = [
  ["Run the full verification gate", "hyperframes check"],
  ["Output one agent-readable envelope", "hyperframes check --json"],
  ["Persist the five audited contrast frames", "hyperframes check --snapshots"],
  ["Also fail on warnings", "hyperframes check --strict"],
  ["Make only the browser-playable video copies, then exit", "hyperframes check --prepare-media"],
];

type SavedCheck = Pick<ArtifactRecord, "id" | "revision" | "report" | "attribution">;
type SavedCheckReport = CheckReport & { saved?: SavedCheck };

export interface CheckCommandDependencies {
  resolveProject(dir: string | undefined): ProjectDir;
  runPipeline(project: ProjectDir, options: CheckOptions): Promise<SavedCheckReport>;
  prepareMedia(project: ProjectDir, options: CheckOptions): Promise<PreparedMediaFile[]>;
  withMeta(value: object): object;
}

const DEFAULT_COMMAND_DEPENDENCIES: CheckCommandDependencies = {
  resolveProject,
  async runPipeline(project, options) {
    const capturing = captureArtifactRevision(project.dir).catch(warnNotRecorded);
    const report = await runCheckPipeline(project, options);
    const images = (files: readonly string[]) => files.map((file) => resolve(project.dir, file));
    reportArtifacts("check", "frame", images(report.snapshots.files));
    reportArtifacts("check", "finding", images(report.snapshots.findingFiles));
    const capture = await capturing;
    if (!capture) return report;
    try {
      return { ...report, saved: await saveCheckReport(project, options, report, capture) };
    } catch (error) {
      warnNotRecorded(error);
      return report;
    }
  },
  async prepareMedia(project, options) {
    const { bundleWithLocalizedFonts } = await import("../utils/bundleWithLocalizedFonts.js");
    const html = await bundleWithLocalizedFonts(project.dir);
    return (await preResolveHostileMediaProxies(project.dir, html, options.autoProxy)).files;
  },
  withMeta,
};

function warnNotRecorded(error: unknown): undefined {
  console.warn(`${c.warn("⚠")}  Check report was not recorded: ${normalizeErrorMessage(error)}`);
  return undefined;
}

async function saveCheckReport(
  project: ProjectDir,
  options: CheckOptions,
  report: CheckReport,
  capture: ArtifactCapture,
): Promise<SavedCheck> {
  const id = randomUUID();
  const directory = join(project.dir, ".hyperframes", "artifacts", "checks");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  const reportScope =
    "scope" in report && typeof report.scope === "object" && report.scope !== null
      ? report.scope
      : undefined;
  const artifacts: ArtifactInput[] = [
    {
      kind: "check",
      id,
      scope: reportScope ? "scoped" : "project",
      report: resolve(path),
      metadata: {
        ok: report.ok,
        browserSkipped: report.browserSkipped,
        scope: reportScope,
        options,
      },
    },
  ];
  for (const [index, image] of report.snapshots.files.entries()) {
    artifacts.push({
      kind: "snapshot",
      id: `${id}-${index}`,
      scope: "full",
      image: resolve(project.dir, image),
      time: report.snapshots.times[index],
      metadata: {
        checkId: id,
        ...pngDimensions(resolve(project.dir, image)),
      },
    });
  }
  const crops = selectFindingCropRequests(report);
  for (const [index, image] of report.snapshots.findingFiles.entries()) {
    const crop = crops.find((request) => image.endsWith(request.filename));
    artifacts.push({
      kind: "snapshot",
      id: `${id}-crop-${index}`,
      scope: "finding",
      image: resolve(project.dir, image),
      time: crop?.time,
      metadata: {
        checkId: id,
        finding: crop,
        ...pngDimensions(resolve(project.dir, image)),
      },
    });
  }
  const [saved] = await recordArtifacts(project.dir, capture, artifacts);
  if (!saved) throw new Error("no history record was written");
  reportArtifacts("check", "check-report", [resolve(path)]);
  return {
    id: saved.id,
    revision: saved.revision,
    report: saved.report,
    attribution: saved.attribution,
  };
}

const CHECK_COMMAND_ARGS = {
  dir: { type: "positional", description: "Project directory", required: false },
  json: { type: "boolean", description: "Output agent-readable JSON", default: false },
  samples: {
    type: "string",
    description: "Number of midpoint samples across the duration (default: 9)",
    default: "9",
  },
  range: {
    type: "string",
    description:
      "Runtime sample interval in global seconds: start,end. Static lint remains project-wide.",
  },
  components: {
    type: "string",
    description:
      "CSS selector list: filter findings involving these components or descendants; preserve full-check status.",
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
  "prepare-media": {
    type: "boolean",
    description:
      "Only make the browser-playable copies of videos Chrome cannot decode, then exit (no browser, no report). Stopped copies resume on the next run",
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
    description: "Save contrast-pass PNGs under .hyperframes/artifacts/snapshots/",
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
      const args = parseArgs(rawArgs, CHECK_COMMAND_ARGS);
      const asJson = args.json === true;

      try {
        const project = dependencies.resolveProject(args.dir);
        const options = parseCheckOptions(args);
        if (!asJson) {
          console.log(`${c.accent("◆")}  Checking ${c.accent(project.name)}`);
        }
        if (args["prepare-media"] === true) {
          await runPrepareMedia(dependencies, project, options, asJson);
          return;
        }
        const report = await withProjectLock(project.dir, "check", () =>
          dependencies.runPipeline(project, options),
        );
        if (asJson) {
          console.log(JSON.stringify(dependencies.withMeta(report), null, 2));
        } else {
          printHumanReport(report);
          if (report.saved) {
            console.log(`Report: ${report.saved.report}`);
            console.log(
              `Revision: ${report.saved.revision ?? "none"} (${report.saved.attribution})`,
            );
          }
        }
        setCommandExitCode(checkExitCode(report));
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

async function runPrepareMedia(
  dependencies: CheckCommandDependencies,
  project: ProjectDir,
  options: CheckOptions,
  asJson: boolean,
): Promise<void> {
  const files = await withProjectLock(project.dir, "check", () =>
    dependencies.prepareMedia(project, options),
  );
  const failed = files.filter((file) => file.state === "failed");
  if (asJson) {
    console.log(
      JSON.stringify(
        dependencies.withMeta({
          ok: failed.length === 0,
          prepared: files,
          total: files.length,
          ready: files.length - failed.length,
          failed: failed.length,
        }),
        null,
        2,
      ),
    );
  } else {
    const mark = failed.length === 0 ? c.success("✓") : c.error("✗");
    console.log(
      `${mark}  Browser-playable copies: ${files.length - failed.length}/${files.length} ready`,
    );
    for (const file of failed) console.log(`   ${file.file}: ${file.reason}`);
  }
  setCommandExitCode(failed.length === 0 ? 0 : 1);
}

function parseCheckOptions(args: Record<string, unknown>): CheckOptions {
  const maxTransitionSamples = positiveInteger(args["max-transition-samples"], 0);
  return {
    samples: positiveInteger(args.samples, DEFAULT_CHECK_OPTIONS.samples),
    range: parseCheckRange(args.range),
    components: typeof args.components === "string" ? [args.components] : undefined,
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

export function prelaunchBrowserForCheck(rawArgs: string[]) {
  const args = parseArgs(rawArgs, CHECK_COMMAND_ARGS);
  return prelaunchBrowserForNextCheck(resolveProject(args.dir), parseCheckOptions(args));
}

export function parseCheckRange(value: unknown): [number, number] | undefined {
  if (value === undefined) return undefined;
  const parts = String(value).split(/[,:]/);
  const start = Number(parts[0]),
    end = Number(parts[1]);
  if (
    parts.length !== 2 ||
    parts.some((p) => !p.trim()) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  )
    throw new Error("Invalid --range: use non-negative start,end with end > start");
  return [start, end];
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
  if (value.startsWith("-")) throw swallowedFlagUsageError("frame-check", value);
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

function printHumanReport(report: CheckReport): void {
  if (report.scope) {
    console.log(
      `Scope: ${report.scope.range ? report.scope.range.join("–") + "s" : "full timeline"}; ${report.scope.hiddenFindings} findings hidden by component filter. Counts/status include hidden findings.`,
    );
    for (const note of report.scope.notes) console.log(note);
  }
  printSection("Lint", report.lint);
  if (report.browserSkipped) {
    console.log();
    console.log(
      `  ${c.warn("⚠")} Browser session never ran — layout, motion, and contrast below are empty placeholders, not a clean pass.`,
    );
  }
  printSection("Runtime", report.runtime);
  printLayoutSection("Layout", report.layout);
  printSection("Motion", report.motion);
  printContrastSection(report);
  printCraftSection(report);
  printSnapshotSection(report);
  console.log();
  const label = report.ok ? c.success("Check passed") : c.error("Check failed");
  console.log(`${report.ok ? c.success("◇") : c.error("◇")}  ${label}`);
}

function isEmptySection(section: CheckSection): boolean {
  return (
    section.findings.length === 0 &&
    section.errorCount + section.warningCount + section.infoCount === 0
  );
}

function printSection(title: string, section: CheckSection): void {
  console.log();
  console.log(c.bold(title));
  if (isEmptySection(section)) {
    console.log(`  ${c.success("◇")} 0 errors, 0 warnings`);
    return;
  }
  for (const finding of section.findings) printFinding(finding);
  printCounts(section);
}

function printLayoutSection(title: string, section: CheckReport["layout"]): void {
  console.log();
  console.log(c.bold(title));
  if (isEmptySection(section)) {
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
  if (isEmptySection(section)) {
    console.log(
      `  ${c.success("◇")} ${section.passed}/${section.checked} text checks pass WCAG AA`,
    );
    return;
  }
  for (const finding of section.findings) {
    console.log(
      `  ${c.error("✗")} ${finding.selector} ${finding.ratio}:1 (need ${finding.requiredRatio}:1, ${formatFindingTimes(finding)})`,
    );
    console.log(`    ${c.dim(`Try ${finding.suggestedColor}; source ${finding.sourceFile}`)}`);
  }
  printCounts(section);
}

function printCraftSection(report: CheckReport): void {
  const section = report.craft;
  if (!section.enabled) {
    console.log();
    console.log(c.bold("Craft"));
    console.log(`  ${c.dim("◇")} skipped`);
    return;
  }
  printSection("Craft", section);
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
  const where = `${finding.sourceFile} ${finding.selector} ${formatFindingTimes(finding)}`;
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
