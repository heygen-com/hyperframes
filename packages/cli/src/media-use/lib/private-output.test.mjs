import test from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { discardPrivateOutput, privateOutputPath } from "./private-output.mjs";

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

test("discarding a generator's output removes the folder it was made in", (t) => {
  const out = privateOutputPath("kokoro", ".wav");
  removeAfter(t, dirname(out));
  writeFileSync(out, "voice");
  discardPrivateOutput(out);
  assert.equal(existsSync(dirname(out)), false);
});

test("discarding leaves any file a generator does not own", (t) => {
  const elsewhere = removeAfter(t, mkdtempSync(join(tmpdir(), "bundled-sfx-")));
  const library = join(elsewhere, "sfx", "whoosh.wav");
  mkdirSync(dirname(library), { recursive: true });
  writeFileSync(library, "whoosh");
  const lookalikeParent = removeAfter(t, mkdtempSync(join(tmpdir(), "not-temp-root-")));
  const lookalike = join(lookalikeParent, "media-use-codex-abcdef", "output.png");
  mkdirSync(dirname(lookalike), { recursive: true });
  writeFileSync(lookalike, "x");
  const otherTool = join(removeAfter(t, mkdtempSync(join(tmpdir(), "other-tool-"))), "output.png");
  writeFileSync(otherTool, "x");

  for (const path of [library, lookalike, otherTool]) discardPrivateOutput(path);

  assert.equal(existsSync(library), true);
  assert.equal(existsSync(lookalike), true);
  assert.equal(existsSync(otherTool), true);
});
