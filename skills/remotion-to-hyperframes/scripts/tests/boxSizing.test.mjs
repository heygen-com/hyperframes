import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(SKILL, path), "utf8");
const RULE = /\*\s*\{\s*box-sizing:\s*border-box;?\s*\}/g;

test("the skill tells the port to carry Remotion's box-sizing rule once", () => {
  assert.match(read("SKILL.md"), /\* \{ box-sizing: border-box; \}/);
  assert.match(read("references/api-map.md"), /width:200px;height:100px;padding:20px;border:10px/);
});

for (const tier of ["tier-1-title-card", "tier-2-multi-scene", "tier-3-data-driven"]) {
  test(`${tier}: the ported root sets the rule exactly once`, () => {
    const root = read(`assets/test-corpus/${tier}/hf-src/index.html`);
    assert.equal(root.match(RULE)?.length, 1);
  });
}
