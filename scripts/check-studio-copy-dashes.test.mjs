import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isShippedSource, listDashedText } from "./check-studio-copy-dashes.mjs";

const lines = (source) => listDashedText(source, "x.tsx").map((issue) => issue.split(" ")[0]);

describe("Studio copy dash checker", () => {
  it("reports dashes in every string, template and JSX text form, literal or escaped", () => {
    const source = [
      'const a = "One \\u2014 two";',
      "const b = `plain \\u2013 template`;",
      "const c = `\\u2014 ${a}`;",
      "const d = `${a} \\u2014 ${b} x`;",
      "const e = `${a} x \\u2014`;",
      'const f = "Literal \u2014 too";',
      "const g = () => <p>Range 1\u20132</p>;",
      "const h = () => <p>One &mdash; two</p>;",
      'const i = () => <p title="One &#8211; two" />;',
    ].join("\n");
    assert.deepEqual(lines(source), [
      "x.tsx:1",
      "x.tsx:2",
      "x.tsx:3",
      "x.tsx:4",
      "x.tsx:5",
      "x.tsx:6",
      "x.tsx:7",
      "x.tsx:8",
      "x.tsx:9",
    ]);
  });

  it("ignores comments, regexes, hyphens and shortcut glyphs", () => {
    const source = [
      "// A comment \u2014 never copy",
      "/* block \u2013 comment */",
      "const d = /[\u2013\u2014]/;",
      'const f = "A plain hyphen - is fine, \u2325-click too";',
    ].join("\n");
    assert.deepEqual(lines(source), []);
  });

  it("checks shipped .ts and .tsx files, not tests or declarations", () => {
    assert.deepEqual(
      ["a.ts", "b.tsx", "c.test.ts", "d.spec.tsx", "e.d.ts", "f.css", "g.js"].filter(
        isShippedSource,
      ),
      ["a.ts", "b.tsx"],
    );
  });
});
