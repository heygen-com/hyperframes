import { defineCommand } from "citty";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import { failCommand } from "../utils/commandResult.js";
import { findProjects } from "../utils/findProjects.js";

export const examples: Example[] = [
  ["List the HyperFrames projects in your home folder", "hyperframes projects"],
  ["Stream them as JSON, one project per line", "hyperframes projects --json"],
  ["Search one folder only", "hyperframes projects --root ~/Videos"],
];

export default defineCommand({
  meta: { name: "projects", description: "Find the HyperFrames projects on this machine" },
  args: {
    json: {
      type: "boolean",
      description: "Output one JSON object per project per line, as each is found",
      default: false,
    },
    root: { type: "string", description: "Folder to search (default: your home folder)" },
  },
  async run({ args }) {
    const root = resolve(args.root ?? homedir());
    try {
      readdirSync(root);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const reason =
        code === "ENOENT"
          ? "does not exist"
          : code === "ENOTDIR"
            ? "is not a folder"
            : "cannot be read";
      errorBox("Cannot search this folder", `${root} ${reason}.`);
      failCommand();
    }
    const count = await findProjects({
      root,
      onProject: (project) => {
        if (args.json) console.log(JSON.stringify(project));
        else console.log(`   ${c.accent(project.name)}  ${c.dim(project.path)}`);
      },
    });
    if (!args.json) {
      console.log();
      console.log(`${c.success("◇")}  ${count === 1 ? "1 project" : `${count} projects`} found`);
    }
  },
});
