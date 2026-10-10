import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listDashedText } from "./check-studio-copy-dashes.mjs";

describe("Studio copy dash checker", () => {
  it("reports dashes in strings, template text and JSX text, escaped or not", () => {
    const source = [
      'const a = "One — two";',
      "const b = `${a} – ${a}`;",
      'const c = "Escaped \\u2014 too";',
      "const d = () => <p>Range 1–2</p>;",
    ].join("\n");
    assert.deepEqual(
      listDashedText(source, "x.tsx").map((issue) => issue.split(" ")[0]),
      ["x.tsx:1", "x.tsx:2", "x.tsx:3", "x.tsx:4"],
    );
  });

  it("ignores comments, regexes, hyphens and shortcut glyphs", () => {
    const source = [
      "// A comment — never copy",
      "/* block – comment */",
      "const d = /[–—]/;",
      'const f = "A plain hyphen - is fine, ⌥-click too";',
    ].join("\n");
    assert.deepEqual(listDashedText(source, "x.tsx"), []);
  });
});
