import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

// A file URL's pathname is "/D:/a/x" on Windows, which opens "D:\D:\a\x".
it("package code turns file URLs into paths with fileURLToPath, not .pathname", () => {
  const files = execFileSync("git", ["ls-files", "packages/*.mjs", "packages/*.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && !/\.test\.|\/tests?\//.test(file));
  const offenders = files.filter((file) =>
    /import\.meta\.url\)\.pathname/.test(readFileSync(join(ROOT, file), "utf8")),
  );
  assert.deepEqual(offenders, []);
});

const ENTRYPOINTS = [
  "check-comment-citations.mjs",
  "check-docs-snippet-motion.mjs",
  "check-no-main-deletions.mjs",
  "comment-ratchet.mjs",
  "validate-release-channel.mjs",
  "build-docs-gallery-nav.mjs",
  "generate-media-use-svg-sanitize.mjs",
];

function checkout(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hyperframes entrypoints %#-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };
  for (const file of [
    ...ENTRYPOINTS.map((name) => `scripts/${name}`),
    "scripts/docs-catalog-shared.mjs",
    "scripts/gate-probes/broken-citation.md",
    "packages/core/src/figma/sanitizeSvg.ts",
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(root, file));
  }
  symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"), "junction");
  symlinkSync(
    join(ROOT, "packages/core/node_modules"),
    join(root, "packages/core/node_modules"),
    "junction",
  );
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const run = (name, args = [], env = {}) =>
    spawnSync(process.execPath, [join(root, "scripts", name), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  const commit = () =>
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--no-gpg-sign",
      "-qm",
      "fixture",
    );
  return { root, write, git, commit, run };
}

it("runs release validation from a path needing URL encoding", (t) => {
  const { run } = checkout(t);
  const env = {
    EVENT_NAME: "pull_request",
    VERSION: "0.4.24",
    DIST_TAG: "alpha",
    PR_HEAD_REF: "release/v0.4.24",
  };
  const invalid = run("validate-release-channel.mjs", [], env);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.match(invalid.stderr, /must publish with npm dist-tag "latest"/);
  const valid = run("validate-release-channel.mjs", [], { ...env, DIST_TAG: "latest" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Release channel validated/);
});

it("checks autoplaying docs snippets from a path needing URL encoding", (t) => {
  const { write, run } = checkout(t);
  write("docs/snippets/grid.jsx", "export const Grid = () => <video autoPlay />;\n");
  const result = run("check-docs-snippet-motion.mjs");
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /grid\.jsx.*Grid/);
  assert.match(result.stderr, /prefers-reduced-motion/);
});

it("reports deleted files from a path needing URL encoding", (t) => {
  const { root, write, git, commit, run } = checkout(t);
  git("init", "-q");
  write("removed.txt", "keep this file\n");
  git("add", "removed.txt");
  commit();
  const base = git("rev-parse", "HEAD").trim();
  rmSync(join(root, "removed.txt"));
  git("add", "removed.txt");
  commit();
  const result = run("check-no-main-deletions.mjs", ["--base", base]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /This branch deletes 1 files/);
  assert.match(result.stderr, /removed\.txt/);
});

it("checks comment citations from a path needing URL encoding", (t) => {
  const { write, git, run } = checkout(t);
  git("init", "-q");
  write("bad.ts", "// See `missing-source.ts`.\nexport const value = 1;\n");
  git("add", "bad.ts", "scripts/gate-probes/broken-citation.md");
  const result = run("check-comment-citations.mjs", ["bad.ts"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /comments FAILED/);
  assert.match(result.stderr, /missing-source\.ts/);
});

it("checks comment share from a path needing URL encoding", (t) => {
  const { write, git, commit, run } = checkout(t);
  git("init", "-q");
  const file = "packages/example/src/value.ts";
  write(file, "export const value = 1;\n");
  git("add", file);
  commit();
  write(file, "// A comment above the value.\nexport const value = 1;\n");
  const result = run("comment-ratchet.mjs", [], { COMMENT_CHECK_BASE: "HEAD" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /RAISED comment share/);
  assert.match(result.stderr, /packages\/example\/src\/value\.ts/);
});

it("generates catalog navigation from a path needing URL encoding", (t) => {
  const { root, write, run } = checkout(t);
  write("docs/docs.json", JSON.stringify({ navigation: { tabs: [{ tab: "Catalog" }] } }));
  write(
    "docs/snippets/catalog-gallery-data.mdx",
    `export const catalogGalleryData = ${JSON.stringify({
      groups: [{ id: "titles", label: "Titles" }],
      items: [{ group: "titles", section: "Titles", href: "/catalog/title" }],
    })};\n`,
  );
  const result = run("build-docs-gallery-nav.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rebuilt Catalog nav: 1 groups, 1 items/);
  const config = JSON.parse(readFileSync(join(root, "docs/docs.json"), "utf8"));
  assert.deepEqual(config.navigation.tabs[0].groups[0].pages[1].pages, ["catalog/title"]);
});

it("generates the SVG sanitizer from a path needing URL encoding", (t) => {
  const { root, write, run } = checkout(t);
  const output = "packages/cli/src/media-use/lib/svg-sanitize.mjs";
  write(output, "stale output\n");
  const result = run("generate-media-use-svg-sanitize.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote .*svg-sanitize\.mjs/);
  const generated = readFileSync(join(root, output), "utf8");
  assert.match(generated, /GENERATED/);
  assert.match(generated, /export.*sanitizeSvg/);
});

for (const name of ENTRYPOINTS) {
  it(`does not run ${name} when imported`, (t) => {
    const { root } = checkout(t);
    const url = pathToFileURL(join(root, "scripts", name)).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(url)}); console.log("imported");`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "imported\n");
    assert.equal(result.stderr, "");
  });
}
