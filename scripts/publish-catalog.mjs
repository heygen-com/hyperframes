import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { GENERATED_CATALOG_PATHS } from "./catalog-generated-paths.mjs";

const BRANCH = "bot/catalog-publish";
const TITLE = "chore(catalog): publish generated catalog";
const MAX_BATCH_BYTES = 10 * 1024 * 1024;

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function catalogChanges(root, base) {
  const tracked = git(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    base,
    "--",
    ...GENERATED_CATALOG_PATHS,
  ]);
  const untracked = git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...GENERATED_CATALOG_PATHS,
  ]);
  const removed = new Set(
    git(root, [
      "diff",
      "--name-only",
      "--diff-filter=D",
      "--no-renames",
      "-z",
      base,
      "--",
      ...GENERATED_CATALOG_PATHS,
    ]).split("\0"),
  );
  return [...new Set([...tracked.split("\0"), ...untracked.split("\0")])]
    .filter(Boolean)
    .sort()
    .map((path) => {
      if (removed.has(path)) return { path, kind: "delete" };
      return { path, kind: "write", contents: artifactContents(resolve(root, path)) };
    });
}

function artifactContents(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile())
      throw new Error(`Generated artifact must be a regular file: ${path}`);
    return readFileSync(descriptor).toString("base64");
  } finally {
    closeSync(descriptor);
  }
}

function batchEntry(change) {
  const size = Buffer.byteLength(JSON.stringify(change));
  if (size > MAX_BATCH_BYTES)
    throw new Error(`Generated artifact exceeds API batch budget: ${change.path}`);
  if (change.kind === "delete") return { size, field: "deletions", file: { path: change.path } };
  return { size, field: "additions", file: { path: change.path, contents: change.contents } };
}

export function commitBatches(changes) {
  let batch = { additions: [], deletions: [] };
  const batches = [batch];
  let bytes = 0;
  for (const change of changes) {
    const { size, field, file } = batchEntry(change);
    if (bytes + size > MAX_BATCH_BYTES || batch.additions.length + batch.deletions.length === 100) {
      batch = { additions: [], deletions: [] };
      batches.push(batch);
      bytes = 0;
    }
    batch[field].push(file);
    bytes += size;
  }
  return batches.filter((entry) => entry.additions.length + entry.deletions.length > 0);
}

function api(endpoint, method = "GET", body, jq) {
  const args = ["api", endpoint, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  if (jq) args.push("--jq", jq);
  return execFileSync("gh", args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  }).trim();
}

function commitOid(value) {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("GitHub returned an invalid commit id.");
  return value;
}

