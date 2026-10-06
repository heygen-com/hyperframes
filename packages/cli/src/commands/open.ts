import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { downloadHint, openInDesktop, type DesktopOpenResult } from "../utils/desktopApp.js";
import { resolveProject, resolveProjectOrThrow, type ProjectDir } from "../utils/project.js";

export const examples: Example[] = [
  ["Open this project in the HyperFrames desktop app", "hyperframes open"],
  ["Open another project", "hyperframes open ./my-video"],
  ["For agents", "hyperframes open --json"],
];

const WHY_NOT: Record<Extract<DesktopOpenResult, { opened: false }>["reason"], string | null> = {
  "handoff-unavailable": null,
  "unsupported-platform": "Opening a project from the CLI works on macOS, Windows and Linux only.",
  "not-installed": "The HyperFrames desktop app isn't installed on this computer.",
  "open-failed": "The HyperFrames desktop app couldn't be started.",
};

function printResult(project: ProjectDir, result: DesktopOpenResult): void {
  if (result.opened) {
    console.log(`${c.success("◇")}  Opening ${c.accent(project.name)} in ${result.app}`);
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
  run({ args }) {
    const project = args.json ? projectForJson(args.dir) : resolveProject(args.dir);
    if (!project) return;
    const result = openInDesktop(project.dir);
    if (!result.opened) setCommandExitCode(1);
    const catchUp =
      result.opened && result.handedOver ? { catchUp: "npx hyperframes catch-up" } : {};
    if (args.json)
      console.log(JSON.stringify({ project: project.dir, ...result, ...catchUp }, null, 2));
    else printResult(project, result);
  },
});
