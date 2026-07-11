import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("frame worker keeps video media out of sub-compositions", () => {
  const instructions = readFileSync(join(skillDir, "sub-agents", "frame-worker.md"), "utf8");

  assert.doesNotMatch(instructions, /Render it as a \*\*muted\*\* `<video class="clip">`/);
  assert.match(instructions, /never author `<video>` or `<audio>` inside a frame sub-composition/i);
  assert.match(instructions, /approved static still or key art/i);
});
