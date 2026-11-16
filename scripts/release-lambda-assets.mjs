#!/usr/bin/env node
// Decides which Lambda assets a release run may reuse from the GitHub Release instead of building.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WORKFLOW_BOT = "github-actions[bot]";
export const LAMBDA_ASSETS = {
  zip: ["hyperframes-lambda-handler.zip", "hyperframes-lambda-handler.sha256"],
  image: ["hyperframes-lambda-video-arm64.oci.tar", "hyperframes-lambda-video-arm64.sha256"],
};

/**
 * Only an earlier attempt of this same run may have left the release and its Lambda assets, so a
 * release this run did not create, or an asset anyone else uploaded, fails the run.
 */
export function reusableLambdaAssets({ release, runCreatedAt, runAttempt }) {
  if (!release) return { zip: false, image: false };
  const tag = release.tag_name;
  if (
    runAttempt < 2 ||
    release.author?.login !== WORKFLOW_BOT ||
    Date.parse(release.created_at) < Date.parse(runCreatedAt)
  ) {
    throw new Error(
      `Release ${tag} already exists and an earlier attempt of this run did not create it ` +
        `(author ${release.author?.login ?? "unknown"}, created ${release.created_at}, run attempt ${runAttempt}). ` +
        "Find out who made it, then delete it before releasing this version.",
    );
  }
  const uploaded = new Map(release.assets.map((asset) => [asset.name, asset.uploader?.login]));
  const reuse = {};
  for (const [key, names] of Object.entries(LAMBDA_ASSETS)) {
    const present = names.filter((name) => uploaded.has(name));
    const foreign = present.filter((name) => uploaded.get(name) !== WORKFLOW_BOT);
    if (foreign.length > 0) {
      throw new Error(
        `Release ${tag} has ${foreign.join(", ")} uploaded by someone other than this workflow.`,
      );
    }
    if (present.length > 0 && present.length < names.length) {
      throw new Error(
        `Release ${tag} has ${present.join(", ")} without its pair; delete it and re-run.`,
      );
    }
    reuse[key] = present.length === names.length;
  }
  return reuse;
}

async function github(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return response.json();
}

async function main() {
  const { GH_TOKEN, REPO, VERSION, RUN_ID, RUN_ATTEMPT, GITHUB_OUTPUT } = process.env;
  const release = await github(`/repos/${REPO}/releases/tags/v${VERSION}`, GH_TOKEN);
  const run = release ? await github(`/repos/${REPO}/actions/runs/${RUN_ID}`, GH_TOKEN) : null;
  if (release && !run) throw new Error(`Workflow run ${RUN_ID} was not found`);
  const reuse = reusableLambdaAssets({
    release,
    runCreatedAt: run?.created_at,
    runAttempt: Number(RUN_ATTEMPT),
  });
  appendFileSync(GITHUB_OUTPUT, `zip=${reuse.zip}\nimage=${reuse.image}\n`);
  console.log(`Reuse from release v${VERSION}: zip=${reuse.zip} image=${reuse.image}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exit(1);
  });
}
