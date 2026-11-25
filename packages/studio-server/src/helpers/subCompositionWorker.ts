// Builds root and sub-composition preview pages off the request thread; the route keeps transforms and media probes.
import { parentPort } from "node:worker_threads";
import { runPreviewJob } from "./previewJobs.js";
import type { SubCompositionJob } from "./subCompositionBuild.js";

type Handed = { id: number; job: SubCompositionJob; timeLeftMs: number };

parentPort?.on("message", ({ id, job, timeLeftMs }: Handed) => {
  try {
    parentPort?.postMessage({ id, result: runPreviewJob(job, timeLeftMs) });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
