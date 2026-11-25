import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

const READ_UNLIKE_BROWSER = /can't be read the way a browser reads them/;

const ICON = "<svg><title><!-- </title><img src=x onerror=f()> --></title></svg>";
const root = (body: string) =>
  `<!DOCTYPE html><html><head></head><body><div data-composition-id="main" data-width="320" data-height="180">${body}</div></body></html>`;

async function bundle(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hf-foreign-text-"));
  try {
    for (const [path, html] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), html);
    }
    return await bundleToSingleHtml(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// fails without the fix: the preview and render bundle served the title's hidden img as a live element.
describe("bundleToSingleHtml with markup hidden in an svg title", () => {
  it("refuses it in the root composition", async () => {
    await expect(bundle({ "index.html": root(`<div class="clip">${ICON}</div>`) })).rejects.toThrow(
      READ_UNLIKE_BROWSER,
    );
  });

  it("refuses it in a sub-composition", async () => {
    const sub = `<template><div data-composition-id="sub" data-width="320" data-height="180">${ICON}</div></template>`;
    const host =
      '<div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="1"></div>';
    await expect(
      bundle({ "index.html": root(host), "compositions/sub.html": sub }),
    ).rejects.toThrow(READ_UNLIKE_BROWSER);
  });

  it("still bundles an svg whose title is plain text", async () => {
    const html = await bundle({
      "index.html": root(
        '<svg viewBox="0 0 4 4"><title>Icon 1 &lt; 2</title><circle r="2"></circle></svg>',
      ),
    });
    expect(html).toContain("<title>Icon 1 &lt; 2</title>");
  });
});

// fails without the fix: the build kept these marks as comment text, and the preview browser read them as elements.
describe("bundleToSingleHtml with a data-composition-file a scripting browser reads past a comment", () => {
  const HIDDEN_MARKS = [
    '<noscript><!-- </noscript><p data-composition-file="index.html">x</p> --></noscript>',
    '<p><!-- --!><b data-composition-file="index.html">x</b> --></p>',
  ];

  it.each(HIDDEN_MARKS)("refuses %s in the root composition", async (body) => {
    await expect(bundle({ "index.html": root(body) })).rejects.toThrow(READ_UNLIKE_BROWSER);
  });

  it.each(HIDDEN_MARKS)("refuses %s in a sub-composition", async (body) => {
    const sub = `<template><div data-composition-id="sub" data-width="320" data-height="180">${body}</div></template>`;
    const host =
      '<div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="1"></div>';
    await expect(
      bundle({ "index.html": root(host), "compositions/sub.html": sub }),
    ).rejects.toThrow(READ_UNLIKE_BROWSER);
  });

  it("still bundles a noscript fallback and comments", async () => {
    const html = await bundle({
      "index.html": root("<noscript><p>Turn on JavaScript</p></noscript><!-- a note -->"),
    });
    expect(html).toContain("<noscript><p>Turn on JavaScript</p></noscript>");
  });
});
