import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { DOWNLOAD_HINT, openInDesktop, type DesktopOpenResult } from "../utils/desktopApp.js";
import { resolveProject, resolveProjectOrThrow, type ProjectDir } from "../utils/project.js";

export const examples: Example[] = [
  ["Open this project in HyperFrames Studio", "hyperframes open"],
  ["Open another project", "hyperframes open ./my-video"],
  ["For agents", "hyperframes open --json"],
];

const WHY_NOT: Record<Extract<DesktopOpenResult, { opened: false }>["reason"], string | null> = {
  "handoff-unavailable": null,
  "unsupported-platform": "Opening a project from the CLI works on macOS only.",
  "not-installed": "HyperFrames Studio isn't installed on this Mac.",
  "open-failed": "macOS couldn't open HyperFrames Studio.",
};

function printResult(project: ProjectDir, result: DesktopOpenResult): void {
  if (result.opened) {
    console.log(`${c.success("◇")}  Opening ${c.accent(project.name)} in HyperFrames Studio`);
    if (result.handedOver) {
      const agent = result.handedOver.engine === "claude" ? "Claude Code" : "Codex";
      console.log(`   ${c.dim(`Its chat picks up this ${agent} conversation.`)}`);
    }
    return;
  }
  const why = WHY_NOT[result.reason];
  if (!why) return console.log(`${c.warn("◇")}  ${DOWNLOAD_HINT}`);
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
  meta: { name: "open", description: "Open a project in HyperFrames Studio, the desktop app" },
  args: {
    dir: {
      type: "positional",
      description: "Project directory (default: current)",
      required: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const project = args.json ? projectForJson(args.dir) : resolveProject(args.dir);
    if (!project) return;
    const result = openInDesktop(project.dir);
    if (!result.opened) setCommandExitCode(1);
    if (args.json) console.log(JSON.stringify({ project: project.dir, ...result }, null, 2));
    else printResult(project, result);
  },
});
