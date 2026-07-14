import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTestSource,
  discoverProducerTests,
  summarizeTests,
} from "./test-classification.mjs";

describe("producer test classification", () => {
  it("classifies each supported runner into one lane", () => {
    assert.deepEqual(classifyTestSource("src/a.test.ts", 'import { it } from "bun:test";'), {
      file: "src/a.test.ts",
      runner: "bun",
      lane: "unit",
    });
    assert.deepEqual(
      classifyTestSource(
        "src/a.test.ts",
        'import { it } from "vitest";',
        new Set(["src/a.test.ts"]),
      ),
      { file: "src/a.test.ts", runner: "vitest", lane: "integration" },
    );
  });

  it("rejects missing and ambiguous runner imports", () => {
    assert.throws(() => classifyTestSource("src/a.test.ts", "export {};"), /neither runner/);
    assert.throws(
      () =>
        classifyTestSource(
          "src/a.test.ts",
          'import { it } from "bun:test"; import { expect } from "vitest";',
        ),
      /both bun:test and vitest/,
    );
  });

  it("classifies every current source test exactly once", () => {
    const tests = discoverProducerTests();
    assert.equal(new Set(tests.map((test) => test.file)).size, tests.length);
    const summary = summarizeTests(tests);
    assert.ok(summary.total > 0);
    assert.equal(
      summary.unit.bun + summary.unit.vitest + summary.integration.bun + summary.integration.vitest,
      summary.total,
    );
  });
});
