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
const pack = config.jobs.pack;
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
  assert.ok(pack.needs.includes("lambda-handler-zip"));
});

test("the Lambda handler zip is pinned before packing and attached before npm publish", () => {
  const indexIn = (job, name) => {
    const at = job.steps.findIndex((step) => step.name === name);
    assert.ok(at >= 0, `missing step ${name}`);
    return at;
  };
  assert.ok(indexIn(pack, "Pin Lambda handler zip") < indexIn(pack, "Pack packages"));
  assert.ok(
    indexIn(publish, "Create GitHub Release") <
      indexIn(publish, "Attach Lambda handler zip to release"),
  );
  assert.ok(
    indexIn(publish, "Attach Lambda handler zip to release") < indexIn(publish, "Publish packages"),
  );
  const attach = publish.steps[indexIn(publish, "Attach Lambda handler zip to release")];
  assert.doesNotMatch(attach.run, /--clobber/);
});

test("the pin step reuses an attached zip and otherwise takes only the built zip's hash", () => {
  const step = pack.steps.find((s) => s.name === "Pin Lambda handler zip");
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

const stepOf = (job, name) => {
  const step = job.steps.find((s) => s.name === name);
  assert.ok(step, `missing step ${name}`);
  return step;
};

function runStep(step, { cwd, env = {}, path = process.env.PATH }) {
  return spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: path, NPM_PACKAGES: config.env.NPM_PACKAGES, ...env },
    timeout: 10_000,
  });
}

