// Builds root and sub-composition preview pages off the request thread; the route keeps transforms and media probes.
import { parentPort } from "node:worker_threads";
import { runPreviewJob } from "./previewJobs.js";
import type { SubCompositionJob } from "./subCompositionBuild.js";

parentPort?.on("message", ({ id, job }: { id: number; job: SubCompositionJob }) => {
  try {
    parentPort?.postMessage({ id, result: runPreviewJob(job) });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
