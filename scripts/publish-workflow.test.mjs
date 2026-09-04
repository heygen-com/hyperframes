import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const config = parse(workflow);
const publish = config.jobs.publish;
const checkout = publish.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
const checkoutGuard = publish.steps.find(
  (step) => step.name === "Verify immutable release checkout",
);
const createReleaseTag = publish.steps.find((step) => step.name === "Create release tag");

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

test("the release build orders generated artifacts before their consumers", () => {
  const packagesByStage = rootPackage.scripts.build.split(/\s*&&\s*/).map((stage) => {
    const filter = stage.match(/@hyperframes\/(?:\{([^}]+)\}|([a-z0-9-]+))/);
    const packages = filter?.[1]?.split(",") ?? [filter?.[2]].filter(Boolean);
    return new Set(packages);
  });
  const firstStageWith = (packageName) =>
    packagesByStage.findIndex((packages) => packages.has(packageName));

  const coreIndex = firstStageWith("core");
  const producerIndex = firstStageWith("producer");
  const cloudRunIndex = firstStageWith("gcp-cloud-run");

  assert.notEqual(coreIndex, -1, "root build must include Core");
  assert.notEqual(producerIndex, -1, "root build must include Producer");
  assert.notEqual(cloudRunIndex, -1, "root build must include GCP Cloud Run");
  assert.ok(
    packagesByStage.slice(coreIndex + 1).every((packages) => !packages.has("core")),
    "Core rewrites generated source and must not rebuild in a later parallel group",
  );
  assert.ok(
    producerIndex < cloudRunIndex,
    "Producer declaration emit must finish before GCP Cloud Run consumes it",
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
