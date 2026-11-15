import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

async function bundleWithStylesheet(css: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hf-css-comments-"));
  try {
    writeFileSync(join(dir, "style.css"), css);
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
});
