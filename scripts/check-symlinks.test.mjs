import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkSymlinks, findUnexpectedSymlinks, symlinkPaths } from "./check-symlinks.mjs";

/** A throwaway repo with `files` (contents) and `links` (path to target) staged, and no global git config. */
function repoWith({ files = {}, links = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "hf-symlinks-repo-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  spawnSync("git", ["init", "-q"], { cwd: dir, env });
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  for (const [name, target] of Object.entries(links)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    symlinkSync(target, join(dir, name));
  }
  spawnSync("git", ["add", "-A"], { cwd: dir, env });
  return dir;
}

describe("symlink check", () => {
  it("reads only symlink entries from the staged listing", () => {
    const listing =
      "100644 aaaa 0\tdocs/a.png\0" +
      "120000 bbbb 0\tdocs/images/env\0" +
      "100755 cccc 0\tscripts/x.sh\0" +
      "120000 dddd 0\tpath with space/link\0";
    assert.deepEqual(symlinkPaths(listing), ["docs/images/env", "path with space/link"]);
  });

  it("passes the links the repo already means to track", () => {
    assert.deepEqual(
      findUnexpectedSymlinks([
        "packages/cli/src/audio/scripts",
        "packages/producer/tests/render-symlinked-assets/src/shared",
      ]),
      [],
    );
  });

  it("fails a new link under docs/images, sorted", () => {
    assert.deepEqual(
      findUnexpectedSymlinks([
        "packages/cli/src/audio/scripts",
        "registry/x/link",
        "docs/images/env",
      ]),
      ["docs/images/env", "registry/x/link"],
    );
  });

  it("finds a link a pull request stages, and not regular files", () => {
    const dir = repoWith({
      files: { "docs/images/a.png": "png" },
      links: { "docs/images/env": "../../.env", "docs/images/up": "../.." },
    });
    try {
      assert.deepEqual(checkSymlinks(dir), ["docs/images/env", "docs/images/up"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes this repository as it stands", () => {
    assert.deepEqual(checkSymlinks(join(import.meta.dirname, "..")), []);
  });
});