function catalogTree(root) {
  const temp = mkdtempSync(join(tmpdir(), "catalog-index-"));
  const run = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_INDEX_FILE: join(temp, "index") },
    }).trim();
  try {
    run(["read-tree", "HEAD"]);
    run(["add", "-A", "--", ...GENERATED_CATALOG_PATHS]);
    return run(["write-tree"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function signedCommit(repository, branch, head, fileChanges) {
  const query = `mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid signature { isValid } } }
  }`;
  const result = api(
    "graphql",
    "POST",
    {
      query,
      variables: {
        input: {
          branch: { repositoryNameWithOwner: repository, branchName: branch },
          expectedHeadOid: head,
          message: { headline: TITLE },
          fileChanges,
        },
      },
    },
    '.data.createCommitOnBranch.commit | if .signature.isValid then .oid else error("Commit is not signed") end',
  );
  return commitOid(result);
}

function openPublishPrNumber(repository) {
  const owner = repository.split("/")[0];
  const endpoint = `repos/${repository}/pulls`;
  const numbers = api(
    `${endpoint}?state=open&head=${owner}:${BRANCH}&base=main`,
    "GET",
    undefined,
    ".[].number",
  )
    .split("\n")
    .filter(Boolean);
  if (numbers.length > 1) throw new Error("More than one catalog publish PR is open.");
  const number = numbers[0];
  if (number !== undefined && !/^\d+$/.test(number))
    throw new Error("GitHub returned an invalid PR number.");
  return number;
}

function openPublishPr(repository, base) {
  const endpoint = `repos/${repository}/pulls`;
  const number = openPublishPrNumber(repository);
  const body =
    `Generated catalog snapshot from ${base}.\n\n` +
    "Item sources are reviewed in their own PRs. This PR publishes the registry index, search vectors, docs pages, payloads and navigation together.\n\n" +
    "Required workflows are dispatched on this snapshot. Review and merge after checks pass. Publication uses GITHUB_TOKEN and GitHub-signed API commits; branch protection remains in effect.";
  if (number !== undefined) {
    if (api(`${endpoint}/${number}`, "GET", undefined, ".body") !== body)
      api(`${endpoint}/${number}`, "PATCH", { title: TITLE, body });
  } else {
    api(endpoint, "POST", { title: TITLE, body, head: BRANCH, base: "main" });
  }
}

function checkAlreadyScheduled(run) {
  if (!run) return false;
  return run.status !== "completed" || run.conclusion === "success";
}

function publishCheckRequest(workflow) {
  if (workflow === "ci.yml" || workflow === "regression.yml")
    return { ref: BRANCH, inputs: { catalog_publish: true } };
  return { ref: BRANCH };
}

function dispatchPublishChecks(repository) {
  const head = commitOid(
    api(`repos/${repository}/git/ref/heads/${BRANCH}`, "GET", undefined, ".object.sha"),
  );
  for (const workflow of [
    "ci.yml",
    "regression.yml",
    "windows-render.yml",
    "pr-captures.yml",
    "codeql.yml",
  ]) {
    const endpoint = `repos/${repository}/actions/workflows/${workflow}`;
    const request = publishCheckRequest(workflow);
    const runs = JSON.parse(
      api(`${endpoint}/runs?event=workflow_dispatch&head_sha=${head}&per_page=100`),
    );
    const latest = runs.workflow_runs.find(
      (run) => !request.inputs || run.display_title === "Checks (catalog_publish=true)",
    );
    if (checkAlreadyScheduled(latest)) continue;
    api(`${endpoint}/dispatches`, "POST", request);
  }
}

function actionEnvironment() {
  const { GITHUB_REPOSITORY: repository = "", GITHUB_RUN_ID: run = "" } = process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(run))
    throw new Error("Run publication in GitHub Actions.");
  return { repository, run, endpoint: `repos/${repository}/git` };
}

function assertCurrentMain(endpoint, base) {
  const current = commitOid(api(`${endpoint}/ref/heads/main`, "GET", undefined, ".object.sha"));
  if (current !== base)
    throw new Error("Main advanced during publication; the next push run will regenerate it.");
}

function updateStandingBranch(endpoint, exists, head) {
  if (exists) api(`${endpoint}/refs/heads/${BRANCH}`, "PATCH", { sha: head, force: true });
  else api(`${endpoint}/refs`, "POST", { ref: `refs/heads/${BRANCH}`, sha: head });
}

function clearObsoletePublication(repository, base, exists) {
  const endpoint = `repos/${repository}/git`;
  const number = openPublishPrNumber(repository);
  assertCurrentMain(endpoint, base);
  if (number !== undefined)
    api(`repos/${repository}/pulls/${number}`, "PATCH", { state: "closed" });
  if (exists) updateStandingBranch(endpoint, true, base);
  console.log("No unpublished catalog changes; obsolete publication cleared.");
}

function snapshotMatches(root, endpoint, exists) {
  if (!exists) return false;
  const previous = commitOid(
    api(`${endpoint}/ref/heads/${BRANCH}`, "GET", undefined, ".object.sha"),
  );
  const tree = commitOid(api(`${endpoint}/commits/${previous}`, "GET", undefined, ".tree.sha"));
  return tree === catalogTree(root);
}

function cleanStagingBranch(endpoint, staging, errors) {
  try {
    api(`${endpoint}/refs/heads/${staging}`, "DELETE");
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Publication and staging cleanup failed.");
}

function publishSnapshot(context, base, exists, batches) {
  const { repository, run, endpoint } = context;
  const staging = `${BRANCH}-build-${run}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  api(`${endpoint}/refs`, "POST", { ref: `refs/heads/${staging}`, sha: base });
  const errors = [];
  try {
    let head = base;
    for (const batch of batches) head = signedCommit(repository, staging, head, batch);
    assertCurrentMain(endpoint, base);
    updateStandingBranch(endpoint, exists, head);
    openPublishPr(repository, base);
    dispatchPublishChecks(repository);
  } catch (error) {
    errors.push(error);
  }
  cleanStagingBranch(endpoint, staging, errors);
}

export function publish(root) {
  const base = commitOid(git(root, ["rev-parse", "HEAD"]));
  const changes = catalogChanges(root, base);
  const batches = commitBatches(changes);
  console.log(
    `Catalog publication: ${changes.length} files, ${batches.length} signed commit batches.`,
  );
  if (process.argv.includes("--dry-run")) return;
  const context = actionEnvironment();
  const { repository, endpoint } = context;
  assertCurrentMain(endpoint, base);
  const refs = api(`${endpoint}/matching-refs/heads/${BRANCH}`, "GET", undefined, ".[].ref").split(
    "\n",
  );
  const exists = refs.includes(`refs/heads/${BRANCH}`);
  if (batches.length === 0) return clearObsoletePublication(repository, base, exists);
  if (snapshotMatches(root, endpoint, exists)) {
    openPublishPr(repository, base);
    dispatchPublishChecks(repository);
    console.log("Standing catalog PR already contains this snapshot.");
    return;
  }
  publishSnapshot(context, base, exists, batches);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish(fileURLToPath(new URL("..", import.meta.url)));
}
