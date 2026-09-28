/**
 * Pool of Node `worker_threads` Workers for off-main-thread shader-blend
 * execution. See `shaderTransitionWorker.ts` for the per-worker contract and
 * the hf#677 follow-up rationale (closing the JS event-loop ceiling on the
 * layered transition path).
 *
 * Pool shape:
 *
 * - Spawned once at the start of a layered render and terminated in the
 *   `finally`. Worker spawn cost is ~10–50 ms each; amortized over the
 *   full transition phase (typically 100+ frames) it's negligible.
 * - Pool size is sized to `min(layeredWorkerCount, cpuCount)`. We don't
 *   spawn more workers than DOM sessions (no benefit — at most N DOM
 *   sessions can be dispatching to us at any moment) and we don't oversubscribe
 *   beyond physical cores.
 * - Each Worker holds zero per-frame state. Pool simply dispatches one
 *   shader-blend per Worker at a time; ordering within the pool doesn't
 *   matter because each frame's output is gated by the encoder's
 *   `FrameReorderBuffer` upstream.
 *
 * API:
 *
 *   const pool = await createShaderTransitionWorkerPool({ size, log });
 *   const result = await pool.run({
 *     shader, bufferA, bufferB, output, width, height, progress,
 *   });
 *   // result.bufferA / result.bufferB / result.output are the same memory,
 *   // now re-attached to the main thread.
 *   await pool.terminate();
 *
 * Buffer transfer contract: `run` takes Node Buffers, transfers their
 * underlying ArrayBuffers to the worker, and returns NEW Buffer views over
 * the transferred-back ArrayBuffers. The caller is responsible for
 * swapping its Buffer references — the *original* Buffers passed in are
 * detached (their `.length` becomes 0 / accessing throws) after `run` resolves.
 */

import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { cpus } from "node:os";

interface PoolLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ShaderTransitionPoolOptions {
  /** Number of worker threads. Clamped to [1, cpus().length]. */
  size: number;
  /** Optional logger; falls back to no-op. */
  log?: PoolLogger;
  /**
   * Absolute filesystem path to the worker entry module. When provided, the
   * pool spawns workers from this exact path and skips the fallback
   * `import.meta.url`-based resolver entirely. Required by callers that
   * bundle the worker via a separate build (e.g. the CLI's tsup bundle):
   * `import.meta.url` inside the bundled pool resolves to the bundle's own
   * location, NOT the bundled worker entry's location, so the heuristic
   * resolver below cannot find the worker. Path extension determines the
   * loader behaviour (`.ts` → tsx/esm loader is appended to execArgv).
   */
  workerEntryPath?: string;
}

export interface ShaderBlendRequest {
  shader: string;
  bufferA: Buffer;
  bufferB: Buffer;
  output: Buffer;
  width: number;
  height: number;
  progress: number;
}

export interface ShaderBlendResult {
  /** Re-attached buffer A (zero-copy view over the transferred-back ArrayBuffer). */
  bufferA: Buffer;
  /** Re-attached buffer B. */
  bufferB: Buffer;
  /** Re-attached output buffer holding the shader-blended frame. */
  output: Buffer;
}

interface PendingTask {
  req: ShaderBlendRequest;
  resolve: (r: ShaderBlendResult) => void;
  reject: (err: Error) => void;
  /** Set when `HF_SHADER_POOL_TRACE=1`; used to log dispatch latency. */
  enqueuedAtMs?: number;
  /** Set when `HF_SHADER_POOL_TRACE=1`; assigned at dispatch. */
  traceId?: number;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  current: PendingTask | null;
  /**
   * Set once the worker has crashed (`error`) or exited unexpectedly. A dead
   * slot must never be dispatched to again: `postMessage` to a terminated
   * Worker is a silent no-op (no throw, no reply), so a task routed to it
   * would hang forever. The pool does not respawn mid-render (the lost
   * transferList buffers can't be reconstructed), so a dead slot stays dead
   * until teardown.
   */
  dead: boolean;
}

