import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";

import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { publishProjectArchive } from "../utils/publishProject.js";

export const examples: Example[] = [
  ["Publish the current project with a public URL", "hyperframes publish"],
  ["Publish a specific directory", "hyperframes publish ./my-video"],
  ["Skip the consent prompt (scripts)", "hyperframes publish --yes"],
];

export default defineCommand({
  meta: {
    name: "publish",
    description: "Upload the project and return a stable public URL",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the publish confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    const rawArg = args.dir;
    const dir = resolve(rawArg ?? ".");
    const isImplicitCwd = !rawArg || rawArg === "." || rawArg === "./";
    const projectName = isImplicitCwd ? basename(process.env["PWD"] ?? dir) : basename(dir);

    const indexPath = join(dir, "index.html");
    if (existsSync(indexPath)) {
      const lintResult = lintProject({ dir, name: projectName, indexPath });
      if (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0) {
        console.log();
        for (const line of formatLintFindings(lintResult)) console.log(line);
        console.log();
      }
    }

    if (args.yes !== true) {
      console.log();
      console.log(
        `  ${c.bold("hyperframes publish uploads this project and creates a stable public URL.")}`,
      );
      console.log(
        `  ${c.dim("Anyone with the URL can open the published project and claim it after authenticating.")}`,
      );
      console.log();
      const approved = await clack.confirm({ message: "Publish this project?" });
      if (clack.isCancel(approved) || approved !== true) {
        console.log();
        console.log(`  ${c.dim("Aborted.")}`);
        console.log();
        return;
      }
    }

    clack.intro(c.bold("hyperframes publish"));
    const publishSpinner = clack.spinner();
    publishSpinner.start("Uploading project...");

    try {
      const published = await publishProjectArchive(dir);
      const claimUrl = new URL(published.url);
      claimUrl.searchParams.set("claim_token", published.claimToken);
      publishSpinner.stop(c.success("Project published"));

      console.log();
      console.log(`  ${c.dim("Project")}    ${c.accent(published.title)}`);
      console.log(`  ${c.dim("Files")}      ${String(published.fileCount)}`);
      console.log(`  ${c.dim("Public")}     ${c.accent(claimUrl.toString())}`);
      console.log();
      console.log(
        `  ${c.dim("Open the URL on hyperframes.dev to claim the project and continue editing.")}`,
      );
      console.log();
      return;
    } catch (err: unknown) {
      publishSpinner.stop(c.error("Publish failed"));
      console.error();
      console.error(`  ${(err as Error).message}`);
      console.error();
      process.exitCode = 1;
      return;
    }
  },
});
