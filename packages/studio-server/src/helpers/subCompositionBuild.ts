import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export interface BuildJob {
  kind: "build";
  projectDir: string;
  compPath: string;
  compFile: string;
  runtimeUrl: string;
  baseHref: string;
  gsapBaseUrl?: string;
}

export interface FinishJob {
  kind: "finish";
  html: string;
  runtimeUrl: string;
  signature: string;
  projectDir: string;
  compPath: string;
  options: { capture: boolean; gsapBaseUrl: string; sandboxedCapture: boolean };
  variables?: Record<string, unknown>;
}

export type SubCompositionJob = BuildJob | FinishJob;
type Result<J> = J extends BuildJob ? { html: string; references: string[] } | null : string;

export class SubCompositionDeadlineError extends Error {
  constructor(compPath: string) {
    super(`${compPath} took too long to build`);
    this.name = "SubCompositionDeadlineError";
  }
}

export const SUB_COMPOSITION_DEADLINE_MS = 30_000;

interface Pending {
  job: SubCompositionJob;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The worker beside this module: the built .js in dist (studio-server's and the CLI's). From source, Bun runs the
 * .ts itself; Node needs the .mjs start, which loads it through tsx (its relative .js imports name .ts files). */
function workerEntry(): URL {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "subCompositionWorker.js");
  if (existsSync(built)) return pathToFileURL(built);
  const source = process.versions.bun ? "subCompositionWorker.ts" : "subCompositionWorker.dev.mjs";
  return pathToFileURL(join(here, source));
}

// Jobs in the order the worker runs them: the first is the one it is running.
const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let nextId = 0;

function startWorker(): Worker {
  const started = new Worker(workerEntry());
  started.unref();
  started.on(
    "message",
    ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      if (error !== undefined) job.reject(new Error(error));
      else job.resolve(result);
    },
  );
  started.on("error", (error: unknown) =>
    replace(started, error instanceof Error ? error : new Error(String(error))),
  );
  started.on("exit", (code) => replace(started, new Error(`the build worker exited (${code})`)));
  return started;
}

/** Ends `from` if it is still the worker. A crash (`failed`) fails every job it held, since any of them may be what
 * crashed it; after the running job's deadline, the rest go to a fresh worker. */
function replace(from: Worker, failed?: Error): void {
  if (worker !== from) return;
  worker = null;
  void from.terminate();
  if (failed) {
    for (const [id, job] of pending) {
      pending.delete(id);
      clearTimeout(job.timer);
      job.reject(failed);
    }
    return;
  }
  if (pending.size === 0) return;
  const next = (worker = startWorker());
  for (const [id, job] of pending) next.postMessage({ id, job: job.job });
}

/** `job` on the build worker, refused past `deadline` (performance.now() time). Only the running job's deadline ends
 * the worker; a queued job past its own is dropped. @param compPath names the page in the refusal */
export function runOffThread<J extends SubCompositionJob>(
  job: J,
  deadline: number,
  compPath: string,
): Promise<Result<J>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        const running = pending.keys().next().value === id;
        pending.delete(id);
        reject(new SubCompositionDeadlineError(compPath));
        if (running && worker) replace(worker);
      },
      Math.max(0, deadline - performance.now()),
    );
    timer.unref?.();
    pending.set(id, { job, resolve: resolve as (result: unknown) => void, reject, timer });
    (worker ??= startWorker()).postMessage({ id, job });
  });
}

/** `work`, refused past `deadline`; the work itself goes on, as nothing can end it. */
export function withinDeadline<T>(
  work: Promise<T>,
  deadline: number,
  compPath: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SubCompositionDeadlineError(compPath)),
      Math.max(0, deadline - performance.now()),
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
