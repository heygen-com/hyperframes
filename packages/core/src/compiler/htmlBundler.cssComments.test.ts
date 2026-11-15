import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleToSingleHtml, restoreCssPlaceholders } from "./htmlBundler";

async function bundleWithStylesheet(css: string, imported = ""): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hf-css-comments-"));
  try {
    writeFileSync(join(dir, "style.css"), css);
    writeFileSync(join(dir, "part.css"), imported);
    writeFileSync(
      join(dir, "index.html"),
      '<html><head><link rel="stylesheet" href="style.css"></head><body><main data-composition-id="root" data-width="320" data-height="180"></main></body></html>',
    );
    return await bundleToSingleHtml(dir, { runtime: "placeholder" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stylesheet comments in the bundle", () => {
  it("keep their text verbatim, replacement patterns included", async () => {
    const css = "/* $' $& $$ */ .a { color: red } /* b */";
    expect(await bundleWithStylesheet(css)).toContain(css);
  });

  it("bundle 400 KB of comments and unclosed comment openers in well under two seconds", async () => {
    const css = "/**/".repeat(50_000) + "/* ".repeat(66_000);
    const started = performance.now();
    expect(await bundleWithStylesheet(css)).toContain("/**//**/");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("inline imported stylesheets verbatim, replacement patterns included", async () => {
    const part = '.b { content: "$\' $&" }';
    expect(await bundleWithStylesheet('@import "part.css"; .a { color: red }', part)).toContain(
      part,
    );
  });

  it("inline every import of a sheet imported many times", async () => {
    const css = '@import "part.css"; '.repeat(50);
    expect((await bundleWithStylesheet(css, ".b{}")).split(".b{}")).toHaveLength(51);
  });
});

/** The restore it replaces: each comment, then each import, swapped in at its first occurrence. */
function sequentialRestore(css: string, comments: string[], imports: string[]): string {
  let out = css;
  comments.forEach((text, i) => (out = out.replace(`/*__hf_c${i}__*/`, text)));
  imports.forEach((text, i) => {
    out = out.replace(`/*__hf_import_${comments.length + i}__*/`, text);
  });
  return out;
}

const PIECES = [
  "a",
  " ",
  "{",
  "}",
  ";",
  "/*",
  "*/",
  "/**/",
  "url(x)",
  "\n",
  "@media x {",
  "_hf_",
  "c1",
];

describe("CSS placeholder restore", () => {
  it("puts back what the sequential restore put back on 20,000 generated sheets", () => {
    let seed = 3;
    const next = (n: number) =>
      Math.floor(((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * n);
    const text = () => Array.from({ length: next(6) }, () => PIECES[next(PIECES.length)]).join("");
    const differences: string[] = [];
    for (let run = 0; run < 20_000; run++) {
      const comments = Array.from({ length: next(4) }, () => `/*${text()}*/`);
      const imports = Array.from({ length: next(4) }, text);
      const placeholders = new Map<string, string>();
      comments.forEach((c, i) => placeholders.set(`/*__hf_c${i}__*/`, c));
      imports.forEach((c, i) => placeholders.set(`/*__hf_import_${comments.length + i}__*/`, c));
      const keys = [...placeholders.keys()].sort(() => next(2) - 0.5);
      const css = keys.map((key) => text() + key).join("") + text();
      if (restoreCssPlaceholders(css, placeholders) !== sequentialRestore(css, comments, imports))
        differences.push(css);
    }
    expect(differences).toEqual([]);
  });

  it("puts back 20,000 placeholders of 200 bytes each in well under a second", () => {
    const placeholders = new Map<string, string>();
    for (let i = 0; i < 20_000; i++)
      placeholders.set(`/*__hf_import_${i}__*/`, `.b{}/*${"x".repeat(192)}*/`);
    const css = [...placeholders.keys()].join(" ");
    const started = performance.now();
    expect(restoreCssPlaceholders(css, placeholders)).toHaveLength(
      css.length - [...placeholders.keys()].join("").length + 20_000 * 200,
    );
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
