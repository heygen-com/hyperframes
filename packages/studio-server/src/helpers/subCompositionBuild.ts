import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

/** A job for the build worker: build a sub-composition page, or pin hf-ids on a page the host transformed. */
export type SubCompositionJob =
  | {
      kind: "build";
      projectDir: string;
      compPath: string;
      compFile: string;
      runtimeUrl: string;
      baseHref?: string;
      gsapBaseUrl?: string;
    }
  | { kind: "ids"; html: string };

/** A sub-composition page that did not build within its deadline. */
export class SubCompositionDeadlineError extends Error {
  constructor(compPath: string) {
    super(`${compPath} took too long to build`);
    this.name = "SubCompositionDeadlineError";
  }
}

/** A build gets this long; a page still parsing then is ended with its worker. */
export const SUB_COMPOSITION_DEADLINE_MS = 30_000;

interface Pending {
  job: SubCompositionJob;
  resolve: (html: string | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The worker beside this module: the built .js in dist (studio-server's and the CLI's), else the .ts source. */
function workerEntry(): { url: URL; execArgv?: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const js = join(here, "subCompositionWorker.js");
  if (existsSync(js)) return { url: pathToFileURL(js) };
  const execArgv = [...process.execArgv];
  // Source runs (tests, bun dev) load the .ts entry through tsx, as shaderTransitionWorkerPool does.
  if (!execArgv.some((arg) => arg.includes("tsx") || arg === "--import")) {
    execArgv.push(
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href,
    );
  }
  return { url: pathToFileURL(join(here, "subCompositionWorker.ts")), execArgv };
}

const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let nextId = 0;

function startWorker(): Worker {
  const { url, execArgv } = workerEntry();
  const started = new Worker(url, { execArgv });
  started.unref();
  started.on(
    "message",
    ({ id, html, error }: { id: number; html?: string | null; error?: string }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      if (error !== undefined) job.reject(new Error(error));
      else job.resolve(html ?? null);
    },
  );
  started.on("error", (error) => replace(started, error));
  started.on("exit", (code) => replace(started, new Error(`the build worker exited (${code})`)));
  return started;
}

/** Ends `from` if it is still the worker. A crash (`failed`) fails every build it held, since any of them may be what
 * crashed it; after a deadline the culprit is gone, so the rest go to a fresh worker. */
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

/** `job` on the build worker, refused with SubCompositionDeadlineError once `deadline` (performance.now() time) passes.
 * The request thread stays free meanwhile, and a page that never finishes is ended with its worker.
 * @param compPath names the page in the refusal */
export function runOffThread(
  job: SubCompositionJob,
  deadline: number,
  compPath: string,
): Promise<string | null> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new SubCompositionDeadlineError(compPath));
        if (worker) replace(worker);
      },
      Math.max(0, deadline - performance.now()),
    );
    timer.unref?.();
    pending.set(id, { job, resolve, reject, timer });
    (worker ??= startWorker()).postMessage({ id, job });
  });
}

/** `work`, refused with SubCompositionDeadlineError once `deadline` (performance.now() time) passes; the work itself
 * goes on, as nothing can end it. @param compPath names the page in the refusal */
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
