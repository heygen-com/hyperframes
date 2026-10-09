import { constants, setPriority } from "node:os";
import { ensureBrowser, releaseOwnedBrowserInstallLock } from "./browser/manager.js";
import { lintProject } from "./utils/lintProject.js";
import { killOrphanedProcesses } from "./utils/orphanCleanup.js";
import {
  RENDER_SETUP_RESULT_PREFIX,
  installRenderSetupSignalHandlers,
  renderSetupErrorLine,
} from "./renderSetupWorkerLifecycle.js";

const mode = process.argv[2];
const input = JSON.parse(process.env.HYPERFRAMES_RENDER_SETUP_INPUT ?? "{}");

const disposeSignalHandlers = installRenderSetupSignalHandlers(
  process,
  releaseOwnedBrowserInstallLock,
  (signal) => process.kill(process.pid, signal),
  process.env.HYPERFRAMES_RENDER_DETACHED !== "1",
);

async function runMode(): Promise<unknown> {
  if (mode === "browser") return ensureBrowser(input);
  if (mode === "lint") {
    // Nobody waits on a background lint the way they wait on a Studio boot, so it takes idle CPU only.
    setPriority(constants.priority.PRIORITY_LOW);
    return lintProject(
      input.projectDir,
      input.entryFile,
      input.host ? { host: input.host } : undefined,
    );
  }
  if (mode === "orphan-cleanup") {
    const killed = killOrphanedProcesses();
    if (killed > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    return killed;
  }
  throw new Error(`Unknown render setup mode: ${mode}`);
}

try {
  const result = await runMode().finally(disposeSignalHandlers);
  process.stdout.write(RENDER_SETUP_RESULT_PREFIX + JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(renderSetupErrorLine(error), () => {
    throw error;
  });
}
