import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probe } from "./probe.mjs";

// Regression for the shell-injection fix: probe() must pass the path as a literal
// argv entry, never through a shell. A filename containing shell metacharacters
// must NOT execute. Under the old execSync(`ffprobe ... "${path}"`) the embedded
// `touch` ran and created the marker; under execFileSync it cannot, regardless of
// whether ffprobe is installed (the injected command never reaches a shell).
test("probe does not execute shell metacharacters in a filename", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-inject-"));
  const marker = join(dir, "INJECTED");
  // Slash-free basename (a real on-disk filename) that breaks out of the old
  // double-quoted interpolation and would `touch INJECTED` in the cwd.
  const evil = join(dir, `clip"; touch INJECTED; echo ".mp4`);
  const prevCwd = process.cwd();
  try {
    writeFileSync(evil, "not real media");
    process.chdir(dir); // so a leaked `touch INJECTED` would land next to `marker`
    const meta = probe(evil);
    assert.equal(existsSync(marker), false, "injected `touch` must not have run");
    // Bogus/unreadable media still returns the null-shaped result, never throws.
    assert.deepEqual(Object.keys(meta).sort(), ["codec", "duration", "height", "width"]);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
