import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./captions.mjs", import.meta.url), "utf8");

test("preserves caption-skin word-state colors", () => {
  assert.doesNotMatch(source, /caption-word\.is-(?:active|spoken)/);
});
