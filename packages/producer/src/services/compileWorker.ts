// Compiles workerData's project on its own thread, so a page that makes the compile run long holds up
// this thread only: the parent keeps answering /health and other requests, and can end it at a deadline.
import { parentPort, workerData } from "node:worker_threads";
import { onTrackedChildProcess } from "@hyperframes/engine";
import { scratchOutputOf } from "./compileScratch.js";
import { compileForRender, type CompileForRenderOptions } from "./htmlCompiler.js";
import type { ProducerLogger } from "../logger.js";

const { projectDir, htmlPath, downloadDir, options } = workerData as {
  projectDir: string;
  htmlPath: string;
  downloadDir: string;
  options: Omit<CompileForRenderOptions, "log" | "abortSignal">;
};

function post(level: string, message: string, meta?: Record<string, unknown>): void {
  try {
    parentPort?.postMessage({ type: "log", level, message, meta });
  } catch {
    // A meta that structured clone refuses (a function, say) must not fail the compile.
    let plain: Record<string, unknown> | undefined;
    try {
      plain = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
    } catch {
      plain = undefined;
    }
    parentPort?.postMessage({ type: "log", level, message, meta: plain });
  }
}

const log: ProducerLogger = {
  error: (message, meta) => post("error", message, meta),
  warn: (message, meta) => post("warn", message, meta),
  info: (message, meta) => post("info", message, meta),
  debug: (message, meta) => post("debug", message, meta),
};

// The parent asks first, so downloads and transcodes stop through the compile's own cancel paths;
// it terminates the thread if the compile is too busy to hear it.
const controller = new AbortController();
parentPort?.on("message", (message: { type?: string }) => {
  if (message?.type === "abort") controller.abort(new Error("compile stopped"));
});
// Fire-and-forget advisories may outlive the compile; they must not keep the parent's port open.
parentPort?.unref();
// This thread's ffmpeg/ffprobe timers die with it, so the parent hears of each child and ends what is left.
onTrackedChildProcess((proc) => {
  const { pid } = proc;
  if (pid === undefined) return;
  parentPort?.postMessage({
    type: "child",
    pid,
    output: scratchOutputOf(proc.spawnfile, proc.spawnargs),
  });
  proc.once("exit", () => parentPort?.postMessage({ type: "childExit", pid }));
});

try {
  const compiled = await compileForRender(projectDir, htmlPath, downloadDir, {
    ...options,
    log,
    abortSignal: controller.signal,
  });
  parentPort?.postMessage({ type: "result", compiled });
} catch (error) {
  const props: Record<string, unknown> = {};
  if (error instanceof Error) {
    for (const [key, value] of Object.entries(error)) {
      try {
        props[key] = structuredClone(value);
      } catch {
        // Not cloneable: the wire envelope reads only plain fields.
      }
    }
  }
  parentPort?.postMessage({
    type: "error",
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack, props }
        : { name: "Error", message: String(error), props },
  });
}
