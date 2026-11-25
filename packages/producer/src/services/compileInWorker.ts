import { existsSync, rmSync } from "node:fs";
import { ffmpegCwd } from "@hyperframes/parsers/ff-binaries";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  compileForRender,
  type CompiledComposition,
  type CompileForRenderOptions,
} from "./htmlCompiler.js";

/**
 * Production compiles over 7 days (1.3M renders) took 18 s at p99.9 and 154 s at most, so ten
 * minutes ends only a compile that has stopped making progress. `HYPERFRAMES_COMPILE_TIMEOUT_MS`
 * overrides it.
 */
const DEFAULT_COMPILE_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINATE_GRACE_MS = 2_000;
// Video advisories keep running after the compile returns; they get this long, then the thread ends.
const ADVISORY_GRACE_MS = 30_000;
// setTimeout runs a longer delay after 1 ms, which would end every compile at once.
const MAX_TIMER_MS = 2 ** 31 - 1;

class CompileTimeoutError extends Error {
  readonly code = "COMPILE_TIMEOUT" as const;
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly publicMetadata: Readonly<{ timeoutMs: number }>;

  constructor(timeoutMs: number) {
    super(
      `Compiling the composition took longer than ${Math.round(timeoutMs / 1000)} s, so it was stopped. ` +
        "Very large pages, or pages with very many style rules or media tags, are the usual cause.",
    );
    this.name = "CompileTimeoutError";
    this.publicMetadata = { timeoutMs };
  }
}

function compileTimeoutMs(): number {
  const fromEnv = Number(process.env.HYPERFRAMES_COMPILE_TIMEOUT_MS);
  return Number.isInteger(fromEnv) && fromEnv > 0
    ? Math.min(fromEnv, MAX_TIMER_MS)
    : DEFAULT_COMPILE_TIMEOUT_MS;
}

let warnedMissingEntry = false;

const endOnProcessExit = new Set<() => void>();
let processExitHooked = false;
function onProcessExit(end: () => void): () => void {
  if (!processExitHooked) {
    processExitHooked = true;
    process.on("exit", () => {
      for (const each of endOnProcessExit) each();
    });
  }
  endOnProcessExit.add(end);
  return () => endOnProcessExit.delete(end);
}

function tryQuietly(action: () => void): void {
  try {
    action();
  } catch {
    // Best effort: one child or file that can't be ended must not stop the rest.
  }
}

/**
 * The published build emits the compile worker beside this module. Bundles that inline the producer
 * (the CLI, Lambda, other servers built on it) don't, so they name it with `HF_COMPILE_WORKER_ENTRY`
 * or compile in-process as before.
 */
function resolveCompileWorkerEntry(
  explicit: string | undefined,
  log: CompileForRenderOptions["log"],
): string | undefined {
  if (explicit) return explicit;
  const fromEnv = process.env.HF_COMPILE_WORKER_ENTRY;
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    if (!warnedMissingEntry) {
      warnedMissingEntry = true;
      log?.warn(
        "[Compiler] HF_COMPILE_WORKER_ENTRY names a missing file, so compiles run on the main thread with no deadline",
        { entry: fromEnv },
      );
    }
    return undefined;
  }
  const sibling = join(dirname(fileURLToPath(import.meta.url)), "compileWorker.js");
  return existsSync(sibling) ? sibling : undefined;
}

type SerializedError = { name: string; message: string; stack?: string; props: object };

function rebuildError({ name, message, stack, props }: SerializedError): Error {
  const error = Object.assign(new Error(message), props);
  error.name = name;
  if (stack) error.stack = stack;
  return error;
}

/**
 * {@link compileForRender} on a worker thread. A compile that runs past its deadline ends with a
 * {@link CompileTimeoutError}, and `options.abortSignal` ends it with the signal's reason. Either
 * way the thread is stopped, even inside a synchronous pass, and this thread stays free meanwhile.
 */
export async function compileForRenderInWorker(
  projectDir: string,
  htmlPath: string,
  downloadDir: string,
  options: CompileForRenderOptions = {},
  worker: { entry?: string; timeoutMs?: number } = {},
): Promise<CompiledComposition> {
  const { log, abortSignal, ...cloneable } = options;
  const entry = resolveCompileWorkerEntry(worker.entry, log);
  if (!entry) return compileForRender(projectDir, htmlPath, downloadDir, options);
  abortSignal?.throwIfAborted();
  const timeoutMs = worker.timeoutMs ?? compileTimeoutMs();

  return new Promise<CompiledComposition>((resolve, reject) => {
    const thread = new Worker(entry, {
      workerData: {
        projectDir,
        htmlPath,
        downloadDir,
        options: cloneable,
        emptyFolder: ffmpegCwd() !== undefined,
      },
    });
    const children = new Map<number, string | undefined>();
    const scratchRoots = [downloadDir, options.animatedGifCacheDir].flatMap((dir) =>
      dir ? [resolvePath(dir)] : [],
    );
    const isScratch = (path: string) =>
      scratchRoots.some((root) => {
        const rel = relative(root, resolvePath(path));
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      });
    // Only while the thread lives: an exited child it hasn't reported is still its zombie, so the pid is not reused.
    const endChildren = (signal: boolean) => {
      for (const [pid, output] of children) {
        if (signal) tryQuietly(() => process.kill(pid, "SIGKILL"));
        if (output) tryQuietly(() => rmSync(output, { force: true }));
      }
      children.clear();
    };
    const offProcessExit = onProcessExit(() => endChildren(true));
    const endThread = () => {
      endChildren(true);
      void thread.terminate();
    };
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      finish();
    };
    const stop = () => {
      thread.postMessage({ type: "abort" });
      setTimeout(endThread, TERMINATE_GRACE_MS).unref();
    };
    const timer = setTimeout(() => {
      stop();
      settle(() => reject(new CompileTimeoutError(timeoutMs)));
    }, timeoutMs);
    const onAbort = () => {
      stop();
      settle(() => reject(abortSignal?.reason ?? new Error("Compile aborted")));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    // Once answered, the thread may still hold downloads or probes; it never keeps the process open
    // and ends after the grace.
    const retire = (graceMs: number) => {
      thread.unref();
      setTimeout(endThread, graceMs).unref();
    };

    thread.on(
      "message",
      (message: {
        type: string;
        level?: "error" | "warn" | "info" | "debug";
        message?: string;
        meta?: Record<string, unknown>;
        compiled?: CompiledComposition;
        error?: SerializedError;
      }) => {
        if (message.type === "log" && message.level) {
          log?.[message.level](message.message ?? "", message.meta);
        } else if (message.type === "result" && message.compiled) {
          const { compiled } = message;
          settle(() => resolve(compiled));
          retire(ADVISORY_GRACE_MS);
        } else if (message.type === "error" && message.error) {
          const { error } = message;
          settle(() => reject(rebuildError(error)));
          thread.postMessage({ type: "abort" });
          retire(TERMINATE_GRACE_MS);
        }
      },
    );
    thread.on(
      "message",
      ({ type, pid, output }: { type: string; pid?: number; output?: string }) => {
        if (pid === undefined) return;
        if (type === "child") children.set(pid, output && isScratch(output) ? output : undefined);
        else if (type === "childExit") children.delete(pid);
      },
    );
    thread.on("error", (error) => settle(() => reject(error)));
    thread.on("exit", (code) => {
      offProcessExit();
      // Its teardown has waited on its children, so their pids may be free; ffmpeg's own limits end any left running.
      endChildren(false);
      settle(() =>
        reject(new Error(`The compile worker exited with code ${code} before answering`)),
      );
    });
  });
}
