// Single render for the worker-encode eval. Mode from env
// (PRODUCER_EXPERIMENTAL_FAST_CAPTURE + HF_DE_WORKER_ENCODE set by caller).
// Engine logs (capture_streaming durationMs, "worker encode initialized") go to
// stdout; the suite shell greps them.
import { createRenderJob, executeRenderJob } from "./src/index.ts";
const [dir, out] = process.argv.slice(2);
process.env.PRODUCER_ENABLE_BROWSER_POOL = "false";
process.env.PRODUCER_BROWSER_GPU_MODE = "hardware";
const job = createRenderJob({
  fps: 30,
  quality: "high",
  format: "mp4",
  workers: Math.max(1, Number(process.env.WORKERS || "1")),
  useGpu: false,
  hdrMode: "force-sdr",
});
const __t = Date.now();
await executeRenderJob(job, dir, out);
console.log("TOTAL_MS " + (Date.now() - __t));
console.log("RENDER_OK");
