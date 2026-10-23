import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { compileForRender } from "./htmlCompiler.js";

async function compileStyles(styles: string) {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-compile-imports-"));
  try {
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<html><head>${styles}</head><body><main data-composition-id="root" data-width="640" data-height="360" data-duration="1"><p>Title</p></main></body></html>`,
    );
    const compiled = await compileForRender(projectDir, htmlPath, projectDir, {
      allowSystemFontCapture: false,
    });
    return parseHTML(compiled.html).document;
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

it.each(["layer(theme)", "supports(display: grid)", "(min-width: 1000px)"])(
  "preserves the complete qualified import: %s",
  async (condition) => {
    const document = await compileStyles(
      `<style>@import url("https://example.test/theme.css") ${condition}; p { color: red; }</style>`,
    );
    expect(
      document.querySelector('link[rel="stylesheet"][href="https://example.test/theme.css"]'),
    ).toBeNull();
    expect(
      Array.from(document.querySelectorAll("style"), (style) => style.textContent).join("\n"),
    ).toContain(`@import url("https://example.test/theme.css") ${condition};`);
  },
);

it.each(['media="print"', 'title="Theme"'])(
  "keeps imports inside a conditioned style: %s",
  async (attribute) => {
    const document = await compileStyles(
      `<style ${attribute}>@import url("https://example.test/theme.css"); p { color: red; }</style>`,
    );
    expect(
      document.querySelector('link[rel="stylesheet"][href="https://example.test/theme.css"]'),
    ).toBeNull();
    expect(document.querySelector(`style[${attribute}]`)?.textContent).toContain(
      '@import url("https://example.test/theme.css");',
    );
  },
);

it("keeps promoted stylesheet requests before their inline rules in source order", async () => {
  const document = await compileStyles(
    `<style>@import url("https://example.test/first.css"); @import "https://example.test/second.css"; p { color: red; }</style>`,
  );
  const relevant = Array.from(document.querySelectorAll("head > link, head > style")).flatMap(
    (node) => {
      if (
        node.getAttribute("rel") === "stylesheet" &&
        node.getAttribute("href")?.startsWith("https://example.test/")
      )
        return [node.getAttribute("href")];
      if (node.tagName.toLowerCase() === "style" && node.textContent?.includes("color: red"))
        return ["inline"];
      return [];
    },
  );
  expect(relevant).toEqual([
    "https://example.test/first.css",
    "https://example.test/second.css",
    "inline",
  ]);
});

it("retains repeated imports at their separate cascade positions", async () => {
  const document = await compileStyles(
    `<style>@import url("https://example.test/theme.css"); p { color: red; }</style><script>window.importBoundary = true;</script><style>@import url("https://example.test/theme.css"); p { color: blue; }</style>`,
  );
  const relevant = Array.from(document.querySelectorAll("head > link, head > style")).flatMap(
    (node) => {
      if (
        node.getAttribute("rel") === "stylesheet" &&
        node.getAttribute("href") === "https://example.test/theme.css"
      )
        return ["import"];
      if (node.tagName.toLowerCase() !== "style") return [];
      if (node.textContent?.includes("color: red")) return ["red"];
      if (node.textContent?.includes("color: blue")) return ["blue"];
      return [];
    },
  );
  expect(relevant).toEqual(["import", "red", "import", "blue"]);
});

it("does not move a later import across a preserved qualified import", async () => {
  const document = await compileStyles(
    `<style>@import url("https://example.test/conditional.css") layer(theme); @import url("https://example.test/later.css"); p { color: red; }</style>`,
  );
  expect(
    document.querySelector('link[rel="stylesheet"][href="https://example.test/later.css"]'),
  ).toBeNull();
  expect(
    Array.from(document.querySelectorAll("style"), (style) => style.textContent).join("\n"),
  ).toContain('@import url("https://example.test/later.css");');
});
