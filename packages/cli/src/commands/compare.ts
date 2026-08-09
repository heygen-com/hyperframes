import { failCommand } from "../utils/commandResult.js";
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { defineCommand } from "citty";
import { createContactSheet } from "../capture/contactSheet.js";
import { compareAgainstReference } from "../capture/compareAgainstReference.js";
import type { BoundsDeviation } from "../utils/referenceDiff.js";
import {
  openSettledCompositionPage,
  seekCompositionTimeline,
} from "../capture/captureCompositionFrame.js";
import { c } from "../ui/colors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { displayPathFromInput, readOptionalString, resolveFromBase } from "../utils/pathArgs.js";
import { trackCompareSheet } from "../telemetry/events.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import { withMeta } from "../utils/updateCheck.js";
import type { Example } from "./_examples.js";

const MAX_COMPARE_VARIANTS = 16;
const MAX_COLUMNS = 4;
const DEFAULT_RENDER_READY_TIMEOUT_MS = 5000;

export interface CompareVariantSpec {
  label: string;
  inputPath: string;
  displayPath: string;
}

export interface PreparedCompareVariant extends CompareVariantSpec {
  projectDir: string;
  stagedDir?: string;
}

export interface ParsedCompareArgs {
  variants: CompareVariantSpec[];
  outPath: string;
  atSeconds: number;
  cols?: number;
  json: boolean;
  timeoutMs: number;
}

export interface ParsedReferenceCompareArgs {
  variant: CompareVariantSpec;
  referencePath: string;
  displayReferencePath: string;
  times: number[];
  outPath: string;
  failUnder?: number;
  json: boolean;
  timeoutMs: number;
}

export interface CompareVariantCapResult {
  variants: CompareVariantSpec[];
  truncated: boolean;
  total: number;
}

export interface CompareSuccessPayload {
  ok: true;
  sheet: string;
  variants: { label: string; path: string }[];
  rendered: number;
  truncated?: true;
  total?: number;
}

export const examples: Example[] = [
  [
    "Compare two agent-authored composition variants",
    "hyperframes compare ./variants/a ./variants/b --out compare.png",
  ],
  [
    "Compare three variants at a specific timeline time",
    "hyperframes compare ./a ./b ./c --at 2.5 --labels classic,bold,quiet --json",
  ],
  [
    "Measure a rebuild against the video it reproduces",
    "hyperframes compare . --against reference.mp4 --at 0,4,10,21 --json",
  ],
];

function defaultLabelForPath(input: string): string {
  const name = basename(input);
  return extname(name).toLowerCase() === ".html" ? basename(name, extname(name)) : name;
}

function parsePathArgs(args: { _?: readonly unknown[] }): string[] {
  return (args._ ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseLabels(value: unknown, pathCount: number): string[] | undefined {
  const raw = readOptionalString(value);
  if (!raw) return undefined;
  const labels = raw.split(",").map((part) => part.trim());
  if (labels.some((label) => label.length === 0)) {
    throw new Error("--labels entries must be non-empty");
  }
  if (labels.length !== pathCount) {
    throw new Error(`--labels count (${labels.length}) must match path count (${pathCount})`);
  }
  return labels;
}

function parseAtSeconds(value: unknown): number {
  const raw = readOptionalString(value);
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("--at must be a non-negative number of seconds");
  }
  return parsed;
}

function parseColumns(value: unknown): number | undefined {
  const raw = readOptionalString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--cols must be a positive integer");
  }
  return parsed;
}

function defaultCompareCols(cellCount: number): number {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(cellCount))));
}

export function parseCompareArgs(
  args: {
    _?: readonly unknown[];
    labels?: unknown;
    out?: unknown;
    at?: unknown;
    cols?: unknown;
    json?: unknown;
    timeout?: unknown;
  },
  cwd = process.cwd(),
): ParsedCompareArgs {
  const paths = parsePathArgs(args);
  if (paths.length < 2) {
    throw new Error("need 2+ paths to compare");
  }

  const labels = parseLabels(args.labels, paths.length);
  const variants = paths.map((input, index) => ({
    label: labels?.[index] ?? defaultLabelForPath(input),
    inputPath: resolveFromBase(cwd, input),
    displayPath: displayPathFromInput(cwd, input),
  }));

  return {
    variants,
    outPath: resolveFromBase(cwd, readOptionalString(args.out) ?? "compare.png"),
    atSeconds: parseAtSeconds(args.at),
    cols: parseColumns(args.cols),
    json: args.json === true,
    timeoutMs:
      Number.parseInt(readOptionalString(args.timeout) ?? "", 10) ||
      DEFAULT_RENDER_READY_TIMEOUT_MS,
  };
}

const MAX_REFERENCE_TIMES = 8;

