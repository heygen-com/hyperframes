#!/usr/bin/env tsx
// fallow-ignore-file complexity
/**
 * HDR passthrough parity harness.
 *
 * Renders a composition twice through the CLI, once with the flag off (the
 * layered HDR composite) and once with `--experimental-hdr-passthrough`,
 * then compares the two outputs: frame count, duration, ffprobe colour tags,
 * audio stream, HDR frame side data, and per-frame PSNR / SSIM computed in
 * 10 bit (`yuv420p10le`). Wall-clock of each render is reported. Thresholds
 * and how to read the report are in README.md next to this file.
 *
 * Usage (from packages/producer; generate fixtures first with fixture.ts):
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/parity.ts --fixtures /tmp/hf-hdr-passthrough
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/parity.ts --project <dir> --duration 20
 *   ../../node_modules/.bin/tsx src/hdr-passthrough-harness/parity.ts --fixtures <dir> --only off
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  DEFAULT_THRESHOLDS,
  checkHdrTags,
  checkPixelParity,
  classifyRenderLog,
  type CaptureStats,
  compareProbes,
  describeRenderPath,
  isFallback,
  parseCaptureStats,
  parseFfmpegVersion,
  parsePsnrStats,
  parseSsimStats,
  summarizeProbe,
  type CheckResult,
  type ParityThresholds,
  type ProbeSummary,
  type PsnrSummary,
  type RenderPath,
  type SeriesSummary,
} from "./stats.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");

export type RenderSide = "off" | "on";
export type Expectation = "passthrough" | "fallback";

/** Default CLI: the worktree's CLI from source, run through the repo's tsx. */
export function defaultCliCommand(root: string = repoRoot): string[] {
  return [join(root, "node_modules/.bin/tsx"), join(root, "packages/cli/src/cli.ts")];
}

export interface RenderArgsOptions {
  projectDir: string;
  outputPath: string;
  side: RenderSide;
  fps: number;
  workers: number;
  quality: "draft" | "standard" | "high";
  extraArgs: readonly string[];
}

/** `hyperframes render` arguments for one side; the two sides differ only by the flag. */
export function buildRenderArgs(options: RenderArgsOptions): string[] {
  const args = [
    "render",
    options.projectDir,
    "--output",
    options.outputPath,
    "--fps",
    String(options.fps),
    "--workers",
    String(options.workers),
    "--quality",
    options.quality,
  ];
  if (options.side === "on") args.push("--experimental-hdr-passthrough");
  args.push(...options.extraArgs);
  return args;
}

/**
 * The render's environment. The flag-off side must not inherit
 * `HF_EXPERIMENTAL_HDR_PASSTHROUGH` from the caller's shell, otherwise both
 * sides would take the same route; the flag-on side gets it from the CLI flag.
 */
export function buildRenderEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.HF_EXPERIMENTAL_HDR_PASSTHROUGH;
  return env;
}

/**
 * ffmpeg arguments for the 10-bit PSNR + SSIM pass. Both inputs are reset
 * to start at 0 and converted to `yuv420p10le`, so the metrics run on the
 * 10-bit planes the HDR encode wrote (peak 1023), not an 8-bit downconvert.
 * Stats files are written relative to the process cwd.
 */
export function buildMetricsArgs(
  referencePath: string,
  candidatePath: string,
  psnrLog: string,
  ssimLog: string,
): string[] {
  const graph = [
    "[0:v]setpts=PTS-STARTPTS,format=yuv420p10le,split[r1][r2]",
    "[1:v]setpts=PTS-STARTPTS,format=yuv420p10le,split[c1][c2]",
    `[r1][c1]psnr=stats_file=${psnrLog}[psnr]`,
    `[r2][c2]ssim=stats_file=${ssimLog}[ssim]`,
  ].join(";");
  return [
    "-hide_banner",
    "-v",
    "error",
    "-i",
    referencePath,
    "-i",
    candidatePath,
    "-filter_complex",
    graph,
    "-map",
    "[psnr]",
    "-f",
    "null",
    "-",
    "-map",
    "[ssim]",
    "-f",
    "null",
    "-",
  ];
}

