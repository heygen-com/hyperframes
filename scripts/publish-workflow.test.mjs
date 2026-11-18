import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
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
  // fails without the fix: a merged release PR's event ran as refs/pull/N/merge, a ref the publish environment refuses.
  assert.deepEqual(config.on, { push: { branches: ["main"], tags: ["v*-*"] } });
  for (const name of [
    "lambda-arm64-ffmpeg",
    "lambda-handler-zip",
    "lambda-video-image",
    "pack",
    "publish",
  ]) {
    const job = config.jobs[name];
    assert.ok(job.needs.includes("release-source"), `${name} needs release-source`);
    assert.equal(normalizeExpression(job.if), "needs.release-source.outputs.sha != ''", name);
    assert.equal(job.env.EXPECTED_RELEASE_SHA, "${{ needs.release-source.outputs.sha }}", name);
  }
  assert.equal(checkout.with.ref, "${{ env.EXPECTED_RELEASE_SHA }}");
});

test("a release run waits behind another run of the same release, never behind main", () => {
  // A ref-wide group on main lets any later push cancel a release run that is still pending.
  assert.equal(config.concurrency, undefined);
  assert.deepEqual(publish.concurrency, {
    group: "publish-${{ needs.release-source.outputs.version }}",
    "cancel-in-progress": false,
  });
});

