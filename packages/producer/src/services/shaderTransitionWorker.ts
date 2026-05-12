/**
 * Worker entry point for off-main-thread shader-blend execution.
 *
 * The hf#677 follow-up moved the layered transition pipeline (dual-scene
 * seek/mask/screenshot) onto per-worker DOM sessions, but the per-pixel JS
 * shader-blend at the tail of `processLayeredTransitionFrame` still ran on
 * the orchestrator's main event loop. Complex shaders (`domain-warp`,
 * `swirl-vortex`, `glitch`) iterate every pixel of the rgb48le buffer with
 * multiple noise/sample calls per pixel — hundreds of milliseconds per call
 * — so N concurrent DOM workers all firing shader-blends saturated the
 * single Node thread. The empirical worker-count sweep on the #677 fixture
 * (w=1=218s, w=2=183s, w=6=184s, w=12=188s) flattens after w=2, which is the
 * single-threaded-downstream signature.
 *
 * This worker runs `TRANSITIONS[shader](from, to, output, w, h, p)` on a
 * dedicated Node `worker_threads` Worker. The pool dispatches one frame at
 * a time per worker. The rgb48le scratch Buffers are moved in and out via
 * `transferList` — zero-copy at the ArrayBuffer level — so the only
 * per-frame cost is the postMessage round-trip (~sub-millisecond on the
 * 2.4 MB 854×480 buffers) plus the shader-blend itself.
 *
 * Lifecycle:
 *
 * 1. Pool constructor spawns N of these workers up front.
 * 2. Main thread posts `{ shader, bufferA, bufferB, output, width, height,
 *    progress }` with `transferList: [bufferA, bufferB, output]`. The three
 *    ArrayBuffers are detached on the sender; the caller must NOT touch
 *    them until the worker replies.
 * 3. Worker wraps each ArrayBuffer as a Node Buffer view (zero-copy),
 *    invokes `TRANSITIONS[shader] ?? crossfade`, and posts `{ ok: true,
 *    output }` back with `transferList: [output]`. (The two input ArrayBuffers
 *    are also returned so the main thread can re-attach them to the worker's
 *    `LayeredTransitionBuffers` slot for reuse on the next frame.)
 * 4. On unknown shader / runtime exception, worker posts `{ ok: false, error,
 *    bufferA, bufferB, output }` — all three are still transferred back so
 *    the caller can release them.
 *
 * The worker holds no per-frame state. It is shared across DOM-session
 * workers and across the entire render — only spawned once at render start
 * and terminated at render end.
 */

import { parentPort } from "node:worker_threads";
// Import the shader-blend table from a dedicated `./shader-transitions`
// subpath export of `@hyperframes/engine` rather than the package root.
// Rationale:
//
// 1. `shaderTransitions.ts` is fully self-contained (no internal imports).
//    Going through engine's root index pulls in the rest of the engine
//    graph, which fails under `worker_threads` + tsx in dev/test: the
//    tsx loader's `.js → .ts` rewrite does NOT survive the Worker
//    boundary, so internal specifiers like `./config.js` from `index.ts`
//    fail to resolve. The subpath sidesteps that by pointing the
//    resolver straight at the import-free file.
//
// 2. In the production esbuild bundle (build.mjs entry
//    `src/services/shaderTransitionWorker.ts`) the workspace alias plugin
//    redirects `@hyperframes/engine/shader-transitions` to the same TS
//    source and bundles it inline, so behavior is identical.
import { TRANSITIONS, crossfade } from "@hyperframes/engine/shader-transitions";

interface ShaderJobRequest {
  shader: string;
  bufferA: ArrayBuffer;
  bufferB: ArrayBuffer;
  output: ArrayBuffer;
  width: number;
  height: number;
  progress: number;
}

interface ShaderJobOk {
  ok: true;
  bufferA: ArrayBuffer;
  bufferB: ArrayBuffer;
  output: ArrayBuffer;
}

interface ShaderJobErr {
  ok: false;
  error: string;
  bufferA: ArrayBuffer;
  bufferB: ArrayBuffer;
  output: ArrayBuffer;
}

export type ShaderJobResult = ShaderJobOk | ShaderJobErr;

if (!parentPort) {
  // Defensive — this module is only meaningful inside a worker_thread.
  // If imported on the main thread (e.g. by an accidental top-level test),
  // do nothing rather than throwing, so static analysis stays clean.
  // eslint-disable-next-line no-console
  console.warn("[shaderTransitionWorker] no parentPort; module loaded on main thread");
} else {
  parentPort.on("message", (msg: ShaderJobRequest) => {
    const { shader, bufferA, bufferB, output, width, height, progress } = msg;
    // Re-wrap the transferred ArrayBuffers as Node Buffers. Buffer.from(ab)
    // is a zero-copy view over the same underlying memory — no allocation,
    // no data copy. The shader functions are typed to take Buffer and use
    // its readUInt16LE/writeUInt16LE API.
    const bufA = Buffer.from(bufferA);
    const bufB = Buffer.from(bufferB);
    const out = Buffer.from(output);

    try {
      const fn = TRANSITIONS[shader] ?? crossfade;
      fn(bufA, bufB, out, width, height, progress);
      const reply: ShaderJobOk = {
        ok: true,
        bufferA,
        bufferB,
        output,
      };
      parentPort!.postMessage(reply, [bufferA, bufferB, output]);
    } catch (err) {
      const reply: ShaderJobErr = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        bufferA,
        bufferB,
        output,
      };
      parentPort!.postMessage(reply, [bufferA, bufferB, output]);
    }
  });
}
