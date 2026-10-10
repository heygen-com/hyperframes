import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCRIPT = join(import.meta.dirname, "check-large-files.sh");
const OVER_LIMIT_BYTES = 2 * 1024 * 1024;

/** Commit files into a throwaway repo with no global or system git config (so no LFS filter). */
function withRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "hf-largefiles-repo-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: dir,
      env,
      encoding: "utf-8",
    });
  const commit = (files) => {
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
    git("add", "-A");
    git("commit", "-q", "-m", "c");
    return git("rev-parse", "HEAD").stdout.trim();
  };
  const range = (base, head) => {
    const result = spawnSync(SCRIPT, ["--range", base, head], { cwd: dir, env, encoding: "utf-8" });
    return { ok: result.status === 0, stderr: result.stderr ?? "" };
  };
  try {
    git("init", "-q");
    run({ commit, range });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run the checker over explicit paths. Exit 0 means "nothing to complain about". */
function check(...paths) {
  const result = spawnSync(SCRIPT, paths, { encoding: "utf-8" });
  return { ok: result.status === 0, stderr: result.stderr ?? "" };
}

function withFiles(files, run) {
  const dir = mkdtempSync(join(tmpdir(), "hf-largefiles-"));
  try {
    const paths = {};
    for (const [name, contents] of Object.entries(files)) {
      paths[name] = join(dir, name);
      writeFileSync(paths[name], contents);
    }
    run(paths);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const bigBinary = Buffer.alloc(OVER_LIMIT_BYTES);
const bigText = "the quick brown fox jumps over the lazy dog\n".repeat(50_000);

describe("check-large-files", () => {
  it("rejects a binary over the limit, and names it", () => {
    withFiles({ "big.bin": bigBinary }, ({ "big.bin": path }) => {
      const { ok, stderr } = check(path);
      assert.equal(ok, false);
      assert.match(stderr, /big\.bin/);
    });
  });

  // The cost this hook exists to stop is a binary one: git delta-compresses
  // text, so a file that grows a few KB per commit costs a few KB. Before this,
  // `docs/changelog.mdx` (half a megabyte of release notes, a little larger
  // every release) failed a check whose own message says "large binaries", and
  // every release had to pass HF_MAX_NONLFS_KB to get through.
  it("accepts a text file over the limit", () => {
    withFiles({ "big.txt": bigText }, ({ "big.txt": path }) => {
      assert.equal(check(path).ok, true);
    });
  });

  it("accepts a binary under the limit", () => {
    withFiles({ "small.bin": Buffer.alloc(1024) }, ({ "small.bin": path }) => {
      assert.equal(check(path).ok, true);
    });
  });

  it("reports every offending binary, not just the first", () => {
    withFiles({ "a.bin": bigBinary, "b.bin": bigBinary }, ({ "a.bin": a, "b.bin": b }) => {
      const { ok, stderr } = check(a, b);
      assert.equal(ok, false);
      assert.match(stderr, /a\.bin/);
      assert.match(stderr, /b\.bin/);
    });
  });

  it("--range rejects a binary the range adds, and ignores text and untouched files", () => {
    withRepo(({ commit, range }) => {
      const base = commit({ "old.bin": bigBinary });
      const head = commit({ "big.bin": bigBinary, "big.txt": bigText });
      const { ok, stderr } = range(base, head);
      assert.equal(ok, false);
      assert.match(stderr, /big\.bin/);
      assert.doesNotMatch(stderr, /big\.txt|old\.bin/);
    });
  });

  it("--range rejects a raw blob even when .gitattributes routes it through LFS", () => {
    withRepo(({ commit, range }) => {
      const base = commit({ ".gitattributes": "*.mp4 filter=lfs diff=lfs merge=lfs -text\n" });
      const head = commit({ "clip.mp4": bigBinary });
      const { ok, stderr } = range(base, head);
      assert.equal(ok, false);
      assert.match(stderr, /clip\.mp4 .*stored raw/);
    });
  });
});
