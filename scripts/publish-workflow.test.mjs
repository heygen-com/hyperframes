import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    env: { ...process.env, VERSION: version, GITHUB_TOKEN: "test-token" },
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
      ': "${GITHUB_TOKEN:?}"',
      'BASIC_AUTH="$(printf \'x-access-token:%s\' "$GITHUB_TOKEN" | base64 -w0)"',
      'echo "::add-mask::$BASIC_AUTH"',
      "export GIT_CONFIG_COUNT=1",
      'export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"',
      'export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $BASIC_AUTH"',
      "",
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
    const pushAuth = join(root, "push-auth");
    writeFileSync(
      join(checkout, ".git", "hooks", "pre-push"),
      `#!/bin/sh\ngit config --get http.https://github.com/.extraheader > "${pushAuth}"\n`,
    );
    chmodSync(join(checkout, ".git", "hooks", "pre-push"), 0o755);

    const releaseSha = git(checkout, "rev-parse", "HEAD");
    const firstRun = runCreateReleaseTag(checkout, "9.8.7");
    assert.equal(firstRun.status, 0, `${firstRun.stdout}\n${firstRun.stderr}`);
    assert.equal(git(checkout, "rev-parse", "refs/tags/v9.8.7^{commit}"), releaseSha);
    const basicAuth = Buffer.from("x-access-token:test-token").toString("base64");
    assert.equal(readFileSync(pushAuth, "utf8").trim(), `AUTHORIZATION: basic ${basicAuth}`);
    assert.match(firstRun.stdout, new RegExp(`::add-mask::${basicAuth}`));
    assert.equal(
      spawnSync("git", ["config", "--get-regexp", "extraheader"], { cwd: checkout }).status,
      1,
      "the tag step must not write the token into .git/config",
    );

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

test("the publish checkout keeps no token and only the tag push gets one for git", () => {
  assert.equal(checkout.with["persist-credentials"], false);
  assert.ok(!JSON.stringify(publish.env ?? {}).includes("secrets."));
  assert.equal(createReleaseTag.env.GITHUB_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  for (const step of publish.steps) {
    for (const [name, value] of Object.entries(step.env ?? {})) {
      if (!String(value).includes("secrets.GITHUB_TOKEN")) continue;
      const allowed = step === createReleaseTag ? "GITHUB_TOKEN" : "GH_TOKEN";
      assert.equal(name, allowed, `${step.name ?? step.uses} passes the token as ${name}`);
    }
  }
});

test("the Lambda handler zip is built apart from the release credentials", () => {
  const build = config.jobs["lambda-handler-zip"];
  assert.deepEqual(build.permissions, { contents: "read" });
  assert.equal(build.environment, undefined);
  assert.doesNotMatch(JSON.stringify(build), /secrets\./);
  const buildCheckout = build.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(buildCheckout.with["persist-credentials"], false);
  assert.ok(publish.needs.includes("lambda-handler-zip"));
});

test("the Lambda handler zip is pinned and attached to the release before npm publish", () => {
  const names = publish.steps.map((step) => step.name);
  const at = (name) => {
    assert.ok(names.includes(name), `missing step ${name}`);
    return names.indexOf(name);
  };
  assert.ok(at("Pin Lambda handler zip") < at("Create GitHub Release"));
  assert.ok(at("Create GitHub Release") < at("Attach Lambda handler zip to release"));
  assert.ok(at("Attach Lambda handler zip to release") < at("Publish packages"));
  const attach = publish.steps[at("Attach Lambda handler zip to release")];
  assert.equal(attach.if, "steps.lambda_zip.outputs.attached != 'true'");
  assert.doesNotMatch(attach.run, /--clobber/);
});

test("the pin step reuses an attached zip and otherwise takes only the built zip's hash", () => {
  const step = publish.steps.find((s) => s.name === "Pin Lambda handler zip");
  const builtZip = "built handler zip";
  const builtSha256 = createHash("sha256").update(builtZip).digest("hex");
  const run = ({ ghExit, expectedSha256 }) => {
    const root = mkdtempSync(join(tmpdir(), "hyperframes-lambda-zip-step-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      mkdirSync(join(root, "dist", "lambda-handler-build"), { recursive: true });
      writeFileSync(join(root, "dist", "lambda-handler-build", "handler.zip"), builtZip);
      const log = join(root, "calls.log");
      writeFileSync(log, "");
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
          EXPECTED_SHA256: expectedSha256,
        },
        timeout: 5_000,
      });
      let pinned = null;
      try {
        pinned = readFileSync(join(root, "dist", "hyperframes-lambda-handler.zip"), "utf8");
      } catch {}
      return {
        status: result.status,
        stdout: result.stdout,
        calls: readFileSync(log, "utf8"),
        output: readFileSync(output, "utf8"),
        pinned,
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const retried = run({ ghExit: 0, expectedSha256: builtSha256 });
  assert.equal(retried.status, 0, retried.stdout);
  assert.match(
    retried.calls,
    /^gh release download v9\.8\.7 --repo o\/r --pattern hyperframes-lambda-handler\.zip --dir dist$/m,
  );
  assert.match(retried.calls, /^bun packages\/aws-lambda\/scripts\/pin-handler-zip\.ts$/m);
  assert.equal(retried.output, "attached=true\n");

  const fresh = run({ ghExit: 1, expectedSha256: builtSha256 });
  assert.equal(fresh.status, 0, fresh.stdout);
  assert.doesNotMatch(fresh.calls, /build:zip/);
  assert.match(fresh.calls, /^bun packages\/aws-lambda\/scripts\/pin-handler-zip\.ts$/m);
  assert.equal(fresh.output, "");
  assert.equal(fresh.pinned, builtZip);

  for (const expectedSha256 of ["0".repeat(64), ""]) {
    const rejected = run({ ghExit: 1, expectedSha256 });
    assert.equal(rejected.status, 1, rejected.stdout);
    assert.match(rejected.stdout, /::error::Lambda handler zip sha256/);
    assert.doesNotMatch(rejected.calls, /pin-handler-zip/);
    assert.equal(rejected.pinned, null);
  }
});
