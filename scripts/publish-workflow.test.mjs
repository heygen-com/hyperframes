import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
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

test("the Lambda handler zip is pinned and attached to the release before npm publish", () => {
  const names = publish.steps.map((step) => step.name);
  const at = (name) => {
    assert.ok(names.includes(name), `missing step ${name}`);
    return names.indexOf(name);
  };
  assert.ok(at("Build Lambda handler zip") < at("Create GitHub Release"));
  assert.ok(at("Create GitHub Release") < at("Attach Lambda handler zip to release"));
  assert.ok(at("Attach Lambda handler zip to release") < at("Publish packages"));
  const attach = publish.steps[at("Attach Lambda handler zip to release")];
  assert.equal(attach.if, "steps.lambda_zip.outputs.attached != 'true'");
  assert.doesNotMatch(attach.run, /--clobber/);
});

test("a retried release reuses the attached handler zip instead of building a new one", () => {
  const step = publish.steps.find((s) => s.name === "Build Lambda handler zip");
  const run = (ghExit) => {
    const root = mkdtempSync(join(tmpdir(), "hyperframes-lambda-zip-step-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const log = join(root, "calls.log");
      for (const [name, exit] of [
        ["gh", ghExit],
        ["bun", 0],
      ]) {
        writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${exit}\n`);
        chmodSync(join(bin, name), 0o755);
      }
      const output = join(root, "github-output");
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
          VERSION: "9.8.7",
          REPO: "o/r",
        },
        timeout: 5_000,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return { calls: readFileSync(log, "utf8"), output: readFileSync(output, "utf8") };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const retried = run(0);
  assert.match(
    retried.calls,
    /^gh release download v9\.8\.7 --repo o\/r --pattern hyperframes-lambda-handler\.zip --dir dist$/m,
  );
  assert.doesNotMatch(retried.calls, /build:zip/);
  assert.match(retried.calls, /^bun packages\/aws-lambda\/scripts\/pin-handler-zip\.ts$/m);
  assert.equal(retried.output, "attached=true\n");

  const fresh = run(1);
  assert.match(fresh.calls, /^bun run --cwd packages\/aws-lambda build:zip$/m);
  assert.match(fresh.calls, /^bun packages\/aws-lambda\/scripts\/pin-handler-zip\.ts$/m);
  assert.equal(fresh.output, "");
});