function packTarball(dir, file, manifest) {
  const staging = mkdtempSync(join(tmpdir(), "hyperframes-pack-fixture-"));
  try {
    mkdirSync(join(staging, "package"));
    writeFileSync(join(staging, "package", "package.json"), JSON.stringify(manifest));
    execFileSync("tar", ["-czf", join(dir, file), "-C", staging, "package"], { stdio: "pipe" });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

test("the workflow publishes exactly the public workspace packages", () => {
  const root = new URL("../packages/", import.meta.url);
  const publishable = execFileSync("git", ["ls-files", "packages/*/package.json"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((path) => JSON.parse(readFileSync(new URL(path.replace(/^packages\//, ""), root), "utf8")))
    .filter((pkg) => pkg.private !== true)
    .map((pkg) => (pkg.name === "@hyperframes/cli" ? "hyperframes" : pkg.name));
  assert.deepEqual(config.env.NPM_PACKAGES.split(/\s+/).sort(), publishable.sort());
});

test("release-commit code runs only in a job without secrets", () => {
  assert.deepEqual(pack.permissions, { contents: "read" });
  assert.equal(pack.environment, undefined);
  const packCheckout = pack.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(packCheckout.with["persist-credentials"], false);
  for (const step of pack.steps) {
    for (const [name, value] of Object.entries(step.env ?? {})) {
      if (!String(value).includes("secrets.")) continue;
      assert.equal(value, "${{ secrets.GITHUB_TOKEN }}", `${step.name} passes ${name}`);
      assert.equal(name, "GH_TOKEN");
    }
  }
  assert.deepEqual(publish.needs, ["pack"]);
});

test("the publish job runs no code from the release commit", () => {
  for (const step of publish.steps) {
    assert.doesNotMatch(step.uses ?? "", /setup-bun|^\.\//, `${step.uses} in the publish job`);
    const run = step.run ?? "";
    assert.doesNotMatch(run, /\b(bun|bunx|pnpm|corepack|yarn|npx)\b/, step.name);
    assert.doesNotMatch(run, /\bnode\s/, step.name);
    assert.doesNotMatch(run, /\bnpm (install|ci|run|exec|pack|rebuild)\b/, step.name);
    for (const line of run.split("\n").filter((l) => /\bnpm publish\b/.test(l))) {
      assert.match(line, /--ignore-scripts/, step.name);
    }
  }
  const job = JSON.stringify(publish);
  assert.equal(job.split("secrets.NPM_TOKEN").length - 1, 1);
  const publishPackages = stepOf(publish, "Publish packages");
  assert.equal(publishPackages.env.NODE_AUTH_TOKEN, "${{ secrets.NPM_TOKEN }}");
  assert.equal(publishPackages["working-directory"], "${{ runner.temp }}");
});

test("the publish job checks the release channel without repo scripts", () => {
  const step = stepOf(publish, "Check release channel");
  const check = (EVENT_NAME, VERSION, PRERELEASE) =>
    runStep(step, { cwd: tmpdir(), env: { EVENT_NAME, VERSION, PRERELEASE } }).status;
  assert.equal(check("push", "0.9.55-alpha.1", "true"), 0);
  assert.equal(check("pull_request", "0.9.55", "false"), 0);
  assert.equal(check("push", "0.9.55", "false"), 1);
  assert.equal(check("pull_request", "0.9.55-alpha.1", "true"), 1);
  assert.equal(check("push", "0.9.55-alpha.1;id", "true"), 1);
});

test("the publish job takes only tarballs whose name and version match the release", () => {
  const step = stepOf(publish, "Check packed tarballs");
  const names = config.env.NPM_PACKAGES.split(/\s+/);
  const run = (version, mutate = (entries) => entries) => {
    const temp = mkdtempSync(join(tmpdir(), "hyperframes-publish-check-"));
    try {
      const dir = join(temp, "release-bundle", "npm");
      mkdirSync(dir, { recursive: true });
      for (const [file, manifest] of mutate(
        names.map((name) => [
          `${name.replace(/^@/, "").replace("/", "-")}-1.2.3-alpha.1.tgz`,
          { name, version: "1.2.3-alpha.1" },
        ]),
      )) {
        packTarball(dir, file, manifest);
      }
      const result = runStep(step, { cwd: temp, env: { RUNNER_TEMP: temp, VERSION: version } });
      let order = "";
      try {
        order = readFileSync(join(temp, "publish-order.tsv"), "utf8");
      } catch {}
      return { ...result, order };
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  };

  const ok = run("1.2.3-alpha.1");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(
    ok.order
      .trim()
      .split("\n")
      .map((line) => line.split("\t")[0]),
    names,
  );

  const stable = run("1.2.3-alpha.1", (entries) => [
    ...entries.slice(1),
    [entries[0][0], { ...entries[0][1], version: "1.2.3" }],
  ]);
  assert.equal(stable.status, 1);
  assert.match(
    stable.stdout,
    /packs @hyperframes\/share@1\.2\.3, but this release is 1\.2\.3-alpha\.1/,
  );

  const missing = run("1.2.3-alpha.1", (entries) => entries.slice(1));
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /No packed tarball for @hyperframes\/share/);

  const extra = run("1.2.3-alpha.1", (entries) => [
    ...entries,
    ["other-1.2.3-alpha.1.tgz", { name: "@hyperframes/other", version: "1.2.3-alpha.1" }],
  ]);
  assert.equal(extra.status, 1);
  assert.match(extra.stdout, /does not publish: @hyperframes\/other/);

  const twice = run("1.2.3-alpha.1", (entries) => [
    ...entries,
    ["again-1.2.3-alpha.1.tgz", entries[0][1]],
  ]);
  assert.equal(twice.status, 1);
  assert.match(twice.stdout, /Packed more than once: @hyperframes\/share/);
});

test("publishing skips only identical uploads and fails on a version it did not publish", () => {
  const step = stepOf(publish, "Publish packages");
  const run = ({ viewResult, attempt }) => {
    const temp = mkdtempSync(join(tmpdir(), "hyperframes-publish-step-"));
    try {
      const bin = join(temp, "bin");
      mkdirSync(bin);
      const log = join(temp, "npm.log");
      writeFileSync(log, "");
      writeFileSync(
        join(bin, "npm"),
        `#!/bin/sh\necho "npm $*" >> "${log}"\nif [ "$1" = view ]; then [ -n "$VIEW_RESULT" ] || exit 1; echo "$VIEW_RESULT"; fi\n`,
      );
      chmodSync(join(bin, "npm"), 0o755);
      packTarball(temp, "core.tgz", { name: "@hyperframes/core", version: "1.2.3-alpha.1" });
      writeFileSync(
        join(temp, "publish-order.tsv"),
        `@hyperframes/core\t${join(temp, "core.tgz")}\nhyperframes\t${join(temp, "core.tgz")}\n`,
      );
      const integrity = `sha512-${createHash("sha512")
        .update(readFileSync(join(temp, "core.tgz")))
        .digest("base64")}`;
      const result = runStep(step, {
        cwd: temp,
        path: `${bin}:${process.env.PATH}`,
        env: {
          VERSION: "1.2.3-alpha.1",
          DIST_TAG: "alpha",
          RUN_ATTEMPT: String(attempt),
          NODE_AUTH_TOKEN: "test-token",
          VIEW_RESULT: viewResult === "same" ? integrity : viewResult,
        },
      });
      return { ...result, calls: readFileSync(log, "utf8") };
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  };

  const fresh = run({ viewResult: "", attempt: 1 });
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  const publishes = fresh.calls.split("\n").filter((line) => line.startsWith("npm publish"));
  assert.equal(publishes.length, 2);
  for (const line of publishes) {
    assert.match(line, /core\.tgz --access public --tag alpha --ignore-scripts$/);
  }

  const identical = run({ viewResult: "same", attempt: 1 });
  assert.equal(identical.status, 0, identical.stdout);
  assert.doesNotMatch(identical.calls, /npm publish/);

  const squatted = run({ viewResult: "sha512-other", attempt: 1 });
  assert.equal(squatted.status, 1);
  assert.match(squatted.stdout, /this run did not publish it/);
  assert.doesNotMatch(squatted.calls, /npm publish/);

  const rerun = run({ viewResult: "sha512-other", attempt: 2 });
  assert.equal(rerun.status, 0, rerun.stdout);
  assert.match(rerun.stdout, /::warning::/);
  assert.doesNotMatch(rerun.calls, /npm publish/);
});

test("every publish runs in the approval-gated npm-publish environment", () => {
  assert.equal(publish.environment, "npm-publish");
  const jobsWithEnvironment = Object.entries(config.jobs).filter(([, job]) => job.environment);
  assert.deepEqual(
    jobsWithEnvironment.map(([name]) => name),
    ["publish"],
  );
});

const pin = readFileSync(
  new URL("../packages/aws-lambda/hf-media-linux-aarch64.sha256", import.meta.url),
  "utf8",
);
const digestCheck = (steps) =>
  steps.findIndex((step) => step.name === "Check the tarball against its committed digest");

test("the Lambda ffmpeg ships only when it matches its committed digest", () => {
  assert.match(pin, /^[0-9a-f]{64} {2}hf-media-linux-aarch64\.tar\.gz\n$/);
  const steps = config.jobs["lambda-arm64-ffmpeg"].steps;
  const at = digestCheck(steps);
  const upload = steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.ok(
    at > 0 && at < upload,
    "the check runs after the cache or the build, before the upload",
  );
  assert.equal(steps[at].if, undefined, "a cache hit and a fresh build are both checked");
  assert.match(
    steps[at].run,
    /sha256sum --strict -c \.\.\/packages\/aws-lambda\/hf-media-linux-aarch64\.sha256$/,
  );

  const image = parse(
    readFileSync(new URL("../.github/workflows/lambda-arm64-image.yml", import.meta.url), "utf8"),
  );
  assert.ok(
    digestCheck(image.jobs.ffmpeg.steps) > 0,
    "a pull request that changes the build must update the digest",
  );
  assert.ok(
    image.on.pull_request.paths.includes("packages/aws-lambda/hf-media-linux-aarch64.sha256"),
  );
});

test("the release installs no tool restored from the shared cache", () => {
  const steps = Object.values(config.jobs).flatMap((job) => job.steps ?? []);
  const bun = steps.filter((step) => step.uses?.startsWith("oven-sh/setup-bun@"));
  assert.ok(bun.length >= 1);
  assert.equal(bun.filter((step) => step.with?.["no-cache"] !== true).length, 0);
  assert.equal(
    steps.filter((step) => step.uses?.startsWith("actions/setup-node@") && step.with?.cache).length,
    0,
  );
});
