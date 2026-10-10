import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkStudioCopyDashes,
  isShippedSource,
  listDashedText,
} from "./check-studio-copy-dashes.mjs";

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
      "const j = () => <p>One &ndash; two</p>;",
      "const l = () => <p>One &#8212; two</p>;",
      'const k = () => <p title="One &#X2014; two" />;',
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
      "x.tsx:10",
      "x.tsx:11",
      "x.tsx:12",
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

  it("exempts only the named strings in the named files", () => {
    const media = 'const a = "\u2014";\nconst b = "a \u2014 b";';
    assert.deepEqual(
      listDashedText(media, "packages/core/src/figma/mediaIndex.ts").map((i) => i.split(" ")[0]),
      ["packages/core/src/figma/mediaIndex.ts:2"],
    );
    assert.equal(listDashedText(media, "packages/core/src/other.ts").length, 2);
    const scoping = 'const s = `/* Swallow \u2014 the scoped root */`;\nconst t = "a \u2014 b";';
    assert.deepEqual(
      listDashedText(scoping, "packages/core/src/compiler/compositionScoping.ts").map(
        (i) => i.split(" ")[0],
      ),
      ["packages/core/src/compiler/compositionScoping.ts:2"],
    );
  });

  it("checks shipped .ts and .tsx files, not tests or declarations", () => {
    assert.deepEqual(
      ["a.ts", "b.tsx", "c.test.ts", "d.spec.tsx", "e.d.ts", "f.css", "g.js"].filter(
        isShippedSource,
      ),
      ["a.ts", "b.tsx"],
    );
  });

  it("scans Studio and every package whose text Studio shows, but not the CLI", () => {
    const shown = [
      "core",
      "engine",
      "lint",
      "parsers",
      "player",
      "producer",
      "sdk",
      "shader-transitions",
      "studio",
      "studio-server",
    ];
    const root = mkdtempSync(join(tmpdir(), "studio-dashes-"));
    for (const name of [...shown, "cli"]) {
      const src = join(root, "packages", name, "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "a.ts"), 'export const a = "x \u2014 y";');
      writeFileSync(join(src, "a.test.ts"), 'const b = "x \u2014 y";');
    }
    const scanned = checkStudioCopyDashes(root).map((issue) => issue.split("/")[1]);
    rmSync(root, { recursive: true });
    assert.deepEqual(scanned.sort(), shown);
  });
});
