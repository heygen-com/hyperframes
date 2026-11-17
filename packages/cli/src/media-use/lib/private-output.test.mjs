import test from "node:test";
import assert from "node:assert";
import { rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { privateOutputPath, privateWorkDir } from "./private-output.mjs";

const ownerOnly = (path) => (statSync(path).mode & 0o777).toString(8);
// Output folders land in the real temp folder; remove them with the test.
const removeAfter = (t, path) => {
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};

test("each output goes in its own new folder, not straight in the shared temp folder", (t) => {
  const first = privateOutputPath("mflux", ".png");
  const second = privateOutputPath("mflux", ".png");
  removeAfter(t, dirname(first));
  removeAfter(t, dirname(second));
  assert.equal(dirname(dirname(first)), tmpdir());
  assert.match(basename(dirname(first)), /^media-use-mflux-/);
  assert.equal(basename(first), "output.png");
  assert.notEqual(dirname(first), dirname(second));
});

test("only this account can open an output folder", { skip: process.platform === "win32" }, (t) => {
  const dir = removeAfter(t, dirname(privateOutputPath("ltx", ".mp4")));
  assert.equal(ownerOnly(dir), "700");
});

test("an agent work folder sits under the per-user cache, not the shared temp folder", () => {
  const dir = privateWorkDir("codex");
  assert.equal(dirname(dir), join(homedir(), ".cache", "hyperframes", "media-use"));
  assert.notEqual(privateWorkDir("codex"), dir);
});

test("an agent work folder follows HYPERFRAMES_CACHE_DIR", (t) => {
  const named = removeAfter(t, join(tmpdir(), `hf-cache-${process.pid}`));
  process.env.HYPERFRAMES_CACHE_DIR = named;
  t.after(() => delete process.env.HYPERFRAMES_CACHE_DIR);
  assert.equal(dirname(privateWorkDir("codex")), join(named, "media-use"));
});

test(
  "only this account can open an agent work folder",
  { skip: process.platform === "win32" },
  () => {
    assert.equal(ownerOnly(privateWorkDir("codex")), "700");
  },
);
