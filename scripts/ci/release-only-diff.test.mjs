import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { classify } from "./release-only-diff.mjs";

const SCRIPT = new URL("./release-only-diff.mjs", import.meta.url).pathname;
const manifest = (version, extra = {}) =>
  `${JSON.stringify({ name: "p", version, dependencies: { a: "1" }, ...extra }, null, 2)}\n`;
const NOTES = (v, body = "Faster renders.") => `# HyperFrames v${v}\n\n${body}\n\n## Fixes\n`;
const CHANGELOG = (v, body = "Faster renders.") =>
  `<Update\n  label="HyperFrames v${v}"\n>\n${body}\n</Update>\n`;

/** A repo whose HEAD~1 is the base: `change` edits the worktree, then it is committed as the "release". */
function repo(change) {
  const root = mkdtempSync(join(tmpdir(), "release-only-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write("packages/core/package.json", manifest("0.8.1"));
  write("packages/cli/package.json", manifest("0.8.1"));
  write("plugin.json", manifest("0.8.1"));
  write("packages/core/src/index.ts", "export const a = 1;\n");
  write("docs/changelog.mdx", CHANGELOG("0.8.1"));
  git("add", "-A");
  git("commit", "-qm", "base");
  change(write);
  git("add", "-A");
  git("commit", "-qm", "release", "--allow-empty");
  return root;
}

const run = (root, ...args) => {
  const out = join(root, "..", `out-${Math.random().toString(36).slice(2)}`);
  writeFileSync(out, "");
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: out },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, output: readFileSync(out, "utf8") };
  } catch (error) {
    return {
      code: error.status,
      stdout: error.stdout,
      stderr: error.stderr,
      output: readFileSync(out, "utf8"),
    };
  }
};

const bump = (v) => (write) => {
  write("packages/core/package.json", manifest(v));
  write("packages/cli/package.json", manifest(v));
  write("plugin.json", manifest(v));
  write(`releases/v${v}.md`, NOTES(v));
  write("docs/changelog.mdx", CHANGELOG(v) + CHANGELOG("0.8.1"));
};

test("a diff of version bumps, release notes and the changelog is release only, and consistent", () => {
  const root = repo(bump("0.8.2"));
  assert.match(run(root).output, /release_only=true/);
  assert.equal(run(root, "--verify").code, 0);
});

test("a release that also changes code is not release only, so it keeps the full suite", () => {
  const root = repo((write) => {
    bump("0.8.2")(write);
    write("packages/core/src/index.ts", "export const a = 2;\n");
  });
  const result = run(root);
  assert.match(result.output, /release_only=false/);
  assert.match(result.stdout, /packages\/core\/src\/index\.ts/);
});

test("a manifest that changes more than its version is not a version bump", () => {
  const root = repo((write) => {
    bump("0.8.2")(write);
    write("packages/core/package.json", manifest("0.8.2", { dependencies: { a: "2" } }));
  });
  assert.match(run(root).output, /release_only=false/);
});

test("a branch named release/ with code in it is judged by its files, not its name", () => {
  const root = repo((write) => write("packages/core/src/index.ts", "export const a = 3;\n"));
  execFileSync("git", ["checkout", "-qb", "release/v0.8.2"], { cwd: root });
  assert.match(run(root).output, /release_only=false/);
});

test("an ordinary code pull request and an empty diff are not release only", () => {
  assert.match(
    run(repo((write) => write("packages/cli/src/a.ts", "x\n"))).output,
    /release_only=false/,
  );
  assert.match(run(repo(() => {})).output, /release_only=false/);
});

test("--verify refuses mixed versions, a missing note, an unreviewed note and a missing changelog entry", () => {
  const mixed = repo((write) => {
    bump("0.8.2")(write);
    write("plugin.json", manifest("0.8.3"));
  });
  assert.match(run(mixed, "--verify").stderr, /different versions/);

  const missing = repo((write) => {
    for (const path of ["packages/core/package.json", "packages/cli/package.json", "plugin.json"])
      write(path, manifest("0.8.2"));
    write("docs/changelog.mdx", CHANGELOG("0.8.2"));
  });
  assert.match(run(missing, "--verify").stderr, /releases\/v0\.8\.2\.md is missing/);

  const unreviewed = repo((write) => {
    bump("0.8.2")(write);
    write(
      "releases/v0.8.2.md",
      NOTES("0.8.2", "<!-- TODO: write a 1-2 sentence release summary here. -->"),
    );
  });
  assert.match(run(unreviewed, "--verify").stderr, /still has the generated TODO/);

  const noEntry = repo((write) => {
    bump("0.8.2")(write);
    write("docs/changelog.mdx", CHANGELOG("0.8.1"));
  });
  assert.match(run(noEntry, "--verify").stderr, /no entry for v0\.8\.2/);
});

test("classify works on plain data", () => {
  const files = { "a/package.json": manifest("1"), "plugin.json": manifest("1") };
  const after = { "a/package.json": manifest("2"), "plugin.json": manifest("2") };
  const result = classify(
    Object.keys(files),
    (p) => files[p] ?? null,
    (p) => after[p] ?? null,
  );
  assert.equal(result.releaseOnly, true);
  assert.deepEqual([...result.versions.values()], ["2", "2"]);
});

test("every heavy workflow asks the release-only action, and the decision is used where the heavy jobs read it", () => {
  const read = (name) =>
    readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
  for (const name of [
    "ci",
    "regression",
    "windows-render",
    "preview-regression",
    "player-perf",
    "player-safari",
    "lambda-arm64-image",
  ])
    assert.match(read(name), /uses: \.\/\.github\/actions\/release-only-diff/, name);
  const ci = read("ci");
  for (const key of [
    "code",
    "cli",
    "cli_bundle",
    "skills",
    "catalog_index",
    "gcp_beginframe",
    "studio",
    "edit_accuracy",
  ])
    assert.match(
      ci,
      new RegExp(`${key}: \\$\\{\\{[^\\n]*release_only == 'true' && 'false' \\|\\|`),
      `ci ${key}`,
    );
  assert.match(
    ci,
    /needs\.changes\.outputs\.release_only == 'true' \}\}\n\s+runs-on/,
    "build still runs on a release",
  );
  assert.match(ci, /release-checks:[\s\S]*release-only-diff\.mjs --verify/);
  for (const [name, key] of [
    ["regression", "code"],
    ["windows-render", "code"],
    ["preview-regression", "preview"],
    ["player-perf", "perf"],
  ])
    assert.match(
      read(name),
      new RegExp(`${key}: \\$\\{\\{[^\\n]*release_only == 'true' && 'false' \\|\\|`),
      name,
    );
});
