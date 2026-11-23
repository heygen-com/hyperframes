import {
  existsSync,
  readFileSync,
  statSync,
  openSync,
  fstatSync,
  closeSync,
  constants,
} from "node:fs";
import { resolve, join, relative, isAbsolute, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { HyperframeLintResult } from "@hyperframes/lint";

export interface PreparedHyperframeLintInput {
  entryFile: string;
  html: string;
  source: "projectDir" | "files" | "html";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function pickEntryFile(files: Record<string, string>, preferredEntryFile?: string): string | null {
  const candidates: string[] = [];
  if (preferredEntryFile) {
    candidates.push(preferredEntryFile);
  }
  candidates.push("index.html", "src/index.html");

  for (const candidate of candidates) {
    const value = files[candidate];
    if (typeof value === "string" && value.length > 0) {
      return candidate;
    }
  }

  for (const [fileName, content] of Object.entries(files)) {
    if (fileName.toLowerCase().endsWith(".html") && content.length > 0) {
      return fileName;
    }
  }

  return null;
}

function readEntryHtml(filePath: string): string | null {
  let fd: number;
  try {
    // Opening a named pipe must not wait for a writer before fstat can reject it.
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return null;
    // Classify platform-specific directory/socket errors only after open fails.
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) return null;
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd, "utf-8");
  } finally {
    closeSync(fd);
  }
}

function leavesProject(
  absProjectDir: string,
  absoluteEntryPath: string,
  isAllowedEntry?: (absolutePath: string) => boolean,
): boolean {
  const entryRelativePath = relative(absProjectDir, absoluteEntryPath);
  return (
    entryRelativePath === ".." ||
    entryRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(entryRelativePath) ||
    (isAllowedEntry !== undefined && !isAllowedEntry(absoluteEntryPath))
  );
}

function readProjectEntryFile(
  projectDir: string,
  preferredEntryFile?: string,
  isAllowedEntry?: (absolutePath: string) => boolean,
): PreparedHyperframeLintInput | { error: string } {
  const absProjectDir = resolve(projectDir);
  if (!existsSync(absProjectDir) || !statSync(absProjectDir).isDirectory()) {
    return { error: `Project directory not found: ${absProjectDir}` };
  }

  const entryCandidates = [preferredEntryFile, "index.html", "src/index.html"].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  for (const entryFile of entryCandidates) {
    const absoluteEntryPath = resolve(absProjectDir, entryFile);
    if (leavesProject(absProjectDir, absoluteEntryPath, isAllowedEntry)) {
      return { error: `Entry file must stay inside project directory: ${entryFile}` };
    }
    const html = readEntryHtml(absoluteEntryPath);
    if (html !== null) {
      return {
        entryFile,
        html,
        source: "projectDir",
      };
    }
  }

  return {
    error: `No HTML entry file found in project directory: ${join(absProjectDir, preferredEntryFile || "index.html")}`,
  };
}

export function prepareHyperframeLintBody(
  body: Record<string, unknown>,
  isAllowedEntry?: (absolutePath: string) => boolean,
): { prepared: PreparedHyperframeLintInput } | { error: string } {
  const requestedEntryFile =
    typeof body.entryFile === "string" && body.entryFile.trim().length > 0
      ? body.entryFile.trim()
      : undefined;

  if (typeof body.projectDir === "string" && body.projectDir.trim().length > 0) {
    const prepared = readProjectEntryFile(body.projectDir, requestedEntryFile, isAllowedEntry);
    if ("error" in prepared) {
      return prepared;
    }
    return { prepared };
  }

  if (isStringRecord(body.files)) {
    const entryFile = pickEntryFile(body.files, requestedEntryFile);
    if (!entryFile) {
      return { error: "No HTML entry file found in files payload" };
    }
    return {
      prepared: {
        entryFile,
        html: body.files[entryFile] ?? "",
        source: "files",
      },
    };
  }

  if (typeof body.html === "string") {
    return {
      prepared: {
        entryFile: requestedEntryFile || "index.html",
        html: body.html,
        source: "html",
      },
    };
  }

  return { error: "Missing lint source: provide projectDir, files, or html" };
}

const LINT_HEAP_MB = 512;
const LINT_TIMEOUT_MS = 15_000;
const LINT_MAX_WORKERS = 2;

const waiting: Array<() => void> = [];
let running = 0;

function takeLintSlot(limit: number, waitMs: number): Promise<boolean> {
  if (running < limit) {
    running++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const entry = () => {
      clearTimeout(timer);
      running++;
      resolve(true);
    };
    const timer = setTimeout(
      () => {
        waiting.splice(waiting.indexOf(entry), 1);
        resolve(false);
      },
      Math.max(0, waitMs),
    );
    waiting.push(entry);
  });
}

function freeLintSlot(): void {
  running--;
  waiting.shift()?.();
}

export interface HyperframeLintWorkerOptions {
  workerEntry?: string;
  timeoutMs?: number;
  heapMb?: number;
  maxWorkers?: number;
}

function resolveLintWorkerEntry(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const name of ["hyperframeLintWorker.js", "hyperframeLintWorker.ts"]) {
    const candidate = join(here, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function abortedLintResult(filePath: string, afterMs: number): HyperframeLintResult {
  return {
    ok: false,
    errorCount: 1,
    warningCount: 0,
    infoCount: 0,
    findings: [
      {
        code: "lint_aborted",
        severity: "error",
        message:
          "This composition's script could not be checked: linting it ran too long or out of memory, so it was stopped. A very large or deeply nested script is the usual cause.",
        file: filePath,
      },
    ],
    timings: { totalMs: afterMs, groupMs: {}, slowestRule: "", slowestRuleMs: 0 },
  };
}

export async function runHyperframeLint(
  prepared: PreparedHyperframeLintInput,
  options: HyperframeLintWorkerOptions = {},
): Promise<HyperframeLintResult> {
  const began = performance.now();
  const aborted = () =>
    abortedLintResult(prepared.entryFile, Math.round(performance.now() - began));
  const entry = options.workerEntry ?? resolveLintWorkerEntry();
  if (!entry) return aborted();

  const timeoutMs = options.timeoutMs ?? LINT_TIMEOUT_MS;
  const gotSlot = await takeLintSlot(options.maxWorkers ?? LINT_MAX_WORKERS, timeoutMs);
  if (!gotSlot) return aborted();
  const remainingMs = Math.max(0, timeoutMs - (performance.now() - began));

  return new Promise<HyperframeLintResult>((resolvePromise, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(entry, {
        workerData: {
          html: prepared.html,
          opts: { filePath: prepared.entryFile, compSrcPath: prepared.entryFile },
        },
        resourceLimits: { maxOldGenerationSizeMb: options.heapMb ?? LINT_HEAP_MB },
        stdout: false,
        stderr: false,
      });
    } catch {
      freeLintSlot();
      resolvePromise(aborted());
      return;
    }
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().finally(freeLintSlot);
      finish();
    };
    const timer = setTimeout(() => settle(() => resolvePromise(aborted())), remainingMs);
    worker.on("message", (message: { result?: HyperframeLintResult; error?: string }) =>
      settle(() =>
        message.result ? resolvePromise(message.result) : reject(new Error(message.error)),
      ),
    );
    worker.on("error", () => settle(() => resolvePromise(aborted())));
    worker.on("exit", () => settle(() => resolvePromise(aborted())));
  });
}
