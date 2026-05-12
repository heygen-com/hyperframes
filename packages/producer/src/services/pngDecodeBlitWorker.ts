/**
 * Worker entry point for off-main-thread PNG decode + alpha blit. The
 * companion to `pngDecodeBlitWorkerPool.ts`. See that file for the rationale
 * (hf#732 lever-4: overlap Chrome's screenshot with Node's decode+blit).
 *
 * Lifecycle:
 *
 * 1. Pool constructor spawns N of these workers up front.
 * 2. Main thread posts `{ png, pngOffset, pngLength, dest, destOffset,
 *    destLength, width, height, transfer }` with `transferList: [png, dest]`.
 *    Both underlying ArrayBuffers are detached on the sender; the caller
 *    must NOT touch them until the worker replies.
 * 3. Worker wraps each ArrayBuffer as a Node Buffer view (zero-copy),
 *    runs `decodePng` to get an RGBA8 Uint8Array, then `blitRgba8OverRgb48le`
 *    to composite the decoded pixels onto the rgb48le `dest` buffer in
 *    the requested transfer space.
 * 4. Worker posts `{ ok, png, dest, decodeMs, blitMs }` back with
 *    `transferList: [png, dest]`. Both ArrayBuffers return to the main
 *    thread; the caller swaps `result.dest` into its render state.
 * 5. On decode/blit exception, worker posts `{ ok: false, error, png,
 *    dest }` — both ArrayBuffers still returned so the caller can release
 *    them.
 *
 * The worker holds no per-frame state. The intermediate RGBA8 decode
 * buffer is allocated per-call and dropped on the worker side.
 *
 * Import strategy: identical to `shaderTransitionWorker.ts` — use the
 * `./alpha-blit` subpath export of `@hyperframes/engine` rather than the
 * package root, because the root pulls in the full engine graph and the
 * tsx loader's `.js → .ts` rewrite does not survive the Worker boundary
 * under dev/test.
 */

import { parentPort } from "node:worker_threads";
import { decodePng, blitRgba8OverRgb48le } from "@hyperframes/engine/alpha-blit";

interface DecodeBlitJobRequest {
  png: ArrayBuffer;
  pngOffset: number;
  pngLength: number;
  dest: ArrayBuffer;
  destOffset: number;
  destLength: number;
  width: number;
  height: number;
  transfer: string;
}

interface DecodeBlitJobOk {
  ok: true;
  png: ArrayBuffer;
  dest: ArrayBuffer;
  decodeMs: number;
  blitMs: number;
}

interface DecodeBlitJobErr {
  ok: false;
  error: string;
  png: ArrayBuffer;
  dest: ArrayBuffer;
}

export type DecodeBlitJobResult = DecodeBlitJobOk | DecodeBlitJobErr;

if (!parentPort) {
  // Defensive — this module is only meaningful inside a worker_thread.
  // eslint-disable-next-line no-console
  console.warn("[pngDecodeBlitWorker] no parentPort; module loaded on main thread");
} else {
  parentPort.on("message", (msg: DecodeBlitJobRequest) => {
    const { png, pngOffset, pngLength, dest, destOffset, destLength, width, height, transfer } =
      msg;
    // Re-wrap the transferred ArrayBuffers as Node Buffer views. The
    // dispatcher in the pool normalizes inputs to offset-0 ArrayBuffers
    // before transfer (avoiding the 8KB shared-pool DataCloneError), so
    // pngOffset / destOffset are 0 and pngLength / destLength match the
    // backing ArrayBuffer byteLength in practice. We still honor the
    // forwarded values so the worker is robust if the dispatcher ever
    // changes (e.g. ships a slice over a larger transferred ArrayBuffer).
    const pngBuf = Buffer.from(png, pngOffset, pngLength);
    const destBuf = Buffer.from(dest, destOffset, destLength);

    try {
      const decodeStart = Date.now();
      const { data: rgba } = decodePng(pngBuf);
      const decodeMs = Date.now() - decodeStart;

      const blitStart = Date.now();
      // `blitRgba8OverRgb48le` accepts the CompositeTransfer string as a
      // typed union. The pool's `transfer` field is `string` for transport
      // simplicity; the actual values flow through unchanged from the
      // orchestrator's HdrCompositeContext and the function validates at
      // its own boundary.
      blitRgba8OverRgb48le(
        rgba,
        destBuf,
        width,
        height,
        transfer as Parameters<typeof blitRgba8OverRgb48le>[4],
      );
      const blitMs = Date.now() - blitStart;

      const reply: DecodeBlitJobOk = {
        ok: true,
        png,
        dest,
        decodeMs,
        blitMs,
      };
      parentPort!.postMessage(reply, [png, dest]);
    } catch (err) {
      const reply: DecodeBlitJobErr = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        png,
        dest,
      };
      parentPort!.postMessage(reply, [png, dest]);
    }
  });
}
