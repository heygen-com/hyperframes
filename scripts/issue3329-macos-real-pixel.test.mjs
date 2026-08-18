import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(resolve(scriptsDir, ".."));

let safetyModule = null;
try {
  safetyModule = await import("./issue3329-artifact-safety.mjs");
} catch {
  // RED: the safety owner does not exist yet.
}

test("cleanup accepts only a dedicated descendant of the repo artifact space", () => {
  assert.ok(safetyModule, "artifact cleanup safety module must exist");
  const safe = join(repo, ".artifacts", "issue3329-macos", "run-1");
  assert.equal(safetyModule.validateArtifactRoot(safe, repo), safe);
});

test("cleanup rejects broad, traversing, home, and arbitrary external targets", () => {
  assert.ok(safetyModule, "artifact cleanup safety module must exist");
  const outside = mkdtempSync(join(tmpdir(), "hf-issue3329-external-"));
  for (const target of [
    parse(repo).root,
    homedir(),
    repo,
    join(repo, ".artifacts"),
    join(repo, ".artifacts", "issue3329-macos", "..", ".."),
    outside,
  ]) {
    assert.throws(() => safetyModule.validateArtifactRoot(target, repo), /artifact root/i);
  }
});

test("ffprobe terminates option parsing before its controlled input path", () => {
  const source = readFileSync(join(scriptsDir, "issue3329-macos-real-pixel.mjs"), "utf8");
  assert.match(
    source,
    /"-of",\s*"json",\s*"--",\s*path/,
    "ffprobe input must follow the -- option terminator",
  );
});