test("a push to main publishes only the merge of exactly one approved release PR from this repo", () => {
  const step = stepOf(config.jobs["release-source"], "Find the release this push publishes");
  const bin = mkdtempSync(join(tmpdir(), "hyperframes-fake-gh-"));
  const sha = "a".repeat(40);
  const head = "c".repeat(40);
  const pull = (overrides = {}) => ({
    number: 8000,
    user: { login: "releaser", type: "User" },
    merged_at: "2026-11-17T02:24:00Z",
    merge_commit_sha: sha,
    base: { ref: "main" },
    head: { ref: "release/v0.9.61", sha: head, repo: { full_name: "heygen-com/hyperframes" } },
    ...overrides,
  });
  const review = (login, state, hour, commit = head, type = "User") => ({
    user: { login, type },
    state,
    commit_id: commit,
    submitted_at: `2026-11-17T0${hour}:00:00Z`,
  });
  const approved = [review("reviewer", "APPROVED", 1)];
  // The fake answers PR 8000, its reviews, commits and events, the branch's activity, the push from FAKE_COMPARE,
  // each commit's PR lookup from FAKE_PULLS_<sha>, and each login's permission from FAKE_PERMISSIONS (login=permission
  // lines); the lookup of FAKE_PERMISSION_FAILS fails.
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
case "$*" in
  *pulls/8000/reviews*) printf '%s' "$FAKE_REVIEWS" ;;
  *pulls/8000/commits*) printf '%s' "$FAKE_COMMITS" ;;
  *issues/8000/events*) printf '%s' "$FAKE_EVENTS" ;;
  *pulls/8000) printf '%s' "$FAKE_PULL" ;;
  *activity\\?ref=refs/heads/release/v0.9.61\\&*) printf '%s' "$FAKE_ACTIVITY" ;;
  *compare/*) printf '%s' "$FAKE_COMPARE" ;;
  *commits/*/pulls*)
    c="$(printf '%s' "$*" | sed 's#.*commits/\\([0-9a-f]*\\)/pulls.*#\\1#')"
    eval "v=\\\${FAKE_PULLS_$c-}"
    printf '%s' "\${v:-[]}" ;;
  *collaborators/*/permission*)
    login="$(printf '%s' "$*" | sed 's#.*collaborators/\\([^/]*\\)/permission.*#\\1#')"
    [ "$login" != "$FAKE_PERMISSION_FAILS" ] || exit 1
    printf '%s\\n' "$FAKE_PERMISSIONS" | sed -n "s/^$login=//p" ;;
  *) printf '%s' "$FAKE_PULLS" ;;
esac
`,
  );
  const commit = (author, committer = author) => ({
    author: { login: author },
    committer: { login: committer },
  });
  const permissions = "releaser=admin\nreviewer=write\nother=admin\noutsider=read\nhelper=read";
  const pushBy = (login, type = "User", activity_type = "push") => ({
    activity_type,
    actor: { login, type },
  });
  chmodSync(join(bin, "gh"), 0o755);
  const main = { REF_TYPE: "branch", REF_NAME: "main" };
  /** A push of `commits` (oldest first, each `{ sha, message, pulls }`) whose last commit is the run's sha. */
  const push = (commits, total = commits.length) => ({
    FAKE_COMPARE: JSON.stringify({
      total_commits: total,
      commits: commits.map(({ sha: c, message }) => ({ sha: c, commit: { message } })),
    }),
    ...Object.fromEntries(
      commits.map(({ sha: c, pulls }) => [`FAKE_PULLS_${c}`, JSON.stringify(pulls)]),
    ),
  });
  /** A release PR's history: one commit and one push by its opener, unless `history` says otherwise. */
  const historyOf = (pulls, ref, history) => ({
    commits: [commit("releaser", "web-flow")],
    push: [{ sha, message: ref.HEAD_MESSAGE ?? "fix: a change", pulls }],
    before: "e".repeat(40),
    activity: [pushBy("releaser", "User", "branch_creation"), pushBy("releaser")],
    events: [],
    permissions,
    permissionFails: "",
    ...history,
  });
  const run = (pulls, ref = main, reviews = approved, given = {}) => {
    const history = historyOf(pulls, ref, given);
    const out = join(bin, "out");
    writeFileSync(out, "");
    const result = runStep(step, {
      cwd: bin,
      env: {
        REPO: "heygen-com/hyperframes",
        SHA: sha,
        RUNNER_TEMP: bin,
        GITHUB_OUTPUT: out,
        BEFORE: history.before,
        ...push(history.push, history.total),
        FAKE_REVIEWS: JSON.stringify(reviews),
        FAKE_COMMITS: JSON.stringify(history.commits),
        FAKE_PULL: JSON.stringify({ commits: history.listed ?? history.commits.length }),
        FAKE_ACTIVITY: JSON.stringify(history.activity),
        FAKE_EVENTS: JSON.stringify(history.events),
        FAKE_PERMISSIONS: history.permissions,
        FAKE_PERMISSION_FAILS: history.permissionFails,
        ...ref,
      },
      path: `${bin}:${process.env.PATH}`,
    });
    const outputs = Object.fromEntries(
      readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    return { status: result.status, outputs };
  };
  try {
    assert.deepEqual(run([pull()]), {
      status: 0,
      outputs: { sha, version: "0.9.61", source: "release-pr", ref: "release/v0.9.61" },
    });
    for (const [why, pulls] of [
      ["no PR", []],
      ["not merged", [pull({ merged_at: null })]],
      ["another commit of the PR", [pull({ merge_commit_sha: "b".repeat(40) })]],
      ["not into main", [pull({ base: { ref: "next" } })]],
      [
        "from a fork",
        [pull({ head: { ref: "release/v0.9.61", repo: { full_name: "x/hyperframes" } } })],
      ],
      ["a deleted fork", [pull({ head: { ref: "release/v0.9.61", repo: null } })]],
      [
        "not a release branch",
        [pull({ head: { ref: "fix/x", repo: { full_name: "heygen-com/hyperframes" } } })],
      ],
      [
        "a prerelease branch",
        [
          pull({
            head: { ref: "release/v0.9.61-alpha.1", repo: { full_name: "heygen-com/hyperframes" } },
          }),
        ],
      ],
    ]) {
      assert.deepEqual(run(pulls), { status: 0, outputs: {} }, why);
    }
    const releaseSubject = {
      REF_TYPE: "branch",
      REF_NAME: "main",
      HEAD_MESSAGE: "chore: release v0.9.61 (#8000)\n\nnotes",
    };
    assert.equal(
      run([], releaseSubject).status,
      1,
      "a release commit whose PR is not listed yet fails, never skips",
    );
    assert.equal(
      run([], { ...releaseSubject, HEAD_MESSAGE: "fix: name chore: release v1 in the docs" })
        .status,
      0,
      "only the subject's start counts",
    );
    for (const [why, reviews] of [
      ["no review", []],
      ["only the author approved", [review("releaser", "APPROVED", 1)]],
      ["an earlier commit was approved", [review("reviewer", "APPROVED", 1, "d".repeat(40))]],
      ["a comment is not an approval", [review("reviewer", "COMMENTED", 1)]],
      ["a dismissed approval", [review("reviewer", "DISMISSED", 1)]],
      ["an app's approval", [review("review-app[bot]", "APPROVED", 1, head, "Bot")]],
      [
        "an app's change request stands",
        [...approved, review("review-app[bot]", "CHANGES_REQUESTED", 2, head, "Bot")],
      ],
      [
        "another reviewer's change request stands",
        [...approved, review("other", "CHANGES_REQUESTED", 2)],
      ],
      [
        "the approver later asked for changes",
        [...approved, review("reviewer", "CHANGES_REQUESTED", 2)],
      ],
    ]) {
      assert.equal(run([pull()], main, reviews).status, 1, why);
    }
    // Anyone can review a public repo: only a reviewer with write access counts, either way.
    assert.equal(
      run([pull()], main, [review("outsider", "APPROVED", 1)]).status,
      1,
      "an approval from an account without write access",
    );
    assert.equal(
      run([pull()], main, [...approved, review("outsider", "CHANGES_REQUESTED", 2)]).status,
      0,
      "a change request from an account without write access blocks nothing",
    );
    const outsiderObjects = [...approved, review("outsider", "CHANGES_REQUESTED", 2)];
    assert.equal(
      run([pull()], main, outsiderObjects, { permissionFails: "outsider" }).status,
      1,
      "a permission that cannot be read refuses the release, even for a review that would not count",
    );
    assert.equal(
      run([pull()], main, [...approved, review("outsider", "COMMENTED", 2)], {
        permissionFails: "outsider",
      }).status,
      0,
      "a reviewer who only commented is not looked up",
    );
    for (const [why, history] of [
      ["the approver wrote the approved commit", { commits: [commit("reviewer", "web-flow")] }],
      ["the approver committed it", { commits: [commit("releaser", "reviewer")] }],
      [
        "the approver force-pushed the branch",
        { events: [{ event: "head_ref_force_pushed", actor: { login: "reviewer" } }] },
      ],
      [
        "the approver pushed commits written under another name",
        { activity: [pushBy("releaser", "User", "branch_creation"), pushBy("reviewer")] },
      ],
      [
        "the approver pushed commits with no account behind them",
        {
          commits: [{ author: null, committer: null }],
          activity: [pushBy("releaser", "User", "branch_creation"), pushBy("reviewer")],
        },
      ],
      [
        "the approver created the branch",
        { activity: [pushBy("reviewer", "User", "branch_creation")] },
      ],
      ["more commits than GitHub lists", { listed: 251 }],
      ["no push to the branch was recorded", { activity: [] }],
      [
        "a push with no recorded account",
        {
          activity: [
            pushBy("releaser", "User", "branch_creation"),
            { activity_type: "push", actor: null },
          ],
        },
      ],
    ]) {
      assert.equal(run([pull()], main, approved, history).status, 1, why);
    }
    // A second person with write access opened or pushed the release, besides the approver.
    const openedBy = (login, type = "User") => pull({ user: { login, type } });
    for (const [why, pulls, history] of [
      [
        "an opener without write access who pushed",
        [openedBy("helper")],
        { activity: [pushBy("helper")] },
      ],
      [
        "an app opened and pushed it",
        [openedBy("release-app[bot]", "Bot")],
        { activity: [pushBy("release-app[bot]", "Bot")] },
      ],
      [
        "an opener without write access and only an app's push",
        [openedBy("helper")],
        { activity: [pushBy("ci[bot]", "Bot")] },
      ],
    ]) {
      assert.equal(run(pulls, main, approved, history).status, 1, why);
    }
    assert.equal(
      run([openedBy("helper")], main, approved, { activity: [pushBy("releaser")] }).status,
      0,
      "a maintainer's push is the second person when the opener has no write access",
    );
    // An approval counts only if the base was main when it was given and has not changed since.
    const rebased = { events: [{ event: "base_ref_changed", created_at: "2026-11-17T03:00:00Z" }] };
    assert.equal(
      run([pull()], main, approved, rebased).status,
      1,
      "an approval given before the base changed to main",
    );
    assert.equal(
      run([pull()], main, [review("reviewer", "APPROVED", 4)], rebased).status,
      0,
      "an approval given after the last base change",
    );
    const reapproved = [
      review("reviewer", "CHANGES_REQUESTED", 1),
      review("reviewer", "APPROVED", 2),
    ];
    assert.equal(
      run([pull()], main, reapproved).status,
      0,
      "a later approval answers its own change request",
    );
    // The merge queue can land the release with other PRs in one push; the run is for the push's last commit.
    const release = "f".repeat(40);
    const batched = (releasePulls, total) => ({
      push: [
        { sha: release, message: "chore: release v0.9.61 (#8000)", pulls: releasePulls },
        { sha, message: "fix: a server change (#8001)", pulls: [] },
      ],
      total,
    });
    assert.deepEqual(run([], main, approved, batched([pull({ merge_commit_sha: release })])), {
      status: 0,
      outputs: { sha: release, version: "0.9.61", source: "release-pr", ref: "release/v0.9.61" },
    });
    assert.equal(
      run([], main, approved, batched([])).status,
      1,
      "a release commit below the tip that GitHub has not linked yet fails, never skips",
    );
    assert.equal(
      run([], main, approved, batched([pull({ merge_commit_sha: release })], 300)).status,
      1,
      "a push with more commits than GitHub lists",
    );
    assert.deepEqual(
      run([pull()], main, approved, { before: "0".repeat(40) }).outputs.sha,
      sha,
      "a push that created the branch reads only its last commit",
    );
    const second = pull({
      head: { ref: "release/v0.9.62", repo: { full_name: "heygen-com/hyperframes" } },
    });
    assert.equal(run([pull(), second]).status, 1, "two release PRs for one commit");
    assert.deepEqual(run([], { REF_TYPE: "tag", REF_NAME: "v0.9.61-alpha.1" }), {
      status: 0,
      outputs: { sha, version: "0.9.61-alpha.1", source: "tag", ref: "v0.9.61-alpha.1" },
    });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
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
  assert.equal(createReleaseTag.if, "needs.release-source.outputs.source == 'release-pr'");
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
    indexIn(publish, "Create GitHub Release") < indexIn(publish, "Attach Lambda assets to release"),
  );
  assert.ok(
    indexIn(publish, "Attach Lambda assets to release") < indexIn(publish, "Publish packages"),
  );
  const attach = publish.steps[indexIn(publish, "Attach Lambda assets to release")];
  assert.doesNotMatch(attach.run, /--clobber/);
});

