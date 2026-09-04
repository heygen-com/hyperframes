#!/usr/bin/env tsx
/**
 * Sandbox-backed 3-run bench for heygen-promo-preview-assets.
 *
 *   bun src/cloudflareSandboxBench.ts --runs 3 --output-json <path>
 *
 * Requires HF_SANDBOX_URL (wrangler dev or deployed worker). Without it,
 * exits 2 after writing launch-unavailable.log next to --output-json.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ChunkResult } from "./services/distributed/renderChunk.js";
import {
  renderViaSandboxes,
  sandboxRenderToPerfSummary,
  type ChunkExecutor,
  type SandboxRenderResult,
} from "./services/distributed/cloudflareSandbox.js";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const producerRoot = resolve(scriptDir, "..");
const defaultFixture = join(producerRoot, "tests/heygen-promo-preview-assets/src");

interface BenchArgs {
  runs: number;
  outputJson: string;
  fixture: string;
  workerUrl: string | null;
}

interface RemotePlan {
  meta: { chunkCount: number; totalFrames: number; fps: number };
  planTar: Buffer;
}

type PerfSummary = ReturnType<typeof sandboxRenderToPerfSummary>;

function applyFlag(args: BenchArgs, flag: string, value: string): void {
  if (flag === "--runs") args.runs = Number(value);
  else if (flag === "--output-json") args.outputJson = resolve(value);
  else if (flag === "--fixture") args.fixture = resolve(value);
  else if (flag === "--worker-url") args.workerUrl = value;
}

function parseArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    runs: 3,
    outputJson: join(producerRoot, "tests/perf/sandbox-benchmark-results.json"),
    fixture: defaultFixture,
    workerUrl: process.env.HF_SANDBOX_URL ?? null,
  };
  for (let i = 2; i < argv.length; i++) {
    const value = argv[i + 1];
    if (value) {
      applyFlag(args, argv[i]!, value);
      if (argv[i]?.startsWith("--")) i += 1;
    }
  }
  return args;
}

function tarDirectory(dir: string, outFile: string): void {
  execFileSync("tar", ["-czf", outFile, "-C", dir, "."], { stdio: "pipe" });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function curlJson(
  url: string,
  bodyPath?: string,
  maxTimeSec = 90,
): Promise<Record<string, unknown>> {
  const args = ["-sS", "--max-time", String(maxTimeSec), "-X", "POST", url];
  if (bodyPath) args.push("--data-binary", `@${bodyPath}`);
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout.toString("utf-8")) as Record<string, unknown>;
}

async function writePlanAttempt(
  base: string,
  chunkIndex: number,
  planTarPath: string,
): Promise<string | null> {
  try {
    const write = await curlJson(`${base}/write-plan?chunk=${chunkIndex}`, planTarPath, 90);
    return write.ok === true ? null : JSON.stringify(write);
  } catch (err) {
    return errorText(err);
  }
}

async function writePlanWithRetry(
  base: string,
  chunkIndex: number,
  planTarPath: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const lastError = await writePlanAttempt(base, chunkIndex, planTarPath);
    if (lastError === null) return;
    console.log(
      `    write-plan hf-chunk-${chunkIndex} retry ${attempt}: ${lastError.slice(0, 200)}`,
    );
    if (attempt === 3) {
      throw new Error(
        `write-plan hf-chunk-${chunkIndex} failed after retries: ${lastError.slice(0, 500)}`,
      );
    }
  }
}

function chunkResultFromPayload(
  outputChunkPath: string,
  payload: Record<string, unknown>,
): ChunkResult {
  mkdirSync(dirname(outputChunkPath), { recursive: true });
  writeFileSync(outputChunkPath, Buffer.from(payload.mp4Base64 as string, "base64"));
  const elapsedMs = typeof payload.elapsedMs === "number" ? payload.elapsedMs : 0;
  return {
    outputPath: outputChunkPath,
    outputKind: "file",
    framesEncoded: 0,
    sha256: "",
    durationMs: elapsedMs,
    planHashMs: 0,
    sessionBootMs: 0,
    captureStageMs: elapsedMs,
    encodeStageMs: 0,
    workers: 1,
    perfPath: `${outputChunkPath}.json`,
  };
}

async function renderChunkAttempt(
  base: string,
  chunkIndex: number,
): Promise<Record<string, unknown>> {
  try {
    return await curlJson(`${base}/render-chunk?chunk=${chunkIndex}`, undefined, 300);
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

async function executeRemoteChunk(
  workerUrl: string,
  planTarPath: string,
  chunkIndex: number,
  sandboxId: string,
  outputChunkPath: string,
): Promise<ChunkResult> {
  const base = workerUrl.replace(/\/$/, "");
  let payload: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`    render-chunk ${sandboxId}${attempt > 1 ? ` retry ${attempt}` : ""}`);
    payload = await renderChunkAttempt(base, chunkIndex);
    if (payload.ok === true && typeof payload.mp4Base64 === "string") {
      return chunkResultFromPayload(outputChunkPath, payload);
    }
    await writePlanWithRetry(base, chunkIndex, planTarPath);
  }
  throw new Error(`render-chunk ${sandboxId} failed: ${JSON.stringify(payload).slice(0, 1500)}`);
}

function cloudflareExecutor(workerUrl: string, planTarPath: string): ChunkExecutor {
  return ({ chunkIndex, sandboxId, outputChunkPath }) =>
    executeRemoteChunk(workerUrl, planTarPath, chunkIndex, sandboxId, outputChunkPath);
}

async function probeWorker(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function planRemotely(workerUrl: string, projectTarPath: string): Promise<RemotePlan> {
  const payload = await curlJson(
    `${workerUrl.replace(/\/$/, "")}/plan?chunk=0`,
    projectTarPath,
    90,
  );
  if (
    payload.ok !== true ||
    typeof payload.planTarBase64 !== "string" ||
    typeof payload.meta !== "string"
  ) {
    throw new Error(`remote plan failed: ${JSON.stringify(payload).slice(0, 1500)}`);
  }
  return {
    meta: JSON.parse(payload.meta) as RemotePlan["meta"],
    planTar: Buffer.from(payload.planTarBase64, "base64"),
  };
}

function writeUnavailableLog(outputJson: string, workerUrl: string | null): never {
  const logPath = join(dirname(outputJson), "launch-unavailable.log");
  writeFileSync(
    logPath,
    [
      "Cloudflare sandbox worker is not reachable.",
      `HF_SANDBOX_URL=${workerUrl ?? "(unset)"}`,
      "Start `wrangler dev` in packages/producer/cloudflare-sandbox or deploy and set HF_SANDBOX_URL.",
      `wrangler whoami / docker info should succeed before a remote run.`,
    ].join("\n") + "\n",
    "utf-8",
  );
  console.error(`Sandbox worker unavailable. Wrote ${logPath}`);
  process.exit(2);
}

function reusedRemotePlan(planDir: string, remote: RemotePlan) {
  return async () => ({
    planDir,
    planHash: "remote",
    chunkCount: remote.meta.chunkCount,
    totalFrames: remote.meta.totalFrames,
    fps: remote.meta.fps as 24 | 30 | 60,
    width: 1920,
    height: 1080,
    format: "mp4" as const,
    ffmpegVersion: "remote",
    producerVersion: "remote",
  });
}

async function runOnce(
  workerUrl: string,
  fixture: string,
  projectTarPath: string,
  runDir: string,
): Promise<SandboxRenderResult> {
  const planDir = join(runDir, "plan");
  mkdirSync(planDir, { recursive: true });
  const started = Date.now();
  const remote = await planRemotely(workerUrl, projectTarPath);
  const planTarPath = join(runDir, "plan.tar.gz");
  writeFileSync(planTarPath, remote.planTar);
  execFileSync("tar", ["-xzf", planTarPath, "-C", planDir], { stdio: "pipe" });

  const base = workerUrl.replace(/\/$/, "");
  for (let i = 0; i < remote.meta.chunkCount; i++) {
    console.log(`    write-plan hf-chunk-${i}`);
    await writePlanWithRetry(base, i, planTarPath);
  }

  const result = await renderViaSandboxes({
    projectDir: fixture,
    outputPath: join(runDir, "output.mp4"),
    planDir,
    workDir: runDir,
    maxSandboxes: 10,
    primitives: {
      // Plan already ran on a sandbox (matching worker ffmpeg). Reuse it.
      plan: reusedRemotePlan(planDir, remote),
    },
    executeChunk: cloudflareExecutor(workerUrl, planTarPath),
  });
  result.totalElapsedMs = Date.now() - started;
  result.stages.planMs = Math.max(
    0,
    result.totalElapsedMs - result.stages.captureMs - result.stages.assembleMs,
  );
  return result;
}

function writeResults(
  outputJson: string,
  runs: number,
  runsOut: Array<{ run: number; perfSummary: PerfSummary }>,
): void {
  const avgTotal = Math.round(
    runsOut.reduce((s, r) => s + r.perfSummary.totalElapsedMs, 0) / runsOut.length,
  );
  const results = {
    timestamp: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    runsPerFixture: runs,
    fixtures: [
      {
        fixture: "heygen-promo-preview-assets",
        name: "heygen-promo-preview-assets",
        runs: runsOut,
        averages: {
          totalElapsedMs: avgTotal,
          captureAvgMs: Math.round(
            runsOut.reduce((s, r) => s + (r.perfSummary.captureAvgMs ?? 0), 0) / runsOut.length,
          ),
          stages: runsOut[0]?.perfSummary.stages ?? {},
        },
      },
    ],
  };
  writeFileSync(outputJson, `${JSON.stringify(results, null, 2)}\n`, "utf-8");
  console.log(`\nAverage totalElapsedMs=${avgTotal}`);
  console.log(`Results saved to ${outputJson}`);
}

async function main(): Promise<void> {
  const { runs, outputJson, fixture, workerUrl } = parseArgs(process.argv);
  mkdirSync(dirname(outputJson), { recursive: true });
  if (!workerUrl || !(await probeWorker(workerUrl))) writeUnavailableLog(outputJson, workerUrl);
  if (!existsSync(join(fixture, "index.html"))) {
    throw new Error(`fixture missing index.html: ${fixture}`);
  }

  const workRoot = join(dirname(outputJson), "sandbox-work");
  mkdirSync(workRoot, { recursive: true });
  const projectTarPath = join(workRoot, "project.tar.gz");
  tarDirectory(fixture, projectTarPath);

  const runsOut: Array<{ run: number; perfSummary: PerfSummary }> = [];
  for (let r = 1; r <= runs; r++) {
    console.log(`\n━━━ sandbox run ${r}/${runs} ━━━`);
    const runDir = join(workRoot, `run-${r}`);
    mkdirSync(runDir, { recursive: true });
    const result = await runOnce(workerUrl, fixture, projectTarPath, runDir);
    const summary = sandboxRenderToPerfSummary(result, {
      renderId: randomUUID(),
      workers: result.sandboxIds.length,
    });
    console.log(
      `  ✓ ${summary.totalElapsedMs}ms total | ${summary.totalFrames} frames | ${result.sandboxIds.length} sandboxes`,
    );
    runsOut.push({ run: r, perfSummary: summary });
  }
  writeResults(outputJson, runs, runsOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
