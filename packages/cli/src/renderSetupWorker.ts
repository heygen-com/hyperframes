// fallow-ignore-file unused-file
import { ensureBrowser, releaseOwnedBrowserInstallLock } from "./browser/manager.js";
import { lintProject } from "./utils/lintProject.js";
import { killOrphanedProcesses } from "./utils/orphanCleanup.js";
import { installRenderSetupSignalHandlers } from "./renderSetupWorkerLifecycle.js";

const RESULT_PREFIX = "HYPERFRAMES_RENDER_SETUP_RESULT:";
const mode = process.argv[2];
const input = JSON.parse(process.env.HYPERFRAMES_RENDER_SETUP_INPUT ?? "{}");

const disposeSignalHandlers = installRenderSetupSignalHandlers(
  process,
  releaseOwnedBrowserInstallLock,
  (signal) => process.kill(process.pid, signal),
  process.env.HYPERFRAMES_RENDER_DETACHED !== "1",
);

let result: unknown;
if (mode === "browser") {
  result = await ensureBrowser(input);
} else if (mode === "lint") {
  result = await lintProject(
    input.projectDir,
    input.entryFile,
    input.host ? { host: input.host } : undefined,
  );
} else if (mode === "orphan-cleanup") {
  const killed = killOrphanedProcesses();
  result = killed;
  if (killed > 0) await new Promise((resolve) => setTimeout(resolve, 600));
} else {
  throw new Error(`Unknown render setup mode: ${mode}`);
}

disposeSignalHandlers();
process.stdout.write(RESULT_PREFIX + JSON.stringify(result) + "\n");