test("packing pins only the freshly built zip and never downloads release assets", () => {
  const step = pack.steps.find((s) => s.name === "Pin Lambda handler zip");
  assert.match(step.run, /ACTUAL_SHA256.*sha256sum/);
  assert.match(step.run, /ACTUAL_SHA256.*!=.*EXPECTED_SHA256/);
  assert.doesNotMatch(workflow, /gh release download/);
  assert.equal(step.env.EXPECTED_SHA256, "${{ needs.lambda-handler-zip.outputs.sha256 }}");
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
  assert.deepEqual(pack.permissions, { contents: "read", actions: "read" });
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
  assert.deepEqual(publish.needs, ["release-source", "pack"]);
});

test("npm publishes with the job's OIDC token only: no stored npm token is named", () => {
  assert.doesNotMatch(JSON.stringify(config), /\bsecrets\b(?!\.GITHUB_TOKEN\b)/);
  assert.equal(publish.permissions["id-token"], "write");
  assert.equal(stepOf(publish, "Publish packages").env.NODE_AUTH_TOKEN, "");
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
  const publishPackages = stepOf(publish, "Publish packages");
  assert.equal(publishPackages["working-directory"], "${{ runner.temp }}");
});

test("the publish job checks the release channel without repo scripts", () => {
  const step = stepOf(publish, "Check release channel");
  const check = (SOURCE, VERSION, PRERELEASE, DIST_TAG = "alpha") =>
    runStep(step, { cwd: tmpdir(), env: { SOURCE, VERSION, PRERELEASE, DIST_TAG } }).status;
  assert.equal(check("tag", "0.9.55-alpha.1", "true"), 0);
  assert.equal(check("release-pr", "0.9.55", "false"), 0);
  assert.equal(check("tag", "0.9.55", "false"), 1);
  assert.equal(check("release-pr", "0.9.55-alpha.1", "true"), 1);
  assert.equal(check("tag", "0.9.55-alpha.1;id", "true"), 1);
  assert.equal(check("tag", "0.9.55-latest.1", "true", "latest"), 1);
  assert.equal(check("tag", "0.9.55-hdr.1", "true", "hdr"), 0);
  assert.equal(check("tag", "0.9.55-beta.1", "true", "beta"), 0);
  assert.equal(check("tag", "0.9.55-LATEST.1", "true", "LATEST"), 1);
  assert.equal(check("tag", "0.9.55-Latest.1", "true", "Latest"), 1);
  assert.equal(check("tag", "0.9.55-Alpha.1", "true", "Alpha"), 1);
  assert.equal(check("tag", "0.9.55-stable.1", "true", "stable"), 1);
  assert.equal(check("", "0.9.55", "false", "latest"), 1, "no release source");
});

