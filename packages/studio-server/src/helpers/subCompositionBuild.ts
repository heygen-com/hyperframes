import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { STUDIO_PREVIEW_PAGE_DEADLINE_MS } from "@hyperframes/core/studio-preview-mark";

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
  options: {
    capture: boolean;
    gsapBaseUrl: string;
    gsapMirror?: string | null;
    sandboxedCapture: boolean;
  };
  variables?: Record<string, unknown>;
}

export interface BaseJob {
  kind: "base";
  html: string;
  projectId: string;
  runtimeUrl: string;
}

export interface PartsJob {
  kind: "parts";
  html: string;
  ignore: string[];
}

export interface CompositionsJob {
  kind: "compositions";
  projectDir: string;
  files: string[];
  keptBackForPageInProgressMs: number;
}

export type SubCompositionJob = BuildJob | BaseJob | FinishJob | PartsJob | CompositionsJob;
type Result<J> = J extends BuildJob
  ? { html: string; references: string[] } | { refused: string } | null
  : J extends BaseJob
    ? { html: string; references: string[] }
    : J extends CompositionsJob
      ? { compositions: string[]; unchecked: number }
      : string;

export class SubCompositionDeadlineError extends Error {
  readonly queued: boolean;
  constructor(compPath: string, queued = false) {
    super(`${compPath} took too long to build`);
    this.name = "SubCompositionDeadlineError";
    this.queued = queued;
  }
}

export const SUB_COMPOSITION_DEADLINE_MS = 30_000;
export const ROOT_PREVIEW_DEADLINE_MS = STUDIO_PREVIEW_PAGE_DEADLINE_MS;

interface Pending {
  job: SubCompositionJob;
  deadline: number;
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

// Jobs in order. Only `running` has reached the worker, so one dropped while it waits never does.
const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let running: number | null = null;
let nextId = 0;

function handOverNext(): void {
  if (running !== null) return;
  for (const [id, { job, deadline }] of pending) {
    running = id;
    worker ??= startWorker();
    worker.postMessage({ id, job, timeLeftMs: deadline - performance.now() });
    return;
  }
}

function startWorker(): Worker {
  const started = new Worker(workerEntry());
  started.on(
    "message",
    ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
      const job = untrack(id);
      handOverNext();
      if (!job) return;
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

function holdHostWhileBusy(): void {
  if (pending.size === 0) worker?.unref();
  else worker?.ref();
}

function track(id: number, job: Pending): void {
  pending.set(id, job);
  holdHostWhileBusy();
}

function untrack(id: number): Pending | undefined {
  const job = pending.get(id);
  if (!job) return undefined;
  pending.delete(id);
  if (running === id) running = null;
  clearTimeout(job.timer);
  holdHostWhileBusy();
  return job;
}

/** Ends `from` if it is still the worker. A crash (`failed`) fails every job it held, since any of them may be what
 * crashed it; after the running job's deadline, the rest go to a fresh worker. */
function replace(from: Worker, failed?: Error): void {
  if (worker !== from) return;
  worker = null;
  running = null;
  void from.terminate();
  if (failed) for (const id of [...pending.keys()]) untrack(id)?.reject(failed);
  handOverNext();
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
        const wasRunning = running === id;
        untrack(id);
        reject(new SubCompositionDeadlineError(compPath, !wasRunning));
        if (wasRunning && worker) replace(worker);
      },
      Math.max(0, deadline - performance.now()),
    );
    timer.unref?.();
    track(id, { job, deadline, resolve: resolve as (result: unknown) => void, reject, timer });
    handOverNext();
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
