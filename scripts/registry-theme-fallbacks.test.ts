import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTMLContent } from "../packages/core/src/compiler/htmlDocument.js";

const repoRoot = resolve(import.meta.dirname, "..");
const DECLARATION = /(--[\w-]+)\s*:/g;
const BARE_READ = /var\(\s*(--[\w-]+)\s*\)/g;

function tokenNames(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map((m) => m[1] ?? ""));
}

// Every theme pack defines the whole contract (themes/CONTRACT.md), so one pack names it.
const CONTRACT = tokenNames(
  readFileSync(resolve(repoRoot, "themes/neutral.css"), "utf-8"),
  DECLARATION,
);

function dropComments(node: Node): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === child.COMMENT_NODE) child.remove();
    else dropComments(child);
  }
}

/** The file with HTML comments removed by the parser, then CSS block and JS line comments. */
function liveSource(html: string): string {
  const document = parseHTMLContent(html);
  dropComments(document);
  return document.documentElement.outerHTML
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Contract tokens the file reads with no fallback and does not declare itself. */
function bareContractTokens(html: string): string[] {
  const live = liveSource(html);
  const declared = tokenNames(live, DECLARATION);
  const read = tokenNames(live, BARE_READ);
  return [...read].filter((token) => CONTRACT.has(token) && !declared.has(token)).sort();
}

describe("registry theme fallbacks", () => {
  it("reads the contract from the theme pack", () => {
    assert.ok(CONTRACT.has("--bg") && CONTRACT.has("--font-display"), [...CONTRACT].join(" "));
  });

  it("flags only a bare contract token the file does not declare", () => {
    assert.deepEqual(bareContractTokens("p { color: var(--fg); background: var(--c) }"), ["--fg"]);
    assert.deepEqual(bareContractTokens("p { color: var(--fg, #fff) }"), []);
    assert.deepEqual(bareContractTokens("#root { --fg: #fff } p { color: var(--fg) }"), []);
    assert.deepEqual(bareContractTokens("/* var(--fg) */ <!-- var(--bg) -->"), []);
  });

  // A theme pack is optional: without one, a bare token resolves to nothing and the item paints
  // black on black, in an install and in the Catalog preview alike.
  it("every registry item reads contract tokens with a fallback", () => {
    const bare: string[] = [];
    for (const file of globSync("registry/{blocks,components}/*/*.html", { cwd: repoRoot })) {
      if (file.endsWith("/demo.html")) continue;
      const tokens = bareContractTokens(readFileSync(resolve(repoRoot, file), "utf-8"));
      if (tokens.length > 0) bare.push(`${file}: ${tokens.join(" ")}`);
    }
    assert.deepEqual(bare, []);
  });
});
