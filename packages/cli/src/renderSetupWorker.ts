import "./utils/hideChildConsoles.js";
import "./utils/windowsExeSearch.js";
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

function setOwnPriority(priority: number, whatStaysNormal: string): void {
  try {
    setPriority(priority);
  } catch (error) {
    if (SANDBOX_REFUSED_PRIORITY.has((error as { info?: { code?: string } }).info?.code ?? ""))
      return;
    process.stderr.write(`${whatStaysNormal} at normal priority: ${(error as Error).message}\n`);
  }
}

async function runMode(): Promise<unknown> {
  if (mode === "browser") return ensureBrowser(input);
  if (mode === "browser-install") {
    setOwnPriority(constants.priority.PRIORITY_ABOVE_NORMAL, "The Chrome install runs");
    return runBrowserInstall(input);
  }
  if (mode === "lint") {
    // A background lint (Studio's, preview's) takes idle CPU only; a render waits on its lint, so that one does not.
    if (input.background) setOwnPriority(constants.priority.PRIORITY_LOW, "Lint runs");
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
