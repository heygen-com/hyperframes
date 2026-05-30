/**
 * Pool of Node `worker_threads` Workers for off-main-thread PNG decode +
 * rgba8-over-rgb48le blit. The hf#732 lever-4 follow-up: capture (Chrome
 * compositor) and decode+blit (Node CPU) were previously serialized per
 * frame inside `captureTransitionFrame` / `compositeHdrFrame`. Each frame
 * waited ~30 ms (decode) + ~50 ms (blit) on the Node main thread before the
 * next CDP screenshot could begin. With the decode+blit on a worker pool,
 * the calling thread can kick off the next CDP capture immediately and the
 * decode+blit overlaps Chrome's screenshot work.
 *
 * Why a SEPARATE pool from `shaderTransitionWorkerPool`:
 *
 *   - Different work shapes: shader-blend reads 2× rgb48le, writes 1×
 *     rgb48le. Decode+blit reads 1× PNG bytes (variable size, often
 *     ~250 KB for 854×480 with sparse DOM content), allocates a temporary
 *     RGBA8 buffer, and writes 1× rgb48le (over an existing destination).
 *   - Different concurrency profile: shader-blend fires once per
 *     transition frame; decode+blit fires once per DOM layer per frame
 *     (typically 3-6× per normal frame, 2× per transition frame). The
 *     pools have very different dispatch rates and queuing characteristics.
 *   - Sizing them independently lets us tune each to its bottleneck without
 *     starving the other.
 *
 * API:
 *
 *   const pool = await createPngDecodeBlitWorkerPool({ size, log });
 *   const result = await pool.run({
 *     png: pngBuffer,             // alpha-channel PNG from CDP (zero-copy in)
 *     dest: rgb48leDestBuffer,    // rgb48le canvas to blend onto (zero-copy in)
 *     width, height,
 *     transfer: "srgb" | "pq" | "hlg" | etc.,
 *   });
 *   // result.dest is the SAME memory as the input `dest`, but re-attached
 *   // to the main thread. The input Buffer is detached on dispatch — the
 *   // caller must use `result.dest` for any subsequent reads/writes.
 *   await pool.terminate();
 *
 * Buffer transfer contract:
 *
 *   The PNG bytes are transferred IN with `transferList: [png.buffer]` so
 *   we don't copy them across the worker boundary. The `dest` rgb48le
 *   ArrayBuffer is also transferred IN (and back OUT) so the blit happens
 *   in place on the same memory the caller pre-allocated. After `run`
 *   resolves, the caller MUST swap its Buffer reference to `result.dest`
 *   — the original Buffer's underlying ArrayBuffer is detached on dispatch.
 *
 *   The intermediate RGBA8 decode buffer is allocated INSIDE the worker
 *   and dropped on the worker side — there is no main-thread allocation
 *   for it. The PNG ArrayBuffer is transferred back too so the caller can
 *   release it.
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

export interface PngDecodeBlitPoolOptions {
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

export interface PngDecodeBlitRequest {
  /** PNG bytes captured from CDP (Page.captureScreenshot). */
  png: Buffer;
  /**
   * Pre-allocated rgb48le destination canvas (width*height*6 bytes). The
   * blit composites the decoded RGBA8 image OVER this buffer's existing
   * contents in `transfer` space.
   */
  dest: Buffer;
  width: number;
  height: number;
  /**
   * Composite color space tag matching the engine's `CompositeTransfer`
   * union. Passed through to `blitRgba8OverRgb48le` in the worker.
   */
  transfer: string;
}

export interface PngDecodeBlitResult {
  /**
   * Re-attached destination buffer holding the composited rgb48le pixels.
   * Same memory as the request's `dest`, viewed through a fresh Buffer.
   */
  dest: Buffer;
  /** Per-worker timing: decode duration in ms (excluding postMessage latency). */
  decodeMs: number;
  /** Per-worker timing: blit duration in ms. */
  blitMs: number;
}

interface PendingTask {
  req: PngDecodeBlitRequest;
  resolve: (r: PngDecodeBlitResult) => void;
  reject: (err: Error) => void;
  enqueuedAtMs?: number;
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
   * would hang forever. The pool does not respawn mid-render, so a dead slot
   * stays dead until teardown.
   */
  dead: boolean;
}

interface WorkerReply {
  ok: boolean;
  error?: string;
  png: ArrayBuffer;
  dest: ArrayBuffer;
  decodeMs?: number;
  blitMs?: number;
}

export interface PngDecodeBlitWorkerPool {
  readonly size: number;
  run(req: PngDecodeBlitRequest): Promise<PngDecodeBlitResult>;
  terminate(): Promise<void>;
}