export interface RenderRun {
  side: RenderSide;
  outputPath: string;
  logPath: string;
  wallMs: number;
  exitCode: number | null;
  path: RenderPath;
  /** Passthrough capture counts, when the log has them. */
  capture: CaptureStats | null;
  probe: ProbeSummary | null;
}

interface Tools {
  cli: string[];
  ffmpeg: string;
  ffprobe: string;
  timeoutMs: number;
}

function tailOf(path: string, lines: number): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

function probe(tools: Tools, file: string): ProbeSummary {
  const streams = spawnSync(
    tools.ffprobe,
    ["-v", "error", "-count_packets", "-show_streams", "-show_format", "-of", "json", "--", file],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (streams.status !== 0) throw new Error(`ffprobe failed on ${file}: ${streams.stderr}`);
  const frame = spawnSync(
    tools.ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-read_intervals",
      "%+#1",
      "-show_frames",
      "-show_entries",
      "frame=side_data_list",
      "-of",
      "json",
      "--",
      file,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return summarizeProbe(streams.stdout, frame.status === 0 ? frame.stdout : undefined);
}

function render(
  tools: Tools,
  side: RenderSide,
  argsOptions: Omit<RenderArgsOptions, "side" | "outputPath">,
  outDir: string,
  skipRender: boolean,
): RenderRun {
  const outputPath = join(outDir, `${side}.mp4`);
  const logPath = join(outDir, `${side}.log`);
  let wallMs = Number.NaN;
  let exitCode: number | null = 0;
  if (!skipRender) {
    const [command, ...prefix] = tools.cli;
    if (!command) throw new Error("empty --cli command");
    const args = [...prefix, ...buildRenderArgs({ ...argsOptions, side, outputPath })];
    console.log(`[${side}] ${[command, ...args].join(" ")}`);
    const fd = openSync(logPath, "w");
    const started = Date.now();
    try {
      const result = spawnSync(command, args, {
        cwd: repoRoot,
        env: buildRenderEnv(process.env),
        stdio: ["ignore", fd, fd],
        timeout: tools.timeoutMs,
      });
      exitCode = result.status;
      if (result.error) console.error(`[${side}] spawn error: ${result.error.message}`);
    } finally {
      closeSync(fd);
    }
    wallMs = Date.now() - started;
    console.log(`[${side}] exit ${exitCode} in ${(wallMs / 1000).toFixed(1)} s, log ${logPath}`);
    if (exitCode !== 0) console.error(tailOf(logPath, 30));
  } else if (!existsSync(outputPath)) {
    throw new Error(`--skip-render: ${outputPath} does not exist`);
  }
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const path = classifyRenderLog(log);
  const capture = parseCaptureStats(log);
  const output = existsSync(outputPath) && exitCode === 0 ? probe(tools, outputPath) : null;
  return { side, outputPath, logPath, wallMs, exitCode, path, capture, probe: output };
}

function computeMetrics(
  tools: Tools,
  reference: string,
  candidate: string,
  outDir: string,
): { psnr: PsnrSummary; ssim: SeriesSummary; ms: number } {
  const started = Date.now();
  const result = spawnSync(
    tools.ffmpeg,
    buildMetricsArgs(reference, candidate, "psnr.log", "ssim.log"),
    { cwd: outDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg psnr/ssim failed: ${result.stderr}`);
  return {
    psnr: parsePsnrStats(readFileSync(join(outDir, "psnr.log"), "utf8")),
    ssim: parseSsimStats(readFileSync(join(outDir, "ssim.log"), "utf8")),
    ms: Date.now() - started,
  };
}

export interface ExpectedOutput {
  fps: number;
  transfer: "hlg" | "pq";
  /** Composition duration; when set, the layered output's frame count is checked against it. */
  durationSec: number | null;
}

/** Checks that apply to one output on its own (also the only checks with `--only off`). */
export function checkSingleOutput(run: RenderRun, expected: ExpectedOutput): CheckResult[] {
  const results: CheckResult[] = [
    {
      name: `${run.side}.render`,
      ok: run.exitCode === 0 && run.probe !== null,
      detail: run.exitCode === 0 ? "ok" : `exit ${run.exitCode}`,
    },
  ];
  if (!run.probe) return results;
  results.push(...checkHdrTags(run.side, run.probe, expected.transfer));
  results.push({
    name: `${run.side}.audio`,
    ok: run.probe.hasAudio,
    detail: run.probe.hasAudio ? `${run.probe.audioCodec}` : "no audio stream",
  });
  if (expected.durationSec !== null) {
    const frames = Math.round(expected.durationSec * expected.fps);
    results.push({
      name: `${run.side}.frames`,
      ok: run.probe.videoFrames === frames,
      detail: `${run.probe.videoFrames} (expected ${frames})`,
    });
  }
  return results;
}

/** Whether the flag-on render took the route the fixture expects. */
export function checkExpectedPath(
  path: RenderPath,
  expect: Expectation,
  expectReason?: string,
): CheckResult {
  const described = describeRenderPath(path);
  if (expect === "passthrough") {
    return { name: "on.path", ok: path.kind === "passthrough", detail: described };
  }
  const reasonOk = !expectReason || (path.kind === "ineligible" && path.reason === expectReason);
  return {
    name: "on.path",
    ok: isFallback(path) && reasonOk,
    detail: expectReason ? `${described} (expected reason ${expectReason})` : described,
  };
}

interface ProjectReport {
  project: string;
  /** `ffmpeg -version` of the binary the harness (and, by default, both renders) run. */
  ffmpegVersion: string | null;
  expect: Expectation;
  runs: Array<Omit<RenderRun, "probe"> & { probe: ProbeSummary | null }>;
  metrics?: { psnr: PsnrSummary; ssim: SeriesSummary; ms: number };
  speedup?: number;
  checks: CheckResult[];
  ok: boolean;
}

interface ProjectOptions {
  projectDir: string;
  outDir: string;
  expect: Expectation;
  expectReason?: string;
  only: "off" | "on" | "both";
  skipRender: boolean;
  renderArgs: Omit<RenderArgsOptions, "side" | "outputPath" | "projectDir">;
  expected: ExpectedOutput;
  thresholds: ParityThresholds;
}

function readFfmpegVersion(tools: Tools): string | null {
  const result = spawnSync(tools.ffmpeg, ["-hide_banner", "-version"], { encoding: "utf-8" });
  return result.status === 0 ? parseFfmpegVersion(result.stdout) : null;
}

function runProject(tools: Tools, options: ProjectOptions): ProjectReport {
  mkdirSync(options.outDir, { recursive: true });
  const sides: RenderSide[] = options.only === "both" ? ["off", "on"] : [options.only];
  const runs = sides.map((side) =>
    render(
      tools,
      side,
      { ...options.renderArgs, projectDir: options.projectDir },
      options.outDir,
      options.skipRender,
    ),
  );
  const checks: CheckResult[] = runs.flatMap((run) => checkSingleOutput(run, options.expected));
  const off = runs.find((run) => run.side === "off");
  const on = runs.find((run) => run.side === "on");
  if (on) checks.push(checkExpectedPath(on.path, options.expect, options.expectReason));

  let metrics: ProjectReport["metrics"];
  let speedup: number | undefined;
  if (off?.probe && on?.probe) {
    checks.push(
      ...compareProbes(off.probe, on.probe, options.expected.fps, options.thresholds).map(
        (check) => ({ ...check, name: `parity.${check.name}` }),
      ),
    );
    metrics = computeMetrics(tools, off.outputPath, on.outputPath, options.outDir);
    checks.push(
      ...checkPixelParity(metrics.psnr, metrics.ssim, off.probe.videoFrames, options.thresholds),
    );
    if (Number.isFinite(off.wallMs) && Number.isFinite(on.wallMs) && on.wallMs > 0) {
      speedup = off.wallMs / on.wallMs;
    }
  }
  return {
    project: options.projectDir,
    ffmpegVersion: readFfmpegVersion(tools),
    expect: options.expect,
    runs,
    metrics,
    speedup,
    checks,
    ok: checks.every((check) => check.ok),
  };
}

function printReport(report: ProjectReport): void {
  console.log(`\n=== ${basename(report.project)} (flag on: expect ${report.expect}) ===`);
  console.log(`  ffmpeg ${report.ffmpegVersion ?? "version unknown"}`);
  for (const run of report.runs) {
    const wall = Number.isFinite(run.wallMs) ? `${(run.wallMs / 1000).toFixed(1)} s` : "skipped";
    console.log(
      `  ${run.side.padEnd(3)} wall=${wall.padEnd(9)} path=${describeRenderPath(run.path)} ` +
        `frames=${run.probe?.videoFrames ?? "-"} dur=${run.probe?.durationSec?.toFixed(3) ?? "-"}s ` +
        `${run.probe ? `${run.probe.videoCodec}/${run.probe.pixFmt}/${run.probe.colorTransfer}` : ""}`,
    );
    if (run.capture) {
      const { states, candidates, captures, unique, captureMs } = run.capture;
      console.log(
        `      overlay states=${states} candidates=${candidates} captures=${captures} ` +
          `unique=${unique} capture=${(captureMs / 1000).toFixed(1)} s`,
      );
    }
  }
  if (report.metrics) {
    const { psnr, ssim } = report.metrics;
    console.log(
      `  PSNR(10-bit) mean=${psnr.mean.toFixed(2)} dB min=${psnr.min.toFixed(2)} dB @${psnr.minIndex}` +
        ` identical=${psnr.identicalFrames}/${psnr.frames}`,
    );
    console.log(
      `  SSIM(10-bit) mean=${ssim.mean.toFixed(5)} min=${ssim.min.toFixed(5)} @${ssim.minIndex}`,
    );
  }
  if (report.speedup !== undefined)
    console.log(`  speedup (off/on wall) = ${report.speedup.toFixed(2)}x`);
  for (const check of report.checks) {
    console.log(`  ${check.ok ? "PASS" : "FAIL"} ${check.name.padEnd(24)} ${check.detail}`);
  }
  console.log(`  => ${report.ok ? "PASS" : "FAIL"}`);
}

interface FixtureManifest {
  durationSec: number;
  fps: number;
  /** Absent in manifests written before PQ fixtures existed: HLG. */
  transfer?: "hlg" | "pq";
  projects: Array<{ name: string; expect: Expectation; expectReason?: string; dir: string }>;
}

/**
 * Reason a fixture's fallback must log. Manifests written before per-project
 * reasons existed have one negative fixture, the transformed video, which the
 * layout probe rejects as `not_full_canvas` before it reaches the transform.
 */
export function fixtureExpectReason(project: {
  expect: Expectation;
  expectReason?: string;
}): string | undefined {
  if (project.expect !== "fallback") return undefined;
  return project.expectReason ?? "not_full_canvas";
}

/** `--projects a,b`: only the named manifest projects, in manifest order; all when omitted. */
export function selectProjects<T extends { name: string }>(
  projects: readonly T[],
  filter: string | undefined,
): T[] {
  if (filter === undefined) return [...projects];
  const wanted = new Set(
    filter
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const unknown = [...wanted].filter((name) => !projects.some((p) => p.name === name));
  if (unknown.length > 0) throw new Error(`--projects: unknown project(s) ${unknown.join(", ")}`);
  return projects.filter((project) => wanted.has(project.name));
}

function numberOption(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got ${value}`);
  return parsed;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      fixtures: { type: "string" },
      project: { type: "string" },
      out: { type: "string" },
      only: { type: "string", default: "both" },
      expect: { type: "string", default: "passthrough" },
      "expect-reason": { type: "string" },
      transfer: { type: "string" },
      projects: { type: "string" },
      duration: { type: "string" },
      fps: { type: "string", default: "30" },
      workers: { type: "string", default: "1" },
      quality: { type: "string", default: "standard" },
      "render-arg": { type: "string", multiple: true, default: [] },
      cli: { type: "string" },
      ffmpeg: { type: "string", default: process.env.FFMPEG_PATH ?? "ffmpeg" },
      ffprobe: { type: "string", default: process.env.FFPROBE_PATH ?? "ffprobe" },
      "timeout-min": { type: "string", default: "120" },
      "skip-render": { type: "boolean", default: false },
      "min-mean-psnr": { type: "string" },
      "min-psnr": { type: "string" },
      "min-mean-ssim": { type: "string" },
      "min-ssim": { type: "string" },
    },
  });
  const only = values.only;
  if (only !== "off" && only !== "on" && only !== "both")
    throw new Error("--only must be off|on|both");
  const quality = values.quality;
  if (quality !== "draft" && quality !== "standard" && quality !== "high") {
    throw new Error("--quality must be draft|standard|high");
  }
  const transferArg = values.transfer;
  if (transferArg !== undefined && transferArg !== "hlg" && transferArg !== "pq") {
    throw new Error("--transfer must be hlg|pq");
  }
  const expectArg = values.expect;
  if (expectArg !== "passthrough" && expectArg !== "fallback") {
    throw new Error("--expect must be passthrough|fallback");
  }

  const thresholds: ParityThresholds = {
    ...DEFAULT_THRESHOLDS,
    minMeanPsnrDb: numberOption(
      values["min-mean-psnr"],
      DEFAULT_THRESHOLDS.minMeanPsnrDb,
      "min-mean-psnr",
    ),
    minFramePsnrDb: numberOption(values["min-psnr"], DEFAULT_THRESHOLDS.minFramePsnrDb, "min-psnr"),
    minMeanSsim: numberOption(
      values["min-mean-ssim"],
      DEFAULT_THRESHOLDS.minMeanSsim,
      "min-mean-ssim",
    ),
    minFrameSsim: numberOption(values["min-ssim"], DEFAULT_THRESHOLDS.minFrameSsim, "min-ssim"),
  };
  const tools: Tools = {
    cli: values.cli ? values.cli.split(" ").filter(Boolean) : defaultCliCommand(),
    ffmpeg: values.ffmpeg,
    ffprobe: values.ffprobe,
    timeoutMs: numberOption(values["timeout-min"], 120, "timeout-min") * 60_000,
  };
  const fps = numberOption(values.fps, 30, "fps");
  const renderArgs = {
    fps,
    workers: numberOption(values.workers, 1, "workers"),
    quality,
    extraArgs: values["render-arg"],
  } as const;

  const projects: ProjectOptions[] = [];
  if (values.fixtures) {
    const fixturesDir = resolve(values.fixtures);
    const manifest = JSON.parse(
      readFileSync(join(fixturesDir, "fixtures.json"), "utf8"),
    ) as FixtureManifest;
    const outRoot = resolve(values.out ?? join(fixturesDir, "parity"));
    const transfer = transferArg ?? manifest.transfer ?? "hlg";
    const selected = selectProjects(manifest.projects, values.projects);
    for (const project of selected) {
      projects.push({
        projectDir: project.dir,
        outDir: join(outRoot, project.name),
        expect: project.expect,
        expectReason: fixtureExpectReason(project),
        only,
        skipRender: values["skip-render"],
        renderArgs: { ...renderArgs, fps: manifest.fps },
        expected: { fps: manifest.fps, transfer, durationSec: manifest.durationSec },
        thresholds,
      });
    }
  } else if (values.project) {
    const projectDir = resolve(values.project);
    projects.push({
      projectDir,
      // Never inside the project: the render copies the project dir, outputs included.
      outDir: resolve(values.out ?? `${projectDir}-parity`),
      expect: expectArg,
      expectReason: values["expect-reason"],
      only,
      skipRender: values["skip-render"],
      renderArgs,
      expected: {
        fps,
        transfer: transferArg ?? "hlg",
        durationSec: values.duration === undefined ? null : Number(values.duration),
      },
      thresholds,
    });
  } else {
    throw new Error("pass --fixtures <dir> (from fixture.ts) or --project <dir>");
  }

  const reports = projects.map((project) => {
    const report = runProject(tools, project);
    printReport(report);
    writeFileSync(join(project.outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  });
  const ok = reports.every((report) => report.ok);
  console.log(`\n${ok ? "ALL PASS" : "FAILURES"} (${reports.length} project(s))`);
  process.exitCode = ok ? 0 : 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
