import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("./stable-release-guard.mjs", import.meta.url), "utf8");
const releaseRunbook = readFileSync(
  new URL("../docs/contributing/release-channels.mdx", import.meta.url),
  "utf8",
);
const healthWorkflowPath = new URL(
  "../.github/workflows/release-guard-health.yml",
  import.meta.url,
);
const healthWorkflowSource = existsSync(healthWorkflowPath)
  ? readFileSync(healthWorkflowPath, "utf8")
  : "";
const config = parse(workflow);
const publish = config.jobs.publish;
const checkout = publish.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
const checkoutGuard = publish.steps.find(
  (step) => step.name === "Verify immutable release checkout",
);
const createReleaseTag = publish.steps.find((step) => step.name === "Create release tag");
const stableGuard = publish.steps.find((step) => step.name === "Guard stable release");
const publishPackages = publish.steps.find((step) => step.name === "Publish packages");
const createGitHubRelease = publish.steps.find((step) => step.name === "Create GitHub Release");

const normalizeExpression = (expression) => expression.replace(/\s+/g, " ").trim();

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 5_000,
  }).trim();
}

function runCreateReleaseTag(cwd, version) {
  return spawnSync("bash", ["-euo", "pipefail", "-c", createReleaseTag.run], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, VERSION: version },
    timeout: 5_000,
  });
}

test("stable publishing has one reviewed immutable event path", () => {
  assert.deepEqual(config.on.push.tags, ["v*-*"]);
  assert.equal(config.on.workflow_dispatch, undefined);
  assert.equal(
    normalizeExpression(publish.if),
    "github.event_name == 'push' || (github.event.pull_request.merged == true && startsWith(github.event.pull_request.head.ref, 'release/v'))",
  );
  assert.equal(
    normalizeExpression(publish.env.EXPECTED_RELEASE_SHA),
    "${{ github.event_name == 'pull_request' && github.event.pull_request.merge_commit_sha || github.sha }}",
  );
  assert.equal(checkout.with.ref, "${{ env.EXPECTED_RELEASE_SHA }}");
});

test("the executable checkout guard cannot be conditionally disabled", () => {
  assert.ok(checkoutGuard);
  assert.equal(checkoutGuard.if, undefined);
  assert.equal(checkoutGuard["continue-on-error"], undefined);
  assert.equal(
    checkoutGuard.run.trim(),
    [
      'ACTUAL_SHA="$(git rev-parse HEAD)"',
      'EXPECTED_COMMIT_SHA="$(git rev-parse "${EXPECTED_RELEASE_SHA}^{commit}")"',
      'if [ "$ACTUAL_SHA" != "$EXPECTED_COMMIT_SHA" ]; then',
      '  echo "::error::Expected release commit $EXPECTED_COMMIT_SHA, checked out $ACTUAL_SHA"',
      "  exit 1",
      "fi",
    ].join("\n"),
  );
});

test("stable release tag recovery is idempotent and immutable", () => {
  assert.ok(createReleaseTag);
  assert.equal(createReleaseTag.if, "github.event_name == 'pull_request'");
  assert.equal(
    createReleaseTag.run.trim(),
    [
      'TAG="v$VERSION"',
      'EXPECTED_TAG_SHA="$(git rev-parse HEAD)"',
      "",
      "verify_remote_tag() {",
      '  git fetch --force --no-tags origin "+refs/tags/$TAG:refs/tags/$TAG"',
      '  ACTUAL_TAG_SHA="$(git rev-parse "refs/tags/$TAG^{commit}")"',
      '  if [ "$ACTUAL_TAG_SHA" != "$EXPECTED_TAG_SHA" ]; then',
      '    echo "::error::Release tag $TAG points to $ACTUAL_TAG_SHA, expected $EXPECTED_TAG_SHA"',
      "    exit 1",
      "  fi",
      '  echo "Release tag $TAG already exists at the expected commit — skipping"',
      "}",
      "",
      'if [ -n "$(git ls-remote --refs origin "refs/tags/$TAG")" ]; then',
      "  verify_remote_tag",
      "else",
      '  git tag --no-sign "$TAG" "$EXPECTED_TAG_SHA"',
      '  if ! git push origin "refs/tags/$TAG"; then',
      "    # A concurrent retry may have created the tag after ls-remote.",
      '    git tag -d "$TAG"',
      "    verify_remote_tag",
      "  fi",
      "fi",
    ].join("\n"),
  );
});

test("the stable guard precedes every irreversible release side effect", () => {
  assert.ok(stableGuard);
  assert.equal(stableGuard.if, "github.event_name == 'pull_request'");
  assert.equal(stableGuard["continue-on-error"], undefined);
  assert.match(stableGuard.run, /stable-release-guard\.mjs/);
  assert.ok(publish.steps.indexOf(stableGuard) < publish.steps.indexOf(createReleaseTag));
  assert.ok(publish.steps.indexOf(stableGuard) < publish.steps.indexOf(publishPackages));
  assert.deepEqual(publish.permissions, { contents: "write", "id-token": "write" });
  assert.equal(publish["timeout-minutes"], 60);
});

