/**
 * Test fixture worker (not part of the production build).
 *
 * Simulates a worker that dies mid-task — e.g. an OOM kill on a heavy shader
 * frame — by throwing an uncaught exception on the first message it receives.
 * The throw surfaces as the Worker `error` event (followed by `exit`), which
 * is exactly the crash path the shader / png-decode pools must recover from:
 * the crashing slot has to be marked dead so a later task is never routed to
 * its terminated worker (where `postMessage` is a silent no-op and the task
 * would hang forever).
 *
 * Referenced only by path via the pools' `workerEntryPath` option in
 * shaderTransitionWorkerPool.test.ts / pngDecodeBlitWorkerPool.test.ts.
 */
import { parentPort } from "node:worker_threads";

parentPort?.on("message", () => {
  throw new Error("simulated worker crash");
});
