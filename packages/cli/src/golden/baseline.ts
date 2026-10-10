/**
 * Golden baseline regression gate.
 *
 * Convention: committed reference frames live at
 * `golden/<compositionId>/<timeMs>.png`, with an optional
 * `golden/<compositionId>/golden.json` manifest describing the sample times
 * and diff tuning. `runGoldenGate` re-captures the composition at those
 * times and pixel-diffs against the baselines (fail-on-diff), or refreshes
 * the baselines when `update` is set.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { BrowserGpuMode } from "../browser/gpuPolicy.js";
import {
  openSettledCompositionPage,
  seekCompositionTimeline,
} from "../capture/captureCompositionFrame.js";
import type { ProjectDir } from "../utils/project.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import {
  DEFAULT_DIFF_THRESHOLD,
  diffPngs,
  writeRawImagePng,
  type PixelDiffResult,
} from "./pixelDiff.js";

const GOLDEN_DIR_NAME = "golden";
const GOLDEN_DIFF_DIR_NAME = "golden-diff";
const GOLDEN_MANIFEST_NAME = "golden.json";

/** Frames captured when neither a manifest nor existing baselines pick the times. */
const DEFAULT_GOLDEN_FRAMES = 5;

/** Optional `golden/<compositionId>/golden.json` tuning file. */
export interface GoldenManifest {
  /** Timeline sample times in seconds. */
  times?: number[];
  /** Per-channel pixel tolerance, fraction of 255 (default 0.1). */
  threshold?: number;
  /** Fraction of differing pixels allowed before the gate fails (default 0: fail on any diff). */
  maxDiffRatio?: number;
  /** Exclude 1px anti-aliasing edge shifts from the failure count (default true). */
  ignoreAntialiasing?: boolean;
}

export interface ResolvedGoldenConfig {
  threshold: number;
  maxDiffRatio: number;
  ignoreAntialiasing: boolean;
}

export type GoldenFailureReason = "pixel-diff" | "dimension-mismatch" | "missing-baseline";

export interface GoldenFailure {
  /** Composition id the baseline belongs to. */
  id: string;
  /** Sample time in seconds. */
  time: number;
  timeMs: number;
  /** Max per-channel delta (0-255) among counted differing pixels. */
  maxDelta: number;
  /** Fraction of pixels that differ beyond the threshold. */
  diffRatio: number;
  reason: GoldenFailureReason;
}

/** Agent-readable gate result (also embedded in `check --json` output). */
export interface GoldenSummary {
  ok: boolean;
  updated: boolean;
  compositionId: string;
  compared: number;
  times: number[];
  failed: GoldenFailure[];
  /** Contact sheet of baseline | current | diff rows, written on failure. */
  diffSheet: string | null;
  /** Baseline PNGs written (update) or gated against (check), project-relative. */
  baselines: string[];
}

export interface GoldenGateOptions {
  /** Refresh baselines from the current render instead of gating. */
  update?: boolean;
  /** Explicit sample times in seconds; overrides manifest and baseline-derived times. */
  at?: number[];
  /** CLI override for the per-channel pixel tolerance (0-1). */
  threshold?: number;
  timeoutMs?: number;
  autoProxy?: boolean;
  browserGpuMode?: BrowserGpuMode;
}

export function timeMsFromSeconds(seconds: number): number {
  return Math.round(seconds * 1000);
}

export function goldenTimeFileName(timeMs: number): string {
  return `${timeMs}.png`;
}

/** `<timeMs>.png` → timeMs; anything else (manifest, diff artifacts) → null. */
export function parseGoldenTimeFileName(fileName: string): number | null {
  const match = /^(\d+)\.png$/.exec(fileName);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function goldenCompositionDir(projectDir: string, compositionId: string): string {
  return join(projectDir, GOLDEN_DIR_NAME, compositionId);
}

export function goldenBaselinePath(
  projectDir: string,
  compositionId: string,
  timeMs: number,
): string {
  return join(goldenCompositionDir(projectDir, compositionId), goldenTimeFileName(timeMs));
}

function manifestError(sourcePath: string, detail: string): Error {
  return new Error(`Invalid golden manifest ${sourcePath}: ${detail}`);
}

function manifestTimes(value: unknown, sourcePath: string): number[] | undefined {
  if (value === undefined) return undefined;
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((t) => typeof t === "number" && Number.isFinite(t) && t >= 0);
  if (!valid) {
    throw manifestError(sourcePath, '"times" must be a non-empty array of non-negative seconds');
  }
  return value.filter((t): t is number => typeof t === "number");
}

function manifestFraction(value: unknown, field: string, sourcePath: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw manifestError(sourcePath, `"${field}" must be a number from 0 to 1`);
  }
  return value;
}