test("the publish job takes only tarballs that npm reads the way the check does", () => {
  const step = stepOf(publish, "Check packed tarballs");
  const names = config.env.NPM_PACKAGES.split(/\s+/);
  const version = "1.2.3-alpha.1";
  // `build(staging)` lays out the first package's files and returns tar's arguments for them.
  const run = (build) => {
    const temp = mkdtempSync(join(tmpdir(), "hyperframes-publish-layout-"));
    try {
      const dir = join(temp, "release-bundle", "npm");
      mkdirSync(dir, { recursive: true });
      for (const name of names.slice(1)) {
        packTarball(dir, `${name.replace(/^@/, "").replace("/", "-")}.tgz`, { name, version });
      }
      const staging = mkdtempSync(join(tmpdir(), "hyperframes-publish-staging-"));
      try {
        const args = build(staging, { name: names[0], version });
        execFileSync("tar", ["-czf", join(dir, "first.tgz"), "-C", staging, ...args], {
          stdio: "pipe",
        });
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
      return runStep(step, { cwd: temp, env: { RUNNER_TEMP: temp, VERSION: version } });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  };
  const write = (staging, path, manifest) => {
    mkdirSync(join(staging, path, ".."), { recursive: true });
    writeFileSync(join(staging, path), JSON.stringify(manifest));
  };
  const plain = (publishConfig) => (staging, manifest) => {
    write(staging, "package/package.json", { ...manifest, publishConfig });
    return ["package"];
  };

  const ours = run(
    plain({
      access: "public",
      registry: "https://registry.npmjs.org/",
      exports: {},
      main: "x",
      types: "x",
    }),
  );
  assert.equal(ours.status, 0, ours.stdout + ours.stderr);

  const refused = {
    "a second top-level folder": (staging, manifest) => {
      write(staging, "package/package.json", manifest);
      write(staging, "other/package.json", { ...manifest, scripts: { x: "y" } });
      return ["package", "other"];
    },
    "a ./ prefix": (staging, manifest) => {
      write(staging, "package/package.json", manifest);
      return ["./package"];
    },
    "package.json twice": (staging, manifest) => {
      write(staging, "package/package.json", manifest);
      return ["package", "package/package.json"];
    },
    "a link": (staging, manifest) => {
      write(staging, "package/package.json", manifest);
      symlinkSync("/etc/hostname", join(staging, "package", "link"));
      return ["package"];
    },
    "a publishConfig tag": plain({ tag: "latest" }),
    "a publishConfig registry elsewhere": plain({ registry: "https://registry.example.com/" }),
    "restricted access": plain({ access: "restricted" }),
    "a publishConfig that is not an object": plain("latest"),
  };
  for (const [what, build] of Object.entries(refused)) {
    const result = run(build);
    assert.equal(result.status, 1, what);
    assert.match(
      result.stdout,
      /first\.tgz (must hold one package\/package\.json|has a publishConfig)/,
      what,
    );
  }
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
    assert.match(
      line,
      /core\.tgz --access public --tag alpha --registry https:\/\/registry\.npmjs\.org\/ --ignore-scripts$/,
    );
  }

  const identical = run({ viewResult: "same", attempt: 1 });
  assert.equal(identical.status, 0, identical.stdout);
  assert.doesNotMatch(identical.calls, /npm publish/);

  const squatted = run({ viewResult: "sha512-other", attempt: 1 });
  assert.equal(squatted.status, 1);
  assert.match(squatted.stdout, /this run did not publish it/);
  assert.doesNotMatch(squatted.calls, /npm publish/);

  const rerun = run({ viewResult: "sha512-other", attempt: 2 });
  assert.equal(rerun.status, 1, rerun.stdout);
  assert.match(rerun.stdout, /this run did not publish it/);
  assert.doesNotMatch(rerun.calls, /npm publish/);
});

test("every publish runs in npm-publish, the environment npm trusted publishing names", () => {
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

test("the Lambda video image builds on ARM, and pack ships only the digest that job built", () => {
  // fails without the fix: pack built the arm64 image on an x86 runner, which cannot run the video stage's microdnf.
  const image = config.jobs["lambda-video-image"];
  assert.equal(image["runs-on"], "ubuntu-24.04-arm");
  assert.deepEqual(image.permissions, { contents: "read" });
  const build = stepOf(image, "Build Lambda video image");
  assert.match(build.run, /--platform linux\/arm64 --target video/);
  assert.equal(build.env.EXPECTED_ZIP_SHA256, "${{ needs.lambda-handler-zip.outputs.sha256 }}");
  assert.equal(image.outputs.sha256, "${{ steps.image.outputs.sha256 }}");

  assert.ok(
    !pack.steps.some((step) => /docker buildx build/.test(step.run ?? "")),
    "pack builds no image",
  );
  const pin = stepOf(pack, "Pin Lambda video image");
  assert.equal(pin.env.EXPECTED_SHA256, "${{ needs.lambda-video-image.outputs.sha256 }}");
  assert.match(pin.run, /pin-handler-zip\.ts --video-image$/m);
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

/** Runs a "Find previous ..." step against a stand-in gh that lists `artifacts`; returns its exit and GITHUB_OUTPUT. */
function runFindPrevious(step, artifacts) {
  const dir = mkdtempSync(join(tmpdir(), "previous-artifact-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(dir, "pages.json"),
    JSON.stringify({ total_count: artifacts.length, artifacts }),
  );
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncat "${join(dir, "pages.json")}"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: output,
      REPO: "o/r",
      RUN_ID: "1",
    },
    timeout: 5_000,
  });
  const text = readFileSync(output, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, text };
}

for (const [job, name, artifact] of [
  ["pack", "Find previous release bundle", "release-bundle"],
  ["publish", "Find previous release receipt", "lambda-release-receipt"],
]) {
  test(`"${name}" hands the download step a bare artifact id, or nothing on a first attempt`, () => {
    const step = config.jobs[job].steps.find((one) => one.name === name);
    assert.deepEqual(runFindPrevious(step, []), { status: 0, text: "artifact=\n" });
    const found = [
      { id: 123, name: artifact, expired: false },
      { id: 9, name: "lambda-handler", expired: false },
    ];
    assert.deepEqual(runFindPrevious(step, found), { status: 0, text: "artifact=123\n" });
    assert.notEqual(runFindPrevious(step, [{ id: 1, name: artifact, expired: true }]).status, 0);
  });
}

// A tarball whose second entry GNU tar reads as package/d/package/package.json and npm's node-tar reads as
// package/package.json: ustar magic, version bytes other than "00", a non-empty prefix.
function packSplitReading(dir, file, checked, published) {
  const staging = mkdtempSync(join(tmpdir(), "hyperframes-split-fixture-"));
  try {
    mkdirSync(join(staging, "package"));
    writeFileSync(join(staging, "package", "package.json"), JSON.stringify(checked));
    writeFileSync(join(staging, "package", "x.json"), JSON.stringify(published));
    const tar = execFileSync("tar", [
      "--format=ustar",
      "-cf",
      "-",
      "-C",
      staging,
      "package/package.json",
      "package/x.json",
    ]);
    const header = 1024;
    tar.fill(0, header, header + 100);
    tar.write("package/package.json", header, "latin1");
    tar.fill(0, header + 345, header + 500);
    tar.write("package/d", header + 345, "latin1");
    tar.write("ustar\0", header + 257, "latin1");
    tar.fill(0, header + 263, header + 265);
    tar.fill(0x20, header + 148, header + 156);
    let sum = 0;
    for (let i = header; i < header + 512; i += 1) sum += tar[i];
    tar.write(`${sum.toString(8).padStart(6, "0")}\0 `, header + 148, "latin1");
    writeFileSync(join(dir, file), gzipSync(tar));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

test("npm publishes only what the check read: name, version and every file", () => {
  const step = stepOf(publish, "Check what npm will publish");
  const name = "@hyperframes/core";
  const version = "1.2.3-alpha.1";
  const run = (make, expected = name) => {
    const temp = mkdtempSync(join(tmpdir(), "hyperframes-npm-reads-"));
    try {
      make(temp, "core.tgz");
      writeFileSync(join(temp, "publish-order.tsv"), `${expected}\t${join(temp, "core.tgz")}\n`);
      return runStep(step, { cwd: temp, env: { VERSION: version, DIST_TAG: "alpha" } });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  };
  const clean = run((dir, file) => packTarball(dir, file, { name, version }));
  assert.equal(clean.status, 0, clean.stderr + clean.stdout);
  // fails without the fix: the layout check passed this tarball and npm would publish swapped-package@9.9.9.
  const split = run((dir, file) =>
    packSplitReading(dir, file, { name, version }, { name: "swapped-package", version: "9.9.9" }),
  );
  assert.equal(split.status, 1);
  assert.match(
    split.stdout,
    /npm (would publish core\.tgz as swapped-package@9\.9\.9|and tar read different files)/,
  );
  // Same name and version, other contents: only the file lists differ.
  const swapped = run((dir, file) =>
    packSplitReading(
      dir,
      file,
      { name, version },
      { name, version, scripts: { postinstall: "x" } },
    ),
  );
  assert.equal(swapped.status, 1);
  assert.match(swapped.stdout, /npm and tar read different files in core\.tgz/);
  const renamed = run((dir, file) =>
    packTarball(dir, file, { name: "@hyperframes/other", version }),
  );
  assert.equal(renamed.status, 1);
  assert.match(
    renamed.stdout,
    /would publish core\.tgz as @hyperframes\/other@1\.2\.3-alpha\.1, not @hyperframes\/core@1\.2\.3-alpha\.1/,
  );
});

const stepIndex = (job, name) => {
  const index = job.steps.findIndex((step) => step.name === name);
  assert.ok(index >= 0, `missing step ${name}`);
  return index;
};

test("both tarball checks pass before the release tag or anything else is written", () => {
  const tag = stepIndex(publish, "Create release tag");
  assert.ok(stepIndex(publish, "Check packed tarballs") < tag);
  assert.ok(stepIndex(publish, "Check what npm will publish") < tag);
  assert.ok(
    stepIndex(publish, "Check packed tarballs") < stepIndex(publish, "Check what npm will publish"),
  );
});

test("a tag publishes only a commit already on main, next or alpha, before any job builds it", () => {
  const source = config.jobs["release-source"];
  assert.ok(source, "missing the release-source job");
  for (const name of ["lambda-arm64-ffmpeg", "lambda-handler-zip"]) {
    assert.deepEqual(config.jobs[name].needs, ["release-source"], name);
  }
  assert.deepEqual([...config.jobs["lambda-video-image"].needs].sort(), [
    "lambda-arm64-ffmpeg",
    "lambda-handler-zip",
    "release-source",
  ]);
  assert.deepEqual([...pack.needs].sort(), [
    "lambda-handler-zip",
    "lambda-video-image",
    "release-source",
  ]);
  const step = stepOf(source, "Check the tagged commit is on main, next or alpha");
  assert.equal(step.if, "github.ref_type == 'tag'");
  const bin = mkdtempSync(join(tmpdir(), "hyperframes-fake-gh-"));
  try {
    // The fake answers compare/<branch>...<sha> from FAKE_<branch>; an unset branch answers like a 404.
    writeFileSync(
      join(bin, "gh"),
      '#!/bin/sh\nb="${2#*compare/}"; b="${b%%...*}"\neval "v=\\${FAKE_$b-}"\n[ -n "$v" ] || exit 1\necho "$v"\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
    const status = (branches) =>
      runStep(step, {
        cwd: bin,
        env: {
          REPO: "heygen-com/hyperframes",
          TAGGED: "abc",
          ...Object.fromEntries(Object.entries(branches).map(([b, v]) => [`FAKE_${b}`, v])),
        },
        path: `${bin}:${process.env.PATH}`,
      }).status;
    assert.equal(status({ main: "identical" }), 0);
    assert.equal(status({ main: "behind" }), 0);
    assert.equal(
      status({ main: "diverged", next: "behind" }),
      0,
      "a commit on next publishes an alpha",
    );
    assert.equal(status({ main: "ahead", next: "diverged", alpha: "identical" }), 0);
    // fails without the fix: a v*-* tag on any other commit went on to build and publish.
    assert.equal(status({ main: "ahead", next: "diverged" }), 1, "a commit on no allowed branch");
    assert.equal(status({ main: "diverged", next: "ahead", alpha: "ahead" }), 1);
    assert.equal(status({}), 1, "no branch answers");
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
