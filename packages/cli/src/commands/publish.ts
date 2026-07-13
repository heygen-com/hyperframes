import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";

import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { publishProjectArchive } from "../utils/publishProject.js";
import {
  ensureProjectId,
  readProjectLink,
  readTeamProjectId,
  writeTeamProjectId,
} from "../utils/projectLink.js";

export const examples: Example[] = [
  ["Publish the current project with a public URL", "hyperframes publish"],
  ["Publish a specific directory", "hyperframes publish ./my-video"],
  ["Make the claimed project public to anyone", "hyperframes publish --public"],
  ["Update an existing published project in place", "hyperframes publish --update <url|id>"],
  ["Skip the consent prompt (scripts)", "hyperframes publish --yes"],
];

/** Extract a project id from a full published URL (…/p/<id>) or accept a bare id. */
function parseUpdateTarget(value: string): string {
  const trimmed = value.trim();
  try {
    const segment = new URL(trimmed).pathname.split("/").filter(Boolean).pop();
    if (segment) return segment;
  } catch {
    // Not a URL — treat as a bare id.
  }
  return trimmed;
}

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
    public: {
      type: "boolean",
      description: "Make the claimed project public to anyone, not just the claimer",
      default: false,
    },
    update: {
      type: "string",
      description: "Update an existing published project in place (its URL or id)",
    },
  },
  async run({ args }) {
    const rawArg = args.dir;
    const dir = resolve(rawArg ?? ".");
    const indexPath = join(dir, "index.html");
    if (existsSync(indexPath)) {
      const lintResult = await lintProject(dir);
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

    // Resolve the stable id to update: an explicit --update target wins, else a committed
    // team id, else this machine's stored/minted id. Only sent when authenticated.
    const requestedProjectId =
      typeof args.update === "string" && args.update.trim()
        ? parseUpdateTarget(args.update)
        : (readTeamProjectId(dir) ?? ensureProjectId(dir));

    // Continuity cue: if this directory was published before, show where it lives so the
    // user knows a re-publish updates that same link (when logged in).
    const priorLink = readProjectLink(dir);
    if (priorLink?.url) {
      console.log();
      console.log(`  ${c.dim(`Previously published at ${priorLink.url}`)}`);
    }

    clack.intro(c.bold("hyperframes publish"));
    const publishSpinner = clack.spinner();
    publishSpinner.start("Uploading project...");

    try {
      const published = await publishProjectArchive(dir, {
        public: args.public === true,
        projectId: requestedProjectId,
      });
      publishSpinner.stop(c.success("Project published"));

      console.log();
      console.log(`  ${c.dim("Project")}    ${c.accent(published.title)}`);
      console.log(`  ${c.dim("Files")}      ${String(published.fileCount)}`);

      if (published.claimed) {
        // The server returns the same id on an in-place update, a fresh id on create.
        const updatedInPlace = published.projectId === requestedProjectId;
        console.log(`  ${c.dim("URL")}        ${c.accent(published.url)}`);
        console.log(
          `  ${c.dim("Status")}     ${c.accent(updatedInPlace ? "Updated existing project" : "Created new project")}`,
        );
        if (args.update && !updatedInPlace) {
          console.log();
          console.log(
            `  ${c.dim("The requested project was not updated (not found or not owned by you); a new one was created.")}`,
          );
        }
        if (readTeamProjectId(dir) === null) {
          const file = writeTeamProjectId(dir, published.projectId);
          console.log();
          console.log(
            `  ${c.dim(`Wrote ${relative(dir, file) || file} — commit it so your team publishes to this link.`)}`,
          );
        }
        console.log();
      } else {
        const claimUrl = new URL(published.url);
        claimUrl.searchParams.set("claim_token", published.claimToken);
        console.log(`  ${c.dim("Public")}     ${c.accent(claimUrl.toString())}`);
        console.log();
        console.log(
          `  ${c.dim("Open the URL on hyperframes.dev to claim the project and continue editing.")}`,
        );
        console.log();
        console.log(
          `  ${c.dim("Tip: run 'hyperframes auth login' first for a stable link you can re-publish to.")}`,
        );
        console.log();
      }
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
