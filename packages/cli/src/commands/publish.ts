import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";

import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import {
  buildPublishFileMap,
  publishProjectArchive,
  zipPublishFileMap,
} from "../utils/publishProject.js";
import { bakeMediaProxies } from "../utils/publishProxyBake.js";
import { resolveAutoProxy } from "../utils/projectConfig.js";
import { tryResolveCredential } from "../auth/index.js";
import {
  ensureProjectId,
  readProjectLink,
  readTeamProject,
  writeTeamProject,
} from "../utils/projectLink.js";

export const examples: Example[] = [
  ["Publish the current project with a public URL", "hyperframes publish"],
  ["Publish a specific directory", "hyperframes publish ./my-video"],
  ["Make the claimed project public to anyone", "hyperframes publish --public"],
  ["Update an existing published project in place", "hyperframes publish --update <url|id>"],
  ["Publish to a shared team space", "hyperframes publish --space <space-id>"],
  ["Skip the consent prompt (scripts)", "hyperframes publish --yes"],
  ["Skip baking H.264 proxies for browser-hostile video codecs", "hyperframes publish --no-proxy"],
];

/** Extract a project id from a published URL (with or without scheme, query, or hash) or accept a bare id. */
export function parseUpdateTarget(value: string): string {
  const trimmed = value.trim();
  // Pull the id straight out of a `/p/<id>` path — works for full URLs, scheme-less URLs
  // (which `new URL` rejects), and links carrying `?query`/`#hash`.
  const pathMatch = trimmed.match(/\/p\/([^/?#]+)/);
  if (pathMatch?.[1]) return pathMatch[1];
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
    space: {
      type: "string",
      description: "Publish into a shared team space (its id) so teammates update one link",
    },
    proxy: {
      type: "boolean",
      description:
        "Bake H.264 proxies for browser-hostile video codecs (e.g. HEVC) into the published archive. Default: on, unless disabled via hyperframes.json media.autoProxy. Pass --no-proxy to skip.",
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

    const updateTarget =
      typeof args.update === "string" && args.update.trim()
        ? parseUpdateTarget(args.update)
        : undefined;
    const spaceOverride =
      typeof args.space === "string" && args.space.trim() ? args.space.trim() : undefined;

    // --update / --space only take effect for an authenticated owner. Fail loudly rather
    // than silently minting a fresh URL — the exact failure mode this feature removes.
    if (updateTarget || spaceOverride) {
      const credential = await tryResolveCredential();
      if (!credential) {
        console.log();
        console.log(
          `  ${c.error(`${updateTarget ? "--update" : "--space"} requires authentication. Run 'hyperframes auth login' first.`)}`,
        );
        console.log();
        process.exitCode = 1;
        return;
      }
    }

    const committedTeam = readTeamProject(dir);
    // Stable id: explicit --update wins, else the committed team id, else this machine's stored/minted id.
    const requestedProjectId = updateTarget ?? committedTeam?.projectId ?? ensureProjectId(dir);
    // Team space: explicit --space wins, else the committed space id, else the personal space.
    const spaceId = spaceOverride ?? committedTeam?.spaceId;

    // Continuity cue: if this directory was published before, show where it lives so the
    // user knows a re-publish updates that same link (when logged in).
    const priorLink = readProjectLink(dir);
    if (priorLink?.url) {
      console.log();
      console.log(`  ${c.dim(`Previously published at ${priorLink.url}`)}`);
    }

    clack.intro(c.bold("hyperframes publish"));
    const publishSpinner = clack.spinner();
    publishSpinner.start("Preparing project...");

    try {
      // Resolution order (per hyperframes.json's `media.autoProxy`): an
      // explicit --proxy/--no-proxy flag wins in either direction, else the
      // committed config, else on by default.
      const proxyFlagValue = typeof args.proxy === "boolean" ? args.proxy : undefined;
      const autoProxy = resolveAutoProxy(dir, proxyFlagValue);
      const fileMap = buildPublishFileMap(dir);
      let proxyBakeManifest: Awaited<ReturnType<typeof bakeMediaProxies>> | undefined;
      if (autoProxy) {
        proxyBakeManifest = await bakeMediaProxies(dir, fileMap);
      }
      const archive = zipPublishFileMap(fileMap);
      publishSpinner.message("Uploading project...");

      const published = await publishProjectArchive(dir, {
        public: args.public === true,
        projectId: requestedProjectId,
        spaceId,
        archive,
      });
      publishSpinner.stop(c.success("Project published"));

      console.log();
      console.log(`  ${c.dim("Project")}    ${c.accent(published.title)}`);
      console.log(`  ${c.dim("Files")}      ${String(published.fileCount)}`);
      if (proxyBakeManifest) {
        console.log(`  ${c.dim("Proxies")}    ${String(proxyBakeManifest.proxied.length)} baked`);
        if (proxyBakeManifest.skippedAlpha.length > 0) {
          console.log(
            `  ${c.dim("Proxy note")} ${String(proxyBakeManifest.skippedAlpha.length)} alpha source(s) kept original`,
          );
        }
      }

      if (published.claimed) {
        // The server returns the same id on an in-place update, a fresh id on create.
        const updatedInPlace = published.projectId === requestedProjectId;
        console.log(`  ${c.dim("URL")}        ${c.accent(published.url)}`);
        console.log(
          `  ${c.dim("Status")}     ${c.accent(updatedInPlace ? "Updated existing project" : "Created new project")}`,
        );
        // Warn whenever we aimed at a KNOWN existing project (an explicit --update target or
        // a committed team id) but the server created a fresh one instead — so a teammate
        // whose space doesn't own the committed project doesn't silently lose the shared link.
        if ((updateTarget || committedTeam) && !updatedInPlace) {
          const targetDesc = updateTarget ? "The requested project" : "The committed team project";
          console.log();
          console.log(
            `  ${c.dim(`${targetDesc} was not updated (not found, or your space can't access it); a new project was created above instead.`)}`,
          );
        }
        // Persist a committable descriptor so a team converges on this link. This is a
        // convenience: wrap it so a read-only project dir can't turn a successful publish
        // into a "Publish failed" (the outer catch owns publish failures only).
        if (
          committedTeam === null ||
          (spaceId !== undefined && committedTeam.spaceId !== spaceId)
        ) {
          try {
            const file = writeTeamProject(dir, { projectId: published.projectId, spaceId });
            console.log();
            console.log(
              `  ${c.dim(`Wrote ${relative(dir, file) || file} — commit it so your team publishes to this link.`)}`,
            );
          } catch {
            // Convenience file only; never shadow a successful publish with a local write failure.
          }
        }
        console.log();
      } else {
        const claimUrl = new URL(published.url);
        claimUrl.searchParams.set("claim_token", published.claimToken);
        console.log(`  ${c.dim("Public")}     ${c.accent(claimUrl.toString())}`);
        console.log();
        if (updateTarget || spaceOverride) {
          // The pre-publish gate saw a credential, but the server didn't accept it (expired
          // or invalid) and fell back to anonymous — say so loudly instead of pretending the
          // requested update happened.
          console.log(
            `  ${c.error(`Your login looks expired or invalid, so ${updateTarget ? "--update" : "--space"} was ignored and a NEW url was created above.`)}`,
          );
          console.log(
            `  ${c.dim("Run 'hyperframes auth login' again, then re-publish to update in place.")}`,
          );
        } else {
          console.log(
            `  ${c.dim("Open the URL on hyperframes.dev to claim the project and continue editing.")}`,
          );
          console.log();
          console.log(
            `  ${c.dim("Tip: run 'hyperframes auth login' first for a stable link you can re-publish to.")}`,
          );
        }
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
