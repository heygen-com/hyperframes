import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { repoRoot, prepareProjectDir, preparedCompositionEntry } from "./registry.ts";
import type { RegistryItem } from "./types.ts";

export const FORK_SHA = "17b852784bf3922a42b3aa9801db647423073a13";
export const DEFAULT_BASELINE_DIR = "/Users/miguel07code/dev/hyperframes-animejs-eval/baselines";

export type EvalLogger = {
  log: (message: string) => void;
  chunk?: (message: string) => void;
};

export function createFileLogger(logPath: string): EvalLogger & { close: () => Promise<void> } {
  mkdirSync(dirname(logPath), { recursive: true });
  const stream = createWriteStream(logPath, { flags: "a" });
  return {
    log(message: string): void {
      const line = `[${new Date().toISOString()}] ${message}`;
      console.log(line);
      stream.write(`${line}\n`);
    },
    chunk(message: string): void {
      process.stdout.write(message);
      stream.write(message);
    },
    close(): Promise<void> {
      return new Promise((resolveClose) => {
        stream.end(resolveClose);
      });
    },
  };
}

export function baselineVideoRelativePath(item: RegistryItem, forkSha: string): string {
  return join(forkSha.slice(0, 12), item.kind, `${item.name}.mp4`);
}

export function baselineVideoPath(
  baselineDir: string,
  item: RegistryItem,
  forkSha: string,
): string {
  return join(baselineDir, baselineVideoRelativePath(item, forkSha));
}

export function builtCliPath(): string {
  return join(repoRoot, "packages/cli/dist/cli.js");
}

export function runCleanBuild(logger: EvalLogger): void {
  runChecked("bun", ["install"], logger, "bun install");
  runChecked("bun", ["run", "build"], logger, "bun run build");
}

export async function renderItemToVideo(input: {
  item: RegistryItem;
  outputPath: string;
  logger: EvalLogger;
  keepProjectDir?: boolean;
}): Promise<void> {
  const cliPath = builtCliPath();
  if (!existsSync(cliPath)) {
    throw new Error(`Built CLI not found at ${cliPath}; run bun run build first`);
  }
  mkdirSync(dirname(input.outputPath), { recursive: true });

  const tempRoot = await mkdtemp(join(tmpdir(), "hf-gsap-baseline-"));
  let projectDir = "";
  try {
    projectDir = prepareProjectDir(input.item, tempRoot);
    const compositionEntry = preparedCompositionEntry(projectDir, input.item);
    await runRenderCommand({
      cliPath,
      projectDir,
      compositionEntry,
      outputPath: input.outputPath,
      fps: input.item.fps,
      logger: input.logger,
    });
  } finally {
    if (!input.keepProjectDir) {
      rmSync(tempRoot, { recursive: true, force: true });
    } else if (projectDir) {
      input.logger.log(`Kept staged project: ${projectDir}`);
    }
  }
}

function runChecked(command: string, args: string[], logger: EvalLogger, label: string): void {
  logger.log(`start ${label}`);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status)}`);
  }
  logger.log(`done ${label} in ${Date.now() - started}ms`);
}

function runRenderCommand(input: {
  cliPath: string;
  projectDir: string;
  compositionEntry: string;
  outputPath: string;
  fps: number;
  logger: EvalLogger;
}): Promise<void> {
  const args = [
    input.cliPath,
    "render",
    resolve(input.projectDir),
    "--composition",
    input.compositionEntry,
    "--output",
    resolve(input.outputPath),
    "--format",
    "mp4",
    "--quality",
    "standard",
    "--fps",
    String(input.fps),
    "--workers",
    "1",
  ];

  input.logger.log(`render command: node ${args.map(shellToken).join(" ")}`);
  return new Promise((resolveRender, rejectRender) => {
    const child = spawn("node", args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PRODUCER_LOW_MEMORY_MODE: process.env.PRODUCER_LOW_MEMORY_MODE ?? "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => input.logger.chunk?.(chunk.toString("utf-8")));
    child.stderr.on("data", (chunk: Buffer) => input.logger.chunk?.(chunk.toString("utf-8")));
    child.on("error", rejectRender);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRender();
      } else {
        rejectRender(new Error(`render command failed with exit code ${String(code)}`));
      }
    });
  });
}

function shellToken(token: string): string {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(token)) return token;
  return JSON.stringify(token);
}
