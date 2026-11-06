import "./utils/hideChildConsoles.js";
import { constants, setPriority } from "node:os";
import { runBrowserInstall } from "./browser/installRun.js";
import { ensureBrowser, releaseOwnedBrowserInstallLock } from "./browser/manager.js";
import { lintProject } from "./utils/lintProject.js";
import { killOrphanedProcesses } from "./utils/orphanCleanup.js";
import {
  installRenderSetupSignalHandlers,
  renderSetupErrorLine,
  renderSetupResultLine,
} from "./renderSetupWorkerLifecycle.js";

const mode = process.argv[2];
const input = JSON.parse(process.env.HYPERFRAMES_RENDER_SETUP_INPUT ?? "{}");

const disposeSignalHandlers = installRenderSetupSignalHandlers(
  process,
  releaseOwnedBrowserInstallLock,
  (signal) => process.kill(process.pid, signal),
  process.env.HYPERFRAMES_RENDER_DETACHED !== "1",
);

const SANDBOX_REFUSED_PRIORITY = new Set(["EPERM", "EACCES"]);

function lowerPriority(): void {
  try {
    setPriority(constants.priority.PRIORITY_LOW);
  } catch (error) {
    if (SANDBOX_REFUSED_PRIORITY.has((error as { info?: { code?: string } }).info?.code ?? ""))
      return;
    process.stderr.write(`Lint runs at normal priority: ${(error as Error).message}\n`);
  }
}

/**
 * Each small disk write of the Chrome download queues for CPU: behind a busy Windows PC's work that took minutes
 * for seconds of work, with data still arriving so nothing ever counted as a stall.
 */
function raisePriority(): void {
  try {
    setPriority(constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch {
    // expected: most Unix systems refuse this without privileges, and the install then runs at normal priority.
  }
}

async function runMode(): Promise<unknown> {
  if (mode === "browser") return ensureBrowser(input);
  if (mode === "browser-install") {
    raisePriority();
    return runBrowserInstall(input);
  }
  if (mode === "lint") {
    // A background lint (Studio's, preview's) takes idle CPU only; a render waits on its lint, so that one does not.
    if (input.background) lowerPriority();
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
  process.stdout.write(renderSetupResultLine(result));
} catch (error) {
  process.stderr.write(renderSetupErrorLine(error), () => {
    throw error;
  });
}
