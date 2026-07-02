/**
 * Worker-thread health endpoint.
 *
 * Runs an HTTP server (`/health`, returns 200 OK with uptime+timestamp JSON)
 * on a *separate* Node worker_thread so probe responses don't depend on the
 * main event loop. The main thread can be deep in a long-running synchronous
 * task (Chrome teardown, large file I/O, GC pause, the post-Miguel guard
 * "impossible duration" math, etc.) and this endpoint still answers within
 * milliseconds because it lives in a different V8 isolate with its own
 * event loop.
 *
 * Why this matters
 * ----------------
 *
 * The producer sidecar's k8s `livenessProbe` / `readinessProbe` hit `/health`
 * on the Hono server in the main thread. Any synchronous stall longer than
 * the probe `timeoutSeconds` (5s in prod prior to the companion change)
 * triggers a SIGKILL even when the process is still alive — just busy.
 *
 * Today's incident (2026-06-26): an infinite GSAP timeline caused the
 * distributed planner to try to enumerate ~300_000_000_000 frames, and
 * the sidecar got killed mid-arithmetic. Miguel's upstream `plan()`
 * duration guard kills that input class at the source. This module is
 * defense-in-depth: future wedge classes (sync I/O on video-heavy comps,
 * runaway loops, GC pauses) shouldn't kill an otherwise-alive pod either.
 *
 * Contract
 * --------
 *
 * - The worker thread binds an HTTP listener on
 *   `PRODUCER_HEALTH_PORT` (default 9848) for `/health` only.
 * - Liveness in the worker thread = "the worker_thread itself is responsive",
 *   which is a strict subset of process liveness. If the entire Node process
 *   is dead the OS tears down both threads' sockets simultaneously, so the
 *   worker_thread's listener stops answering and k8s correctly kills the pod.
 * - Listening on `0.0.0.0` is intentional: this is the probe entry point and
 *   the sidecar already exposes other ports for in-pod traffic only. The
 *   endpoint returns the same shape the main-thread `/health` always returned
 *   so existing observability keeps working.
 *
 * The main thread still serves `/health` on the main port (9847) for
 * backwards compatibility; k8s probe config in `heygen-com/app` can migrate
 * to the worker port at its own pace.
 */

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

export interface HealthWorkerOptions {
  /** Port the worker_thread health endpoint listens on. Default 9848 / env. */
  port?: number;
  /**
   * Optional logger; falls back to console. Note: the worker thread itself
   * cannot use the parent's logger directly (separate isolate), so it logs
   * via `console`. The handle returned here uses the provided logger for
   * lifecycle events on the *main* thread.
   */
  logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /**
   * Override worker entry module. Falls back to a co-located
   * `healthWorkerThread.js` (post-build) or `.ts` (dev/test).
   */
  workerEntry?: string;
}

export interface HealthWorkerHandle {
  /** Port the listener is bound to (resolved). */
  port: number;
  /** Stop the listener + terminate the worker thread. Idempotent. */
  shutdown: () => Promise<void>;
}

const DEFAULT_HEALTH_PORT = 9848;

/**
 * Spawn the health worker_thread. Returns once the worker reports its
 * listener is up (or rejects if the worker fails to start).
 */
export async function startHealthWorker(
  options: HealthWorkerOptions = {},
): Promise<HealthWorkerHandle> {
  const log = options.logger ?? defaultLogger();
  const port =
    options.port ?? parseInt(process.env.PRODUCER_HEALTH_PORT ?? String(DEFAULT_HEALTH_PORT), 10);

  const entry = options.workerEntry ?? resolveWorkerEntry();
  if (!entry) {
    throw new Error(
      "[healthWorker] could not resolve worker entry. " +
        "Pass options.workerEntry or ensure healthWorkerThread.{js,ts} is co-located.",
    );
  }

  const worker = new Worker(entry, {
    workerData: { port },
    // Keep stdio inherited so the worker's console logs land in the pod logs
    // alongside the main thread's.
    stdout: false,
    stderr: false,
  });

  // Wait for the worker to report "listening" before resolving, so callers
  // can be sure the probe endpoint is actually up.
  await new Promise<void>((resolve, reject) => {
    const onMessage = (msg: { type: string; error?: string }) => {
      if (msg?.type === "listening") {
        worker.off("error", onError);
        worker.off("message", onMessage);
        resolve();
      } else if (msg?.type === "listen-error") {
        worker.off("error", onError);
        worker.off("message", onMessage);
        reject(new Error(`[healthWorker] failed to bind port ${port}: ${msg.error}`));
      }
    };
    const onError = (err: Error) => {
      worker.off("error", onError);
      worker.off("message", onMessage);
      reject(err);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
  });

  log.info?.(`[healthWorker] /health listening on worker thread, port ${port}`);

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        worker.postMessage({ type: "shutdown" });
        // Give the worker a beat to close its server cleanly. terminate()
        // is the hard backstop.
        await Promise.race([
          new Promise<void>((res) => worker.once("exit", () => res())),
          new Promise<void>((res) => setTimeout(res, 2_000)),
        ]);
      } finally {
        await worker.terminate().catch(() => {});
      }
    })();
    return shutdownPromise;
  };

  // If the worker crashes unexpectedly, log loudly. We don't auto-respawn
  // here — the k8s probe will catch a dead listener and the pod will be
  // restarted, which is the right behavior for a truly-broken process.
  worker.on("error", (err: Error) => {
    log.error?.(`[healthWorker] worker thread error: ${err.message}`);
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      log.warn?.(`[healthWorker] worker thread exited with code ${code}`);
    }
  });

  return { port, shutdown };
}

function defaultLogger() {
  return {
    info: (msg: string) => console.log(msg),
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
  };
}

/**
 * Try to find the co-located worker entry file. Prefer the compiled `.js`
 * (production) and fall back to the `.ts` source (dev / vitest via tsx).
 */
function resolveWorkerEntry(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "healthWorkerThread.js"), join(here, "healthWorkerThread.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
