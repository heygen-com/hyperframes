// fallow-ignore-file unused-file
import { resolveConfig, setHostHandlesSigint } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const [projectDir, outputPath] = process.argv.slice(2);
if (!projectDir || !outputPath) throw new Error("Missing fixture arguments");

// Same contract as the CLI: the host owns Ctrl+C, aborts the render, and the render cleans up after itself.
const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("render_cancelled_by_sigint")));
setHostHandlesSigint(true);
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const job = createRenderJob({
  fps: 30,
  quality: "draft",
  hdrMode: "force-sdr",
  workers: 2,
  logger: silent,
  producerConfig: resolveConfig({ browserGpuMode: "software" }),
});
try {
  await executeRenderJob(job, projectDir, outputPath, undefined, controller.signal);
} catch {
  process.exitCode = 1;
}