interface WorkerReply {
  ok: boolean;
  error?: string;
  bufferA: ArrayBuffer;
  bufferB: ArrayBuffer;
  output: ArrayBuffer;
}

export interface ShaderTransitionWorkerPool {
  readonly size: number;
  run(req: ShaderBlendRequest): Promise<ShaderBlendResult>;
  terminate(): Promise<void>;
}

/**
 * Resolve the path to the compiled worker module.
 *
 * Resolution order (first match wins):
 *   1. Explicit `workerEntryPath` factory option — callers that bundle the
 *      worker via a separate build pipeline (e.g. the CLI's tsup bundle that
 *      emits `shaderTransitionWorker.js` next to `cli.js`) must use this.
 *      The bundled-CLI case is the *only* one where the fallback below
 *      cannot find the worker: `import.meta.url` inside the inlined pool
 *      resolves to the bundle path, not the worker's emitted path, so the
 *      sibling probe lands in the wrong directory.
 *   2. `HF_SHADER_WORKER_ENTRY` env var — test/dev infra override (file
 *      path or `file://` URL).
 *   3. Same-directory `.js` sibling — works when both pool source and
 *      worker source compile into the same `dist/services/` directory
 *      (in-tree dev builds and the colocated tsc emit).
 *   4. Same-directory `.ts` sibling — vitest/bun raw-TS execution path.
 */