function manifestBoolean(value: unknown, field: string, sourcePath: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw manifestError(sourcePath, `"${field}" must be a boolean`);
  }
  return value;
}

function manifestRecord(raw: string, sourcePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw manifestError(sourcePath, "not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw manifestError(sourcePath, "expected a JSON object");
  }
  return { ...parsed };
}

/** Parse and validate a golden.json manifest. Throws with the offending field on invalid input. */
export function parseGoldenManifest(raw: string, sourcePath: string): GoldenManifest {
  const record = manifestRecord(raw, sourcePath);
  const manifest: GoldenManifest = {};
  const times = manifestTimes(record.times, sourcePath);
  if (times) manifest.times = times;
  const threshold = manifestFraction(record.threshold, "threshold", sourcePath);
  if (threshold !== undefined) manifest.threshold = threshold;
  const maxDiffRatio = manifestFraction(record.maxDiffRatio, "maxDiffRatio", sourcePath);
  if (maxDiffRatio !== undefined) manifest.maxDiffRatio = maxDiffRatio;
  const ignoreAntialiasing = manifestBoolean(
    record.ignoreAntialiasing,
    "ignoreAntialiasing",
    sourcePath,
  );
  if (ignoreAntialiasing !== undefined) manifest.ignoreAntialiasing = ignoreAntialiasing;
  return manifest;
}

export function readGoldenManifest(
  projectDir: string,
  compositionId: string,
): GoldenManifest | null {
  const manifestPath = join(goldenCompositionDir(projectDir, compositionId), GOLDEN_MANIFEST_NAME);
  if (!existsSync(manifestPath)) return null;
  return parseGoldenManifest(readFileSync(manifestPath, "utf8"), manifestPath);
}

