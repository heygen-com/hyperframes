import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { openInDesktop } from "../utils/desktopApp.js";
import { resolveProject } from "../utils/project.js";

export const examples: Example[] = [
  ["Open this project in HyperFrames Studio", "hyperframes open"],
  ["Open another project", "hyperframes open ./my-video"],
  ["For agents", "hyperframes open --json"],
];

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
    const project = resolveProject(args.dir);
    const result = openInDesktop(project.dir);
    if (args.json) {
      console.log(JSON.stringify({ project: project.dir, ...result }, null, 2));
      return;
    }
    if (result.opened) {
      console.log(`${c.success("◇")}  Opening ${c.accent(project.name)} in HyperFrames Studio`);
      if (result.handedOver) {
        const agent = result.handedOver.engine === "claude" ? "Claude Code" : "Codex";
        console.log(`   ${c.dim(`Its chat picks up this ${agent} conversation.`)}`);
      }
      return;
    }
    console.log(
      result.reason === "not-installed"
        ? `${c.warn("◇")}  HyperFrames Studio isn't installed on this Mac.`
        : `${c.warn("◇")}  Opening a project from the CLI works on macOS only for now.`,
    );
    console.log(`   Download it: ${c.accent(result.downloadUrl)}`);
  },
});