/**
 * Raw citty args for the `--against` route. String flags arrive as strings and
 * boolean flags as booleans, so the parse below narrows values rather than
 * type-testing them.
 */
export interface ReferenceCompareCliArgs {
  _?: readonly string[];
  against?: string;
  out?: string;
  at?: string;
  "fail-under"?: string;
  json?: boolean;
  timeout?: string;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function parseReferenceTimes(value: string | undefined): number[] {
  const raw = trimmed(value);
  if (!raw) return [0];
  const times = raw.split(",").map((entry) => {
    const parsed = Number(entry.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("--at must be non-negative seconds (comma-separated with --against)");
    }
    return parsed;
  });
  if (times.length > MAX_REFERENCE_TIMES) {
    throw new Error(`--at accepts at most ${MAX_REFERENCE_TIMES} times with --against`);
  }
  return times;
}

function parseFailUnder(value: string | undefined): number | undefined {
  const raw = trimmed(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("--fail-under must be an SSIM threshold between 0 and 1");
  }
  return parsed;
}

export function parseReferenceCompareArgs(
  args: ReferenceCompareCliArgs,
  cwd = process.cwd(),
): ParsedReferenceCompareArgs {
  const paths = (args._ ?? []).map((value) => value.trim()).filter(Boolean);
  if (paths.length !== 1) {
    throw new Error("--against compares exactly one composition path against the reference");
  }
  const reference = trimmed(args.against);
  if (!reference) throw new Error("--against needs a reference video or image path");
  const input = paths[0]!;

  return {
    variant: {
      label: defaultLabelForPath(input),
      inputPath: resolveFromBase(cwd, input),
      displayPath: displayPathFromInput(cwd, input),
    },
    referencePath: resolveFromBase(cwd, reference),
    displayReferencePath: displayPathFromInput(cwd, reference),
    times: parseReferenceTimes(args.at),
    outPath: resolveFromBase(cwd, trimmed(args.out) ?? "compare.png"),
    failUnder: parseFailUnder(args["fail-under"]),
    json: args.json === true,
    timeoutMs: Number.parseInt(trimmed(args.timeout) ?? "", 10) || DEFAULT_RENDER_READY_TIMEOUT_MS,
  };
}

export function capCompareVariants(
  variants: readonly CompareVariantSpec[],
): CompareVariantCapResult {
  const total = variants.length;
  if (total <= MAX_COMPARE_VARIANTS) {
    return { variants: [...variants], truncated: false, total };
  }
  console.error(
    c.warn(
      `Warning: ${total} compare variants exceed the ${MAX_COMPARE_VARIANTS}-variant cap — rendering the first ${MAX_COMPARE_VARIANTS} of ${total}; re-run with fewer variants or split into multiple runs.`,
    ),
  );
  return {
    variants: variants.slice(0, MAX_COMPARE_VARIANTS),
    truncated: true,
    total,
  };
}

export function buildCompareSuccessPayload(
  sheet: string,
  variants: readonly CompareVariantSpec[],
  capResult: CompareVariantCapResult,
): CompareSuccessPayload {
  const payload: CompareSuccessPayload = {
    ok: true,
    sheet,
    variants: variants.map((variant) => ({
      label: variant.label,
      path: variant.displayPath,
    })),
    rendered: variants.length,
  };
  if (capResult.truncated) {
    payload.truncated = true;
    payload.total = capResult.total;
  }
  return payload;
}

function inputError(variant: CompareVariantSpec): Error {
  return new Error(
    `Variant "${variant.label}" is not a composition input (${variant.displayPath}): expected a directory containing index.html or a .html file`,
  );
}

function stageHtmlVariant(variant: CompareVariantSpec): PreparedCompareVariant {
  const stagedDir = mkdtempSync(join(tmpdir(), "hf-compare-variant-"));
  try {
    // Copy the composition's sibling files but skip heavy/irrelevant trees — a
    // variant sitting next to node_modules or .git shouldn't drag them into tmp.
    cpSync(dirname(variant.inputPath), stagedDir, {
      recursive: true,
      filter: (src) => {
        const base = basename(src);
        return base !== "node_modules" && base !== ".git";
      },
    });
    const sourceName = basename(variant.inputPath);
    if (sourceName !== "index.html") {
      renameSync(join(stagedDir, sourceName), join(stagedDir, "index.html"));
    }
    return {
      ...variant,
      projectDir: stagedDir,
      stagedDir,
    };
  } catch (err) {
    rmSync(stagedDir, { recursive: true, force: true });
    throw err;
  }
}

export function prepareCompareVariantProjects(
  variants: readonly CompareVariantSpec[],
): PreparedCompareVariant[] {
  const prepared: PreparedCompareVariant[] = [];
  try {
    for (const variant of variants) {
      if (!existsSync(variant.inputPath)) {
        throw inputError(variant);
      }
      const stat = statSync(variant.inputPath);
      if (stat.isDirectory() && existsSync(join(variant.inputPath, "index.html"))) {
        prepared.push({
          ...variant,
          projectDir: variant.inputPath,
        });
        continue;
      }
      if (stat.isFile() && extname(variant.inputPath).toLowerCase() === ".html") {
        prepared.push(stageHtmlVariant(variant));
        continue;
      }
      throw inputError(variant);
    }
    return prepared;
  } catch (err) {
    for (const variant of prepared) {
      if (variant.stagedDir) {
        rmSync(variant.stagedDir, { recursive: true, force: true });
      }
    }
    throw err;
  }
}

function cleanupPreparedCompareVariants(variants: readonly PreparedCompareVariant[]): void {
  for (const variant of variants) {
    if (variant.stagedDir) {
      rmSync(variant.stagedDir, { recursive: true, force: true });
    }
  }
}

async function renderCompareVariant(
  variant: PreparedCompareVariant,
  opts: { atSeconds: number; framePath: string; timeoutMs: number },
): Promise<{ framePath: string; renderReadyTimedOut: boolean }> {
  try {
    const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
    const html = await bundleToSingleHtml(variant.projectDir);
    const server = await serveStaticProjectHtml(variant.projectDir, html);
    try {
      const {
        browser: chromeBrowser,
        page,
        renderReadyTimedOut,
      } = await openSettledCompositionPage(html, server.url, {
        renderReadyTimeoutMs: opts.timeoutMs,
        renderReadyWarningSuffix: `comparison variant "${variant.label}" may be inaccurate`,
      });
      try {
        if (opts.atSeconds > 0) {
          await seekCompositionTimeline(page, opts.atSeconds);
        }
        await page.screenshot({ path: opts.framePath, type: "png" });
        return { framePath: opts.framePath, renderReadyTimedOut };
      } finally {
        await chromeBrowser.close();
      }
    } finally {
      await server.close();
    }
  } catch (err) {
    throw new Error(
      `Render failed for variant "${variant.label}" (${variant.displayPath}): ${normalizeErrorMessage(err)}`,
    );
  }
}

async function renderCompareSheet(parsed: ParsedCompareArgs): Promise<CompareSuccessPayload> {
  const capResult = capCompareVariants(parsed.variants);
  const variants = capResult.variants;
  const prepared = prepareCompareVariantProjects(variants);
  const frameDir = mkdtempSync(join(tmpdir(), "hf-compare-frames-"));
  const framePaths: string[] = [];

  try {
    let renderReadyTimedOut = false;
    for (let i = 0; i < prepared.length; i++) {
      const variant = prepared[i]!;
      const framePath = join(frameDir, `variant-${String(i + 1).padStart(2, "0")}.png`);
      const rendered = await renderCompareVariant(variant, {
        atSeconds: parsed.atSeconds,
        framePath,
        timeoutMs: parsed.timeoutMs,
      });
      framePaths.push(rendered.framePath);
      renderReadyTimedOut = renderReadyTimedOut || rendered.renderReadyTimedOut;
    }

    mkdirSync(dirname(parsed.outPath), { recursive: true });
    await createContactSheet(framePaths, parsed.outPath, {
      cols: parsed.cols ?? defaultCompareCols(framePaths.length),
      maxImages: framePaths.length,
      labelMode: "custom",
      labels: variants.map((variant) => variant.label),
    });

    trackCompareSheet({
      command: "compare",
      cells: variants.length,
      truncated: capResult.truncated,
      total: capResult.total,
      renderReadyTimedOut,
    });
    return buildCompareSuccessPayload(parsed.outPath, variants, capResult);
  } finally {
    cleanupPreparedCompareVariants(prepared);
    rmSync(frameDir, { recursive: true, force: true });
  }
}

interface ReferenceComparePayload {
  ok: boolean;
  sheet: string;
  reference: string;
  replica: string;
  worstSsim: number | null;
  failUnder?: number;
  samples: {
    time: number;
    ssim: number | null;
    meanAbsDiff: number;
    meanSignedDiff: number;
    deviation: BoundsDeviation;
    overlay: string;
  }[];
}

async function runReferenceCompare(
  parsed: ParsedReferenceCompareArgs,
): Promise<ReferenceComparePayload> {
  const prepared = prepareCompareVariantProjects([parsed.variant]);
  try {
    const result = await compareAgainstReference({
      projectDir: prepared[0]!.projectDir,
      referencePath: parsed.referencePath,
      times: parsed.times,
      outPath: parsed.outPath,
      timeoutMs: parsed.timeoutMs,
    });

    trackCompareSheet({
      command: "compare",
      cells: parsed.times.length * 2,
      truncated: false,
      total: parsed.times.length * 2,
      renderReadyTimedOut: false,
    });

    const gated =
      parsed.failUnder !== undefined &&
      (result.worstSsim === null || result.worstSsim < parsed.failUnder);

    return {
      ok: !gated,
      sheet: result.sheet,
      reference: parsed.displayReferencePath,
      replica: parsed.variant.displayPath,
      worstSsim: result.worstSsim,
      ...(parsed.failUnder !== undefined ? { failUnder: parsed.failUnder } : {}),
      samples: result.samples.map((sample) => ({
        time: sample.time,
        ssim: sample.ssim,
        meanAbsDiff: Number(sample.meanAbsDiff.toFixed(4)),
        meanSignedDiff: Number(sample.meanSignedDiff.toFixed(4)),
        deviation: sample.deviation,
        overlay: sample.overlay,
      })),
    };
  } finally {
    cleanupPreparedCompareVariants(prepared);
  }
}

function printReferenceReport(payload: ReferenceComparePayload): void {
  console.log();
  console.log(c.bold(`Reference: ${payload.reference}`));
  for (const sample of payload.samples) {
    const { dw, dh, dcx, dcy, scale } = sample.deviation;
    const ssim = sample.ssim === null ? "n/a" : sample.ssim.toFixed(4);
    const signed = sample.meanSignedDiff * 100;
    console.log(
      `  t=${sample.time}s  SSIM ${ssim}  diff ${(sample.meanAbsDiff * 100).toFixed(1)}% (bias ${signed >= 0 ? "+" : ""}${signed.toFixed(1)}%)`,
    );
    console.log(
      c.dim(
        `    ink dw=${dw}px dh=${dh}px dcx=${dcx.toFixed(1)}px dcy=${dcy.toFixed(1)}px scale=${scale.toFixed(3)}`,
      ),
    );
    console.log(c.dim(`    overlay ${sample.overlay}`));
  }
  console.log();
  console.log(`${c.success("◇")}  Contact sheet saved to ${payload.sheet}`);
  if (!payload.ok) {
    const worst = payload.worstSsim === null ? "unmeasured" : payload.worstSsim.toFixed(4);
    console.error(`${c.error("✗")} Worst SSIM ${worst} is below --fail-under ${payload.failUnder}`);
  }
}

function printJson(payload: object): void {
  console.log(JSON.stringify(withMeta(payload), null, 2));
}

export default defineCommand({
  meta: {
    name: "compare",
    description: "Render independent composition variants into one labeled comparison sheet",
  },
  args: {
    path: {
      type: "positional",
      description: "Composition project directory or .html file (pass 2+ paths)",
      required: false,
    },
    against: {
      type: "string",
      description:
        "Reference video or image to measure one composition against (SSIM + ink-box deltas + red/cyan overlay)",
    },
    at: {
      type: "string",
      description:
        "Timeline time in seconds to seek before screenshotting each variant (comma-separated with --against)",
    },
    "fail-under": {
      type: "string",
      description: "With --against, exit non-zero when the worst sampled SSIM falls below this",
    },
    labels: {
      type: "string",
      description: "Comma-separated labels matching the variant path count",
    },
    out: {
      type: "string",
      description: "Output comparison sheet path (default: ./compare.png)",
    },
    cols: {
      type: "string",
      description: "Grid columns (default: sqrt heuristic, capped at 4)",
    },
    timeout: {
      type: "string",
      description: "Render-ready timeout in ms per variant (default: 5000)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const jsonRequested = args.json === true;
    try {
      if (trimmed(args.against)) {
        const parsed = parseReferenceCompareArgs(args);
        if (!parsed.json) {
          console.log(
            `${c.accent("◆")}  Measuring ${parsed.variant.label} against ${parsed.displayReferencePath} at ${parsed.times.length} time(s)`,
          );
        }
        const payload = await runReferenceCompare(parsed);
        if (parsed.json) printJson(payload);
        else printReferenceReport(payload);
        if (!payload.ok) failCommand();
        return;
      }

      const parsed = parseCompareArgs(args);
      if (!parsed.json) {
        console.log(
          `${c.accent("◆")}  Rendering ${Math.min(parsed.variants.length, MAX_COMPARE_VARIANTS)} of ${parsed.variants.length} composition variants`,
        );
      }
      const payload = await renderCompareSheet(parsed);
      if (parsed.json) {
        printJson(payload);
      } else {
        console.log(`\n${c.success("◇")}  Comparison sheet saved to ${payload.sheet}`);
      }
    } catch (err) {
      const message = normalizeErrorMessage(err);
      if (jsonRequested) {
        printJson({ ok: false, error: message });
      } else {
        console.error(`\n${c.error("✗")} Compare failed: ${message}`);
      }
      failCommand();
    }
  },
});