/**
 * Resolve the path to the compiled worker module.
 *
 * Resolution order (first match wins):
 *   1. Explicit `workerEntryPath` factory option — callers that bundle the
 *      worker via a separate build pipeline (e.g. the CLI's tsup bundle that
 *      emits `pngDecodeBlitWorker.js` next to `cli.js`) must use this. The
 *      bundled-CLI case is the *only* one where the fallback below cannot
 *      find the worker: `import.meta.url` inside the inlined pool resolves
 *      to the bundle path, not the worker's emitted path, so the sibling
 *      probe lands in the wrong directory.
 *   2. `HF_PNG_DECODE_BLIT_WORKER_ENTRY` env var — test/dev infra override.
 *   3. Same-directory `.js` sibling — works when both pool source and
 *      worker source compile into the same `dist/services/` directory
 *      (in-tree dev builds and the colocated tsc emit).
 *   4. Same-directory `.ts` sibling — vitest/bun raw-TS execution path.
 */
function resolveWorkerEntry(explicit: string | undefined): { path: string; isTs: boolean } {
  if (explicit && explicit.length > 0) {
    return { path: explicit, isTs: explicit.endsWith(".ts") };
  }
  const override = process.env.HF_PNG_DECODE_BLIT_WORKER_ENTRY;
  if (override && override.length > 0) {
    const isTs = override.endsWith(".ts");
    return { path: override, isTs };
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(moduleDir, "pngDecodeBlitWorker.js");
  if (existsSync(jsPath)) return { path: jsPath, isTs: false };
  const tsPath = join(moduleDir, "pngDecodeBlitWorker.ts");
  return { path: tsPath, isTs: true };
}

/**
 * Mirror of `shaderTransitionWorkerPool.buildExecArgv`. Worker threads
 * inherit the parent's loader only if the relevant flag is present on
 * `process.execArgv`; under vitest the tsx loader is NOT exposed there, so
 * we append `--import tsx/esm` when the resolved entry is `.ts` and no
 * loader is detected. Best-effort: silently no-ops if `tsx/esm` can't be
 * resolved (prod bundle).
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
    // tsx not installed (prod) — leave execArgv as-is.
  }
  return inherited;
}

export async function createPngDecodeBlitWorkerPool(
  opts: PngDecodeBlitPoolOptions,
): Promise<PngDecodeBlitWorkerPool> {
  const cpuCount = Math.max(1, cpus().length);
  const size = Math.max(1, Math.min(opts.size, cpuCount));
  const log = opts.log ?? {};
  const { path: entry, isTs: entryIsTs } = resolveWorkerEntry(opts.workerEntryPath);

  const slots: WorkerSlot[] = [];
  const queue: PendingTask[] = [];
  let terminated = false;

  const traceEnabled = process.env.HF_PNG_DECODE_BLIT_POOL_TRACE === "1";
  let nextTaskId = 0;

  const execArgv = buildExecArgv(entryIsTs);

  // When every worker has died there is no live thread left to drain the
  // queue, so any waiting tasks would hang forever. Reject them instead.
  const failQueueIfNoLiveSlots = (): void => {
    if (slots.some((s) => !s.dead)) return;
    while (queue.length > 0) {
      const t = queue.shift();
      if (t) t.reject(new Error("png-decode-blit pool has no live workers; task abandoned"));
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
      log.info?.("[pngDecodeBlitPool] dispatch", {
        task: task.traceId,
        slot: slotIdx,
        waitMs,
        busyCount,
        queueDepth: queue.length,
      });
    }
    const { png, dest, width, height, transfer } = task.req;
    // Transfer the PNG bytes (input) and the rgb48le dest (in-place blit
    // target) across the worker boundary. Both are detached on the main
    // thread until the reply re-attaches them.
    //
    // Node `Buffer.alloc(N)` allocates a dedicated ArrayBuffer for buffers
    // above 8KB (the pool threshold); below that, Buffers are slices over
    // a shared 8KB pool ArrayBuffer. `postMessage` with `transferList`
    // REJECTS the shared pool with `DataCloneError: Cannot transfer
    // object of unsupported type`. The rgb48le `dest` buffers in the
    // hybrid path are always > 8KB (854×480×6 ≈ 2.4MB) so they're fine,
    // but PNG inputs (variable size, typically 30-300KB but can be < 8KB
    // for empty layers) AND any small upstream Buffers can hit the pool.
    //
    // Safety net: if the underlying ArrayBuffer is larger than the Buffer
    // view OR if the Buffer view doesn't cover the ArrayBuffer exactly,
    // we copy into a fresh dedicated ArrayBuffer before transfer. Cost is
    // one allocation + memcpy of the PNG bytes — small versus the
    // postMessage round-trip we're already paying.
    const pngBackingFitsExactly = png.byteOffset === 0 && png.byteLength === png.buffer.byteLength;
    const pngSource: Buffer = pngBackingFitsExactly ? png : Buffer.from(png); // Buffer.from(Buffer) copies into a new pool slot
    // For very small PNGs, `Buffer.from(buf)` may still land in the pool.
    // Force a dedicated ArrayBuffer with `Uint8Array.slice().buffer`.
    let abPng: ArrayBuffer;
    let pngOffset: number;
    let pngLength: number;
    if (pngSource.byteOffset === 0 && pngSource.byteLength === pngSource.buffer.byteLength) {
      abPng = pngSource.buffer as ArrayBuffer;
      pngOffset = 0;
      pngLength = pngSource.byteLength;
    } else {
      const copied = new Uint8Array(pngSource.byteLength);
      copied.set(pngSource);
      abPng = copied.buffer;
      pngOffset = 0;
      pngLength = copied.byteLength;
    }
    // The rgb48le `dest` should always have a dedicated ArrayBuffer
    // (`Buffer.alloc` above the 8KB pool threshold gives one). Defensive
    // path mirrors the PNG handling for symmetry.
    let abDest: ArrayBuffer;
    let destOffset: number;
    let destLength: number;
    if (dest.byteOffset === 0 && dest.byteLength === dest.buffer.byteLength) {
      abDest = dest.buffer as ArrayBuffer;
      destOffset = 0;
      destLength = dest.byteLength;
    } else {
      // Should never happen for hybrid-path canvases. Take the
      // copy-and-transfer path so we don't crash; but log so we surface
      // any future allocator change that violates the invariant.
      log.warn?.("[pngDecodeBlitPool] dest buffer is a slice over a larger ArrayBuffer; copying", {
        offset: dest.byteOffset,
        length: dest.byteLength,
        backingSize: dest.buffer.byteLength,
      });
      const copied = new Uint8Array(dest.byteLength);
      copied.set(dest);
      abDest = copied.buffer;
      destOffset = 0;
      destLength = copied.byteLength;
    }
    try {
      slot.worker.postMessage(
        {
          png: abPng,
          pngOffset,
          pngLength,
          dest: abDest,
          destOffset,
          destLength,
          width,
          height,
          transfer,
        },
        [abPng, abDest],
      );
    } catch (err) {
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
      dispatchNext(slot);
      return;
    }
    if (!reply.ok) {
      task.reject(new Error(reply.error ?? "png-decode-blit worker failed"));
    } else {
      // Re-attach the dest ArrayBuffer as a Node Buffer view. We wrap the
      // full reply.dest (offset=0, length=byteLength) because the
      // dispatch path normalizes to offset-0 ArrayBuffers (either the
      // caller's original or a fresh copy we made on the dispatch side).
      // The blit work happened over the full ArrayBuffer in the worker;
      // returning a view that matches that is the correct semantics.
      task.resolve({
        dest: Buffer.from(reply.dest, 0, reply.dest.byteLength),
        decodeMs: reply.decodeMs ?? 0,
        blitMs: reply.blitMs ?? 0,
      });
    }
    dispatchNext(slot);
  };

  const onWorkerError = (slot: WorkerSlot, err: Error): void => {
    const task = slot.current;
    slot.current = null;
    slot.busy = false;
    // Mark dead before rejecting and before draining the queue so this slot is
    // excluded from future dispatch; postMessage to its terminated worker would
    // be a silent no-op and any task routed here would hang.
    slot.dead = true;
    if (task) {
      task.reject(
        new Error(`png-decode-blit worker crashed mid-task: ${err.message}; dest buffer lost`),
      );
    }
    log.warn?.("[pngDecodeBlitWorkerPool] worker errored", { err: err.message });
    failQueueIfNoLiveSlots();
  };

  const onWorkerExit = (slot: WorkerSlot, code: number): void => {
    if (terminated) return;
    slot.dead = true;
    if (slot.current) {
      slot.current.reject(new Error(`png-decode-blit worker exited (code=${code}) mid-task`));
      slot.current = null;
      slot.busy = false;
    }
    log.warn?.("[pngDecodeBlitWorkerPool] worker exited unexpectedly", { code });
    failQueueIfNoLiveSlots();
  };

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

  log.info?.("[pngDecodeBlitWorkerPool] spawned", { size, entry });

  return {
    size,
    async run(req: PngDecodeBlitRequest): Promise<PngDecodeBlitResult> {
      if (terminated) {
        throw new Error("png-decode-blit pool already terminated");
      }
      return new Promise<PngDecodeBlitResult>((resolve, reject) => {
        const task: PendingTask = traceEnabled
          ? { req, resolve, reject, enqueuedAtMs: Date.now(), traceId: ++nextTaskId }
          : { req, resolve, reject };
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
          reject(new Error("png-decode-blit pool has no live workers"));
        }
      });
    },
    async terminate(): Promise<void> {
      if (terminated) return;
      terminated = true;
      while (queue.length > 0) {
        const t = queue.shift();
        if (t) t.reject(new Error("png-decode-blit pool terminated before task ran"));
      }
      for (const slot of slots) {
        const t = slot.current;
        if (t) {
          slot.current = null;
          slot.busy = false;
          t.reject(new Error("png-decode-blit pool terminated mid-task"));
        }
      }
      await Promise.all(slots.map((s) => s.worker.terminate().catch(() => undefined)));
      log.info?.("[pngDecodeBlitWorkerPool] terminated", { size });
    },
  };
}