test("the stable guard alone receives the dedicated policy-read credential", () => {
  assert.equal(stableGuard.env.RELEASE_GUARD_TOKEN, "${{ secrets.RELEASE_GUARD_TOKEN }}");
  assert.equal(stableGuard.env.GH_TOKEN, undefined);
  assert.equal(createGitHubRelease.env.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  for (const step of publish.steps.filter((candidate) => candidate !== stableGuard)) {
    assert.equal(step.env?.RELEASE_GUARD_TOKEN, undefined);
  }
  assert.equal(workflow.match(/secrets\.RELEASE_GUARD_TOKEN/g)?.length, 1);
});

test("effective non-check rule enforcement and maintenance are explicit", () => {
  assert.match(
    guardSource,
    /last-push.*unattributed.*signed.*enforced indirectly.*exact.*rule-suite.*pass/is,
  );
  assert.match(releaseRunbook, /Unsupported effective repository rule/);
  assert.match(releaseRunbook, /NON_CHECK_RULES/);
  assert.match(releaseRunbook, /GitHub adds.*rule type/i);
  assert.match(releaseRunbook, /rerun the original merged-PR workflow/i);
  assert.match(releaseRunbook, /bypass rejection is intentional/i);
  assert.match(releaseRunbook, /merge.*normally/i);
  assert.match(releaseRunbook, /fine-grained personal access token/i);
  assert.match(releaseRunbook, /Administration.*read/i);
  assert.match(releaseRunbook, /Pull requests.*read/i);
  assert.doesNotMatch(releaseRunbook, /Commit\s+statuses\s*\(read-only\)/i);
  assert.match(releaseRunbook, /Metadata.*automatically/is);
  assert.doesNotMatch(releaseRunbook, /Checks\s*\(read/i);
  assert.match(releaseRunbook, /owner.*rotat|rotat.*owner/is);
  assert.match(releaseRunbook, /read-only capability check/i);
  assert.match(releaseRunbook, /must not merge/i);
  assert.doesNotMatch(guardSource, /\/commits\/\$\{sha\}\/status/);
});

test("credential health is weekly, manually runnable, read-only, and incapable of publishing", () => {
  assert.notEqual(healthWorkflowSource, "", "release-guard-health.yml must exist");
  const healthConfig = parse(healthWorkflowSource);
  assert.deepEqual(Object.keys(healthConfig.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.equal(healthConfig.on.schedule.length, 1);
  assert.match(healthConfig.on.schedule[0].cron, /^\d+ \d+ \* \* \d$/);
  const healthJob = healthConfig.jobs.health;
  assert.deepEqual(healthJob.permissions, { contents: "read" });
  const healthStep = healthJob.steps.find((step) => step.name === "Verify release guard health");
  assert.ok(healthStep);
  assert.equal(healthStep.env.RELEASE_GUARD_TOKEN, "${{ secrets.RELEASE_GUARD_TOKEN }}");
  assert.equal(healthStep.run.trim(), "node scripts/stable-release-guard.mjs --health");
  for (const step of healthJob.steps.filter((candidate) => candidate !== healthStep)) {
    assert.equal(step.env?.RELEASE_GUARD_TOKEN, undefined);
  }
  assert.equal(healthWorkflowSource.match(/secrets\.RELEASE_GUARD_TOKEN/g)?.length, 1);
  const commands = healthJob.steps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(commands, /npm\s+publish|git\s+tag|gh\s+release|publish-packages/i);
  assert.doesNotMatch(healthWorkflowSource, /id-token:\s*write|contents:\s*write/);
});

test("the workflow invokes one shared publisher and owns no package roster", () => {
  assert.ok(publishPackages);
  assert.equal(publishPackages.run.trim(), "node --import tsx scripts/publish-packages.ts");
  assert.doesNotMatch(workflow, /@hyperframes\//);
  assert.doesNotMatch(workflow, /publish_pkg|packages\/cli/);
});

test("stable release tag creation survives retries and rejects a mismatched commit", () => {
  const root = mkdtempSync(join(tmpdir(), "hyperframes-release-tag-test-"));
  const origin = join(root, "origin.git");
  const checkout = join(root, "checkout");

  try {
    execFileSync("git", ["init", "--bare", origin], { stdio: "pipe", timeout: 5_000 });
    execFileSync("git", ["init", checkout], { stdio: "pipe", timeout: 5_000 });
    git(checkout, "config", "user.name", "HyperFrames Test");
    git(checkout, "config", "user.email", "test@hyperframes.invalid");
    git(checkout, "commit", "--allow-empty", "-m", "release commit");
    git(checkout, "branch", "-M", "main");
    git(checkout, "remote", "add", "origin", origin);
    git(checkout, "push", "-u", "origin", "main");

    const releaseSha = git(checkout, "rev-parse", "HEAD");
    const firstRun = runCreateReleaseTag(checkout, "9.8.7");
    assert.equal(firstRun.status, 0, `${firstRun.stdout}\n${firstRun.stderr}`);
    assert.equal(git(checkout, "rev-parse", "refs/tags/v9.8.7^{commit}"), releaseSha);

    const retry = runCreateReleaseTag(checkout, "9.8.7");
    assert.equal(retry.status, 0, `${retry.stdout}\n${retry.stderr}`);
    assert.match(retry.stdout, /already exists at the expected commit/);

    git(checkout, "commit", "--allow-empty", "-m", "different commit");
    const mismatch = runCreateReleaseTag(checkout, "9.8.7");
    assert.equal(mismatch.status, 1, `${mismatch.stdout}\n${mismatch.stderr}`);
    assert.match(mismatch.stdout, /points to .* expected/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
