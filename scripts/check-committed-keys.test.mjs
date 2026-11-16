import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findKeyShapedValues, lineOf } from "./check-committed-keys.mjs";

const random = (length) =>
  Array.from({ length }, (_, i) => "aZ3kQ9mP2xR7bN5vL8cT4wY6"[(i * 7 + 3) % 24]).join("");
const liveShapedSk = ["sk", "V2", "hgu", random(11), random(32)].join("_");
const liveShapedHg = ["hg", random(40)].join("_");

describe("committed key check", () => {
  it("finds values shaped like a live sk_V2_ or hg_ key", () => {
    assert.equal(findKeyShapedValues(`const k = "${liveShapedSk}";`).length, 1);
    assert.equal(findKeyShapedValues(`key=${liveShapedHg}\n`).length, 1);
  });

  it("passes obvious fakes and short toy values", () => {
    const fakeSk = ["sk", "V2", "hgu", "0".repeat(11), "x".repeat(32)].join("_");
    for (const text of [fakeSk, "hg_test_abc", "hg_legacy_key", "sk_V2_hgu_abcd123", "hg_x"]) {
      assert.deepEqual(findKeyShapedValues(text), [], text);
    }
  });

  it("reports the line a value is on", () => {
    const text = `a\nb\nconst k = "${liveShapedSk}";\n`;
    assert.equal(lineOf(text, findKeyShapedValues(text)[0]), 3);
  });
});