function resolveWorkerEntry(explicit: string | undefined): { path: string; isTs: boolean } {
  if (explicit && explicit.length > 0) {
    return { path: explicit, isTs: explicit.endsWith(".ts") };
  }
  const override = process.env.HF_SHADER_WORKER_ENTRY;
  if (override && override.length > 0) {
    const isTs = override.endsWith(".ts");
    return { path: override, isTs };
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(moduleDir, "shaderTransitionWorker.js");
  if (existsSync(jsPath)) return { path: jsPath, isTs: false };
  const tsPath = join(moduleDir, "shaderTransitionWorker.ts");
  return { path: tsPath, isTs: true };
}

/**
 * Probe whether the parent process already has a TS loader registered
 * (tsx, ts-node, esm-loader). Worker threads inherit the parent's loader
 * only if we copy `process.execArgv` AND the relevant flag is present.
 * Vitest runs its own transformer and does NOT register a loader on
 * `process.execArgv`, so when the resolved entry is `.ts` and no loader
 * is detected we try to inject `tsx/esm` so `new Worker(<.ts file>)`
 * loads correctly.
 *
 * This is best-effort: if `tsx/esm` can't be resolved (e.g. minimal prod
 * install), we fall back to plain `process.execArgv` and the Worker will
 * surface a clear "cannot find module" error rather than silently
 * misbehaving.
 */
function buildExecArgv(entryIsTs: boolean): string[] {
  const inherited = [...process.execArgv];
  if (!entryIsTs) return inherited;
  const hasLoader = inherited.some(
    (a) => a.includes("tsx/esm") || a.includes("ts-node/esm") || a.includes("--import"),
  );
  if (hasLoader) return inherited;
  try {
    const require = createRequire(import.meta.url);
    const tsxEsm = require.resolve("tsx/esm");
    inherited.push("--import", pathToFileURL(tsxEsm).href);
  } catch {
    // tsx not installed (prod) — leave execArgv as-is. The caller will
    // get a clear error if the .ts entry can't be loaded.
  }
  return inherited;
}

/**
 * Spawn a worker pool ready to run shader-blends. The returned pool is
 * usable as soon as the function resolves. If any worker fails to spawn,
 * all already-spawned workers are terminated and the error is propagated.
 */
export async function createShaderTransitionWorkerPool(
  opts: ShaderTransitionPoolOptions,
): Promise<ShaderTransitionWorkerPool> {
  const cpuCount = Math.max(1, cpus().length);
  const size = Math.max(1, Math.min(opts.size, cpuCount));
  const log = opts.log ?? {};
  const { path: entry, isTs: entryIsTs } = resolveWorkerEntry(opts.workerEntryPath);

  const slots: WorkerSlot[] = [];
  const queue: PendingTask[] = [];
  let terminated = false;

  // hf#732 follow-up: instrumentation flag to log per-task dispatch /
  // completion timestamps so we can confirm the pool actually runs blends
  // concurrently when N DOM workers each dispatch K tasks. Enabled by
  // setting `HF_SHADER_POOL_TRACE=1`. Off by default — the per-task log
  // line is high-volume on long shader-transition renders.
  const traceEnabled = process.env.HF_SHADER_POOL_TRACE === "1";
  let nextTaskId = 0;

  // Bind the parent's execArgv (e.g. tsx's `--import tsx/esm` loader) into
  // every Worker so a `.ts` entry point loads under tsx in dev without a
  // separate loader registration step. In the bundled prod build the
  // entry is `.js` and execArgv is typically empty — passing it is a no-op.
  // Under vitest the parent has no tsx loader on execArgv; `buildExecArgv`
  // appends one so the `.ts` worker entry still loads.
  const execArgv = buildExecArgv(entryIsTs);

  // When every worker has died there is no live thread left to drain the
  // queue, so any waiting tasks would hang forever. Reject them instead.
  const failQueueIfNoLiveSlots = (): void => {
    if (slots.some((s) => !s.dead)) return;
    while (queue.length > 0) {
      const t = queue.shift();
      if (t) t.reject(new Error("shader-blend pool has no live workers; task abandoned"));
    }
  };

  const dispatchNext = (slot: WorkerSlot): void => {
    if (terminated || slot.busy || slot.dead) return;
    const task = queue.shift();
    if (!task) return;
    slot.busy = true;
    slot.current = task;
    if (traceEnabled) {
      const slotIdx = slots.indexOf(slot);
      const waitMs = task.enqueuedAtMs ? Date.now() - task.enqueuedAtMs : 0;
      const busyCount = slots.filter((s) => s.busy).length;
      log.info?.("[shaderPool] dispatch", {
        task: task.traceId,
        slot: slotIdx,
        shader: task.req.shader,
        waitMs,
        busyCount,
        queueDepth: queue.length,
      });
    }
    const { bufferA, bufferB, output, shader, width, height, progress } = task.req;
    // `Buffer.alloc` always returns a Buffer over a plain ArrayBuffer (not
    // SharedArrayBuffer) at runtime — TS narrows `.buffer` to the union
    // `ArrayBuffer | SharedArrayBuffer`, so cast at the boundary. The pool
    // would not work with SharedArrayBuffer-backed Buffers anyway because
    // transferList rejects them.
    const abA = bufferA.buffer as ArrayBuffer;
    const abB = bufferB.buffer as ArrayBuffer;
    const abOut = output.buffer as ArrayBuffer;
    try {
      slot.worker.postMessage(
        {
          shader,
          bufferA: abA,
          bufferB: abB,
          output: abOut,
          width,
          height,
          progress,
        },
        [abA, abB, abOut],
      );
    } catch (err) {
      // postMessage can throw if the ArrayBuffer was already detached
      // (e.g. caller reused a buffer mid-flight). Surface clearly.
      slot.busy = false;
      slot.current = null;
      task.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const onWorkerMessage = (slot: WorkerSlot, reply: WorkerReply): void => {
    const task = slot.current;
    slot.current = null;
    slot.busy = false;
    if (!task) {
      // Spurious message; nothing to resolve. Drain queue anyway.
      dispatchNext(slot);
      return;
    }
    if (!reply.ok) {
      task.reject(new Error(reply.error ?? "shader-blend worker failed"));
    } else {
      task.resolve({
        bufferA: Buffer.from(reply.bufferA),
        bufferB: Buffer.from(reply.bufferB),
        output: Buffer.from(reply.output),
      });
    }
    dispatchNext(slot);
  };

  const onWorkerError = (slot: WorkerSlot, err: Error): void => {
    const task = slot.current;
    slot.current = null;
    slot.busy = false;
    // Mark dead before rejecting and before draining the queue: this slot's
    // worker can no longer accept a dispatch (postMessage would be a silent
    // no-op), so it must be excluded from future slot selection or a later
    // task would hang on it.
    slot.dead = true;
    if (task) {
      // The in-flight task's buffers were transferred to the worker. They're
      // lost on the worker crash — the caller's original Buffers are
      // already detached. Reject so the render fails fast rather than
      // continuing with corrupted state.
      task.reject(new Error(`shader-blend worker crashed mid-task: ${err.message}; buffers lost`));
    }
    log.warn?.("[shaderTransitionWorkerPool] worker errored", { err: err.message });
    failQueueIfNoLiveSlots();
  };

  const onWorkerExit = (slot: WorkerSlot, code: number): void => {
    if (terminated) return;
    // Unexpected exit — fail any in-flight task and mark the slot dead. We
    // don't auto-respawn in the middle of a render because the lost
    // transferList buffers can't be reconstructed, and silently shrinking the
    // pool would mask the real failure. Pool teardown handles graceful
    // shutdown.
    slot.dead = true;
    if (slot.current) {
      slot.current.reject(new Error(`shader-blend worker exited (code=${code}) mid-task`));
      slot.current = null;
      slot.busy = false;
    }
    log.warn?.("[shaderTransitionWorkerPool] worker exited unexpectedly", { code });
    failQueueIfNoLiveSlots();
  };

  // Spawn workers. If any throws synchronously we still want to terminate
  // the partially-spawned set before rejecting.
  try {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(entry, { execArgv });
      const slot: WorkerSlot = { worker, busy: false, current: null, dead: false };
      worker.on("message", (msg: WorkerReply) => onWorkerMessage(slot, msg));
      worker.on("error", (err: unknown) =>
        onWorkerError(slot, err instanceof Error ? err : new Error(String(err))),
      );
      worker.on("exit", (code) => onWorkerExit(slot, code));
      slots.push(slot);
    }
  } catch (err) {
    terminated = true;
    await Promise.all(slots.map((s) => s.worker.terminate().catch(() => undefined)));
    throw err;
  }

  log.info?.("[shaderTransitionWorkerPool] spawned", { size, entry });

  return {
    size,
    async run(req: ShaderBlendRequest): Promise<ShaderBlendResult> {
      if (terminated) {
        throw new Error("shader-blend pool already terminated");
      }
      return new Promise<ShaderBlendResult>((resolve, reject) => {
        const task: PendingTask = traceEnabled
          ? { req, resolve, reject, enqueuedAtMs: Date.now(), traceId: ++nextTaskId }
          : { req, resolve, reject };
        // Find a live idle slot; otherwise queue behind the live busy ones.
        const idle = slots.find((s) => !s.busy && !s.dead);
        if (idle) {
          queue.unshift(task);
          dispatchNext(idle);
        } else if (slots.some((s) => !s.dead)) {
          // A live worker is busy; it drains the queue when it completes.
          queue.push(task);
        } else {
          // Every worker has died — don't hang waiting for a dispatch that
          // can never happen.
          reject(new Error("shader-blend pool has no live workers"));
        }
      });
    },
    async terminate(): Promise<void> {
      if (terminated) return;
      terminated = true;
      // Reject any queued (not-yet-dispatched) tasks. Their buffers are
      // still attached on the main thread — caller can recover.
      while (queue.length > 0) {
        const t = queue.shift();
        if (t) t.reject(new Error("shader-blend pool terminated before task ran"));
      }
      // Reject any in-flight tasks before worker.terminate() races with
      // the message reply. Calling Worker.terminate() forcefully stops
      // the worker; if a task was mid-execution its parentPort.postMessage
      // never lands, so the `current` task promise would otherwise leak.
      for (const slot of slots) {
        const t = slot.current;
        if (t) {
          slot.current = null;
          slot.busy = false;
          t.reject(new Error("shader-blend pool terminated mid-task"));
        }
      }
      await Promise.all(slots.map((s) => s.worker.terminate().catch(() => undefined)));
      log.info?.("[shaderTransitionWorkerPool] terminated", { size });
    },
  };
}
