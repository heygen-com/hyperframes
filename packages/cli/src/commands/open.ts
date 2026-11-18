import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { terminalLines, terminalText } from "@hyperframes/core";
import { setCommandExitCode } from "../utils/commandResult.js";
import {
  desktopInstalled,
  downloadHint,
  openInDesktop,
  previewStopCommandFor,
  type DesktopOpenResult,
} from "../utils/desktopApp.js";
import { resolveProject, resolveProjectOrThrow, type ProjectDir } from "../utils/project.js";
import { readBackgroundPreviewStatus, stopBackgroundPreview } from "./previewLifecycle.js";

export const examples: Example[] = [
  ["Open this project in the HyperFrames desktop app", "hyperframes ."],
  ["Open another project", "hyperframes ./my-video"],
  ["Same, naming the command (needed for a folder named like a command)", "hyperframes open ."],
  ["For agents", "hyperframes open --json"],
];

const WHY_NOT: Record<Extract<DesktopOpenResult, { opened: false }>["reason"], string | null> = {
  "handoff-unavailable": null,
  "unsupported-platform": "Opening a project from the CLI works on macOS, Windows and Linux only.",
  "not-installed": "The HyperFrames desktop app isn't installed on this computer.",
  "open-failed": "The HyperFrames desktop app couldn't be started.",
};

type PreviewBeforeOpen =
  | { state: "none" }
  | { state: "stopped"; port: number }
  | {
      state: "left-running";
      port: number;
      stopCommand: string | null;
      stopCommandFromProject?: string;
      error?: string;
    };

const PREVIEW_SCAN_START_PORT = 3002;

function stopCommands(
  dir: string,
  port: number,
  platform: NodeJS.Platform,
): { stopCommand: string | null; stopCommandFromProject?: string } {
  const stopCommand = previewStopCommandFor(dir, port, process.cwd(), platform);
  return stopCommand === null
    ? { stopCommand, stopCommandFromProject: `hyperframes preview --stop --port ${port}` }
    : { stopCommand };
}

export async function endPreviewBeforeOpening(
  dir: string,
  {
    status = readBackgroundPreviewStatus,
    stop = stopBackgroundPreview,
    appInstalled = () => desktopInstalled(),
    platform = process.platform,
  }: {
    status?: (dir: string, startPort: number) => ReturnType<typeof readBackgroundPreviewStatus>;
    stop?: (dir: string, startPort: number) => Promise<boolean>;
    appInstalled?: () => boolean;
    platform?: NodeJS.Platform;
  } = {},
): Promise<PreviewBeforeOpen> {
  const running = await status(dir, PREVIEW_SCAN_START_PORT);
  if (!running) return { state: "none" };
  const leftRunning = (error?: string): PreviewBeforeOpen => ({
    state: "left-running",
    port: running.port,
    ...stopCommands(dir, running.port, platform),
    ...(error ? { error } : {}),
  });
  const startedInBackground = Boolean(running.logPath);
  if (!startedInBackground || !appInstalled()) return leftRunning();
  try {
    return (await stop(dir, running.port))
      ? { state: "stopped", port: running.port }
      : { state: "none" };
  } catch (error) {
    return leftRunning(error instanceof Error ? error.message : String(error));
  }
}

function printPreview(preview: PreviewBeforeOpen, opened: boolean): void {
  if (preview.state === "stopped")
    return console.log(
      `${c.success("◇")}  Stopped this project's background preview (port ${preview.port}) so the app can edit it.`,
    );
  if (preview.state !== "left-running" || !opened) return;
  console.log(
    preview.error
      ? `${c.warn("◇")}  Couldn't stop this project's preview (port ${preview.port}): ${terminalLines(preview.error)}`
      : `${c.warn("◇")}  A preview of this project is running (port ${preview.port}), and the app's edits wait until it stops.`,
  );
  const stop = preview.stopCommand ?? `${preview.stopCommandFromProject} from the project folder`;
  console.log(`   Stop it with: ${c.accent(terminalText(stop))}`);
}

function printResult(project: ProjectDir, result: DesktopOpenResult): void {
  if (result.opened) {
    console.log(
      `${c.success("◇")}  Opening ${c.accent(terminalText(project.name))} in ${result.app}`,
    );
    if (result.handedOver) {
      const agent = { claude: "Claude Code", codex: "Codex", grok: "Grok" }[
        result.handedOver.engine
      ];
      console.log(`   ${c.dim(`Its chat picks up this ${agent} conversation.`)}`);
      console.log(
        `   ${c.dim(`When the person is back here, run ${c.accent("npx hyperframes catch-up")} to see what they did in the app.`)}`,
      );
    }
    return;
  }
  const why = WHY_NOT[result.reason];
  if (!why) return console.log(`${c.warn("◇")}  ${downloadHint(result.downloadUrl)}`);
  console.log(`${c.warn("◇")}  ${why}`);
  console.log(`   Download it: ${c.accent(result.downloadUrl)}`);
}

/** Under --json a bad directory answers in JSON too, not with the human error box. */
function projectForJson(dir: string | undefined): ProjectDir | null {
  try {
    return resolveProjectOrThrow(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ ok: false, error: { code: "invalid-project", message } }));
    setCommandExitCode(1);
    return null;
  }
}

export default defineCommand({
  meta: { name: "open", description: "Open a project in the HyperFrames desktop app" },
  args: {
    dir: {
      type: "positional",
      description: "Project directory (default: current)",
      required: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = args.json ? projectForJson(args.dir) : resolveProject(args.dir);
    if (!project) return;
    const preview = await endPreviewBeforeOpening(project.dir);
    const result = openInDesktop(project.dir);
    if (!result.opened) setCommandExitCode(1);
    const catchUp =
      result.opened && result.handedOver ? { catchUp: "npx hyperframes catch-up" } : {};
    if (args.json)
      console.log(
        JSON.stringify({ project: project.dir, ...result, ...catchUp, preview }, null, 2),
      );
    else {
      printPreview(preview, result.opened);
      printResult(project, result);
    }
  },
});