/** Baseline sample times (ms) derived from committed `<timeMs>.png` files, sorted. */
export function listGoldenBaselineTimesMs(projectDir: string, compositionId: string): number[] {
  const dir = goldenCompositionDir(projectDir, compositionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map(parseGoldenTimeFileName)
    .filter((timeMs): timeMs is number => timeMs !== null)
    .sort((a, b) => a - b);
}

/**
 * Default sample spread: evenly spaced frames whose final point backs off the
 * exact duration to a readable tail. Mirrors the snapshot command's
 * `computeSnapshotTimes`/`tailFrameTime` policy — kept as a local copy so the
 * golden module does not import the snapshot command (which dynamically
 * imports this module back).
 */
function defaultGoldenTimes(duration: number): number[] {
  const tail = Math.max(0, duration - Math.max(0.05, duration * 0.03));
  const round = (t: number) => Math.round(t * 1000) / 1000;
  const times = Array.from(
    { length: DEFAULT_GOLDEN_FRAMES },
    (_, i) => (i / (DEFAULT_GOLDEN_FRAMES - 1)) * duration,
  );
  times[times.length - 1] = tail;
  return times.map(round);
}

/**
 * Pick the sample times, in precedence order: explicit `--at` override,
 * manifest `times`, times encoded in existing baseline filenames, then the
 * default spread (evenly spaced with a readable tail).
 */
export function resolveGoldenSampleTimes(input: {
  atOverride?: number[];
  manifestTimes?: number[];
  baselineTimesMs?: number[];
  duration: number;
}): number[] {
  if (input.atOverride && input.atOverride.length > 0) return [...input.atOverride];
  if (input.manifestTimes && input.manifestTimes.length > 0) return [...input.manifestTimes];
  if (input.baselineTimesMs && input.baselineTimesMs.length > 0) {
    return input.baselineTimesMs.map((timeMs) => timeMs / 1000);
  }
  if (!(input.duration > 0)) {
    throw new Error(
      "Could not determine composition duration and no golden sample times were provided — pass --at or add times to golden.json",
    );
  }
  return defaultGoldenTimes(input.duration);
}

export function resolveGoldenConfig(
  manifest: GoldenManifest | null,
  overrides: { threshold?: number } = {},
): ResolvedGoldenConfig {
  return {
    threshold: overrides.threshold ?? manifest?.threshold ?? DEFAULT_DIFF_THRESHOLD,
    maxDiffRatio: manifest?.maxDiffRatio ?? 0,
    ignoreAntialiasing: manifest?.ignoreAntialiasing !== false,
  };
}

/** Gate decision for one compared frame. */
export function evaluateGoldenDiff(
  result: PixelDiffResult,
  maxDiffRatio: number,
): "pass" | Extract<GoldenFailureReason, "pixel-diff" | "dimension-mismatch"> {
  if (result.dimensionMismatch) return "dimension-mismatch";
  return result.diffRatio > maxDiffRatio ? "pixel-diff" : "pass";
}

function relativeToProject(projectDir: string, path: string): string {
  const rel = relative(projectDir, path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

function roundTime(time: number): number {
  return Math.round(time * 1000) / 1000;
}

interface GoldenCapture {
  time: number;
  timeMs: number;
  png: Uint8Array;
}

interface CapturedComposition {
  compositionId: string;
  times: number[];
  captures: GoldenCapture[];
  manifest: GoldenManifest | null;
}

/**
 * Open the composition once, resolve the sample times, and screenshot each.
 * Font-localized bundling and the settled-page capture path mirror
 * `hyperframes snapshot`, so goldens match what agents already review.
 */
async function captureGoldenFrames(
  project: ProjectDir,
  opts: GoldenGateOptions,
): Promise<CapturedComposition> {
  const { bundleWithLocalizedFonts } = await import("../utils/bundleWithLocalizedFonts.js");
  const html = await bundleWithLocalizedFonts(project.dir);
  const server = await serveStaticProjectHtml(project.dir, html, undefined, [], opts.autoProxy);
  try {
    const { browser: chromeBrowser, page } = await openSettledCompositionPage(html, server.url, {
      renderReadyTimeoutMs: opts.timeoutMs ?? 5000,
      renderReadyWarningSuffix: "golden captures may be inaccurate",
      browserGpuMode: opts.browserGpuMode,
    });
    try {
      const meta = await page.evaluate(() => {
        const root = document.querySelector("[data-composition-id]");
        // Serialized into the page: the runtime attaches __player without typings.
        const win = window as unknown as { __player?: { getDuration?: () => number } };
        const candidates = [
          Number(win.__player?.getDuration?.()),
          Number.parseFloat(root?.getAttribute("data-duration") ?? ""),
        ];
        return {
          id: root?.getAttribute("data-composition-id") ?? "",
          duration: candidates.find((d) => Number.isFinite(d) && d > 0) ?? 0,
        };
      });

      const compositionId = meta.id || project.name;
      const manifest = readGoldenManifest(project.dir, compositionId);
      const baselineTimesMs = listGoldenBaselineTimesMs(project.dir, compositionId);

      if (!opts.update && !manifest?.times?.length && baselineTimesMs.length === 0) {
        throw new Error(
          `No golden baselines found for "${compositionId}" (${GOLDEN_DIR_NAME}/${compositionId}/). ` +
            "Create them with `hyperframes check --update-golden` or `hyperframes snapshot --update-golden`.",
        );
      }

      const times = resolveGoldenSampleTimes({
        atOverride: opts.at,
        manifestTimes: manifest?.times,
        baselineTimesMs,
        duration: meta.duration,
      }).map(roundTime);

      const captures: GoldenCapture[] = [];
      for (const time of times) {
        await seekCompositionTimeline(page, time);
        const png = await page.screenshot({ type: "png" });
        captures.push({ time, timeMs: timeMsFromSeconds(time), png });
      }
      return { compositionId, times, captures, manifest };
    } finally {
      await chromeBrowser.close();
    }
  } finally {
    await server.close();
  }
}

function writeGoldenBaselines(
  project: ProjectDir,
  captured: CapturedComposition,
  opts: GoldenGateOptions,
): GoldenSummary {
  const dir = goldenCompositionDir(project.dir, captured.compositionId);
  mkdirSync(dir, { recursive: true });

  // Drop stale baselines whose time is no longer sampled — they would gate
  // nothing but still look authoritative in review.
  const keep = new Set(captured.captures.map((capture) => goldenTimeFileName(capture.timeMs)));
  for (const file of readdirSync(dir)) {
    if (parseGoldenTimeFileName(file) !== null && !keep.has(file)) {
      rmSync(join(dir, file), { force: true });
    }
  }

  const baselines: string[] = [];
  for (const capture of captured.captures) {
    const path = join(dir, goldenTimeFileName(capture.timeMs));
    writeFileSync(path, capture.png);
    baselines.push(relativeToProject(project.dir, path));
  }

  const manifest: GoldenManifest = {
    ...(captured.manifest ?? {}),
    times: captured.times,
  };
  if (opts.threshold !== undefined) manifest.threshold = opts.threshold;
  writeFileSync(join(dir, GOLDEN_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    ok: true,
    updated: true,
    compositionId: captured.compositionId,
    compared: captured.captures.length,
    times: captured.times,
    failed: [],
    diffSheet: null,
    baselines,
  };
}

async function compareAgainstBaselines(
  project: ProjectDir,
  captured: CapturedComposition,
  opts: GoldenGateOptions,
): Promise<GoldenSummary> {
  const config = resolveGoldenConfig(captured.manifest, { threshold: opts.threshold });
  const diffDir = join(project.dir, GOLDEN_DIFF_DIR_NAME, captured.compositionId);
  rmSync(diffDir, { recursive: true, force: true });

  const failed: GoldenFailure[] = [];
  const baselines: string[] = [];
  const sheetRows: { label: string; paths: string[] }[] = [];

  for (const capture of captured.captures) {
    const baselinePath = goldenBaselinePath(project.dir, captured.compositionId, capture.timeMs);
    baselines.push(relativeToProject(project.dir, baselinePath));

    if (!existsSync(baselinePath)) {
      failed.push({
        id: captured.compositionId,
        time: capture.time,
        timeMs: capture.timeMs,
        maxDelta: 255,
        diffRatio: 1,
        reason: "missing-baseline",
      });
      mkdirSync(diffDir, { recursive: true });
      writeFileSync(join(diffDir, `${capture.timeMs}-current.png`), capture.png);
      continue;
    }

    const result = await diffPngs(baselinePath, capture.png, {
      threshold: config.threshold,
      ignoreAntialiasing: config.ignoreAntialiasing,
    });
    const verdict = evaluateGoldenDiff(result, config.maxDiffRatio);
    if (verdict === "pass") continue;

    failed.push({
      id: captured.compositionId,
      time: capture.time,
      timeMs: capture.timeMs,
      maxDelta: result.maxDelta,
      diffRatio: Math.round(result.diffRatio * 1e6) / 1e6,
      reason: verdict,
    });

    mkdirSync(diffDir, { recursive: true });
    const currentPath = join(diffDir, `${capture.timeMs}-current.png`);
    const diffPath = join(diffDir, `${capture.timeMs}-diff.png`);
    writeFileSync(currentPath, capture.png);
    await writeRawImagePng(
      { width: result.width, height: result.height, data: result.diff },
      diffPath,
    );
    sheetRows.push({
      label: `t=${capture.time}s`,
      paths: [baselinePath, currentPath, diffPath],
    });
  }

  let diffSheet: string | null = null;
  if (sheetRows.length > 0) {
    const { createGoldenDiffContactSheet } = await import("../capture/contactSheet.js");
    const sheets = await createGoldenDiffContactSheet(
      sheetRows.map((row) => ({
        label: row.label,
        baselinePath: row.paths[0]!,
        currentPath: row.paths[1]!,
        diffPath: row.paths[2]!,
      })),
      join(diffDir, "contact-sheet.jpg"),
    );
    diffSheet = sheets[0] ? relativeToProject(project.dir, sheets[0]) : null;
  }

  return {
    ok: failed.length === 0,
    updated: false,
    compositionId: captured.compositionId,
    compared: captured.captures.length,
    times: captured.times,
    failed,
    diffSheet,
    baselines,
  };
}

/**
 * Run the golden baseline gate for a project: capture at the manifest /
 * baseline sample times and pixel-diff against `golden/<compositionId>/`,
 * or refresh those baselines when `update` is set.
 */
export async function runGoldenGate(
  project: ProjectDir,
  opts: GoldenGateOptions = {},
): Promise<GoldenSummary> {
  const captured = await captureGoldenFrames(project, opts);
  if (opts.update) return writeGoldenBaselines(project, captured, opts);
  return compareAgainstBaselines(project, captured, opts);
}
