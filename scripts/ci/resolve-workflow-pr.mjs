import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function dispatchedPullRequest(pulls, repository, branch, sha) {
  const matches = pulls.filter(
    (pr) => pr.state === "open" && pr.head.repo?.full_name === repository && pr.head.ref === branch,
  );
  if (matches.length !== 1)
    throw new Error("Dispatch requires exactly one open PR for this branch.");
  const pr = matches[0];
  if (pr.head.sha !== sha)
    throw new Error("PR head changed after dispatch; run checks on the new head.");
  return pr;
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    const repository = process.env.GITHUB_REPOSITORY;
    const branch = process.env.GITHUB_REF_NAME;
    const owner = repository.split("/")[0];
    const raw = execFileSync(
      "gh",
      [
        "api",
        `repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    event.pull_request = dispatchedPullRequest(
      JSON.parse(raw),
      repository,
      branch,
      process.env.GITHUB_SHA,
    );
  }
  if (!event.pull_request) throw new Error("This check requires an open pull request.");
  const path = join(process.env.RUNNER_TEMP, "workflow-pr-event.json");
  writeFileSync(path, JSON.stringify(event));
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `event_path=${path}\npr=${JSON.stringify(event.pull_request)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
