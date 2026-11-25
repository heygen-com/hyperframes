import { describe, it, expect, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCompositionSource, stampFileHfIds } from "./hfIdPersist.js";

const hooks = vi.hoisted(() => ({ minting: undefined as (() => void) | undefined }));
vi.mock("@hyperframes/parsers/hf-ids", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/hf-ids")>();
  return {
    ...actual,
    stampHfIdsInPlace: (html: string) => {
      hooks.minting?.();
      return actual.stampHfIdsInPlace(html);
    },
  };
});

describe("stampFileHfIds", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    hooks.minting = undefined;
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hfid-stamp-test-"));
    tmpDirs.push(dir);
    const file = join(dir, "scene.html");
    writeFileSync(file, content, "utf-8");
    return file;
  }

  it("stamps ids and writes them back to the file", () => {
    const file = tmpFile(`<div class="clip" data-start="0" data-end="3">Hi</div>`);
    const returned = stampFileHfIds(file);
    expect(returned).toContain('data-hf-id="hf-');
    expect(readFileSync(file, "utf-8")).toBe(returned);
  });

  it("adds only the ids to the file, keeping its own formatting", () => {
    const html = `<div class='clip' data-start=0 data-end="3"><img src="a.png"/><input disabled>Hi</div>`;
    const file = tmpFile(html);
    stampFileHfIds(file);
    const written = readFileSync(file, "utf-8");
    expect(written).toContain('data-hf-id="hf-');
    expect(written.replace(/ data-hf-id="hf-[a-z0-9]{4}"/g, "")).toBe(html);
  });

  it("replaces the stamped file and removes its temporary sibling", () => {
    const file = tmpFile(`<div class="clip" data-start="0" data-end="3">Hi</div>`);

    const returned = stampFileHfIds(file);

    expect(readFileSync(file, "utf-8")).toBe(returned);
    expect(readdirSync(file.replace(/\/[^/]+$/, ""))).toEqual(["scene.html"]);
  });

  it.each([
    ["in place", (file: string, html: string) => writeFileSync(file, html)],
    [
      "by rename",
      (file: string, html: string) => {
        writeFileSync(`${file}.tmp`, html);
        renameSync(`${file}.tmp`, file);
      },
    ],
  ])("keeps a write that lands %s while ids are minted", (_, write) => {
    const file = tmpFile(`<div class="clip" data-start="0" data-end="3">Hi</div>`);
    const agentWrite = `<div class="clip" data-start="0" data-end="5">Agent</div>`;
    hooks.minting = () => write(file, agentWrite);

    stampFileHfIds(file);

    expect(readFileSync(file, "utf-8")).toBe(agentWrite);
  });

  it("leaves a file deleted while ids are minted deleted", () => {
    const file = tmpFile(`<div class="clip" data-start="0" data-end="3">Hi</div>`);
    hooks.minting = () => rmSync(file);

    stampFileHfIds(file);

    expect(existsSync(file)).toBe(false);
  });

  it("does not rewrite an already-stamped file", () => {
    const file = tmpFile(`<div data-hf-id="hf-keep">Hi</div>`);
    const before = readFileSync(file, "utf-8");
    const returned = stampFileHfIds(file);
    expect(returned).toContain('data-hf-id="hf-keep"');
    expect(readFileSync(file, "utf-8")).toBe(before); // byte-identical, no write
  });

  it("returns null for a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hfid-stamp-test-"));
    tmpDirs.push(dir);
    expect(stampFileHfIds(join(dir, "nope.html"))).toBeNull();
  });

  it("returns null for a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hfid-stamp-test-"));
    tmpDirs.push(dir);
    expect(stampFileHfIds(dir)).toBeNull();
  });
});

describe("isCompositionSource", () => {
  it.each([
    '<div data-composition-id="main"></div>',
    "<div data-composition-id=main></div>",
    "<div class='a' data-composition-id = 'main'></div>",
    '<DIV DATA-COMPOSITION-ID="main"></DIV>',
    '<template data-composition-id="scene"><div></div></template>',
    '<template><div id="a" data-composition-id="scene"></div></template>',
    '<div title="a > b" data-composition-id="main"></div>',
    '<br/data-composition-id="main">',
    // An empty style or title inside inline SVG is not raw text; the root after it still counts.
    '<svg><style/></svg><div data-composition-id="main"></div>',
    '<svg><title></title><style></style></svg>\n<div data-composition-id="main"></div>',
    '<p>a < b</p><div\n\tdata-composition-id="main"></div>',
    '<template><template><div data-composition-id="scene"></div></template></template>',
    '<script>const marker = "data-composition-id=";</script><div data-composition-id="main"></div>',
    '<!doctype html><html><head><style>a{}</style></head><body><noscript>off</noscript><div data-composition-id="main"></div><script>run()</script></body></html>',
    '<div data-composition-id="main"><svg viewBox="0 0 1 1"><circle r="1"/></svg></div>',
    '<svg data-composition-id="main"></svg>',
    // Inside inline SVG a style or script holds markup, and a div there is an element that leaves the SVG.
    '<svg><style><div data-composition-id="x"></div></style></svg>',
    '<svg><script><div data-composition-id="x"></div></script></svg>',
    '<div data-composition-id="main"><svg><script>for(let i=0;i<n;i++){}</script></svg></div>',
    '<div data-composition-id="main"><script>var s="<!--[if IE]><scriptx";</script></div>',
    '<div data-composition-id="main"></div><plaintext>',
  ])("accepts an element with the attribute: %s", (html) => {
    expect(isCompositionSource(html)).toBe(true);
  });

  // fails without the fix: the check was the text `data-composition-id=` anywhere in the file.
  it.each([
    // What a page saved by the old one-pass capture strip holds.
    '<div data-captured-composition-idata-composition-id="x"></div>',
    '<div data-x-data-composition-id="x"></div>',
    '<div title="data-composition-id=x"></div>',
    "<div title='a data-composition-id=\"x\"'></div>",
    '<!-- <div data-composition-id="x"></div> -->',
    '<style>[data-composition-id="x"] { color: red }</style>',
    "<p>data-composition-id=x</p>",
    "<div data-composition-id></div>",
    '</div data-composition-id="x">',
    '<!-- never closed <div data-composition-id="x"></div>',
    '<div data-composition-id="x"',
    '<div data-composition-id="x></div>',
    '<div data-composition-id\u00a0="x"></div>',
    '<div "data-composition-id="x"></div>',
  ])("refuses the marker's text outside a real attribute: %s", (html) => {
    expect(isCompositionSource(html)).toBe(false);
  });

  // fails without the fix (the rows through the first plaintext, and the empty value): a tag written
  // inside text a browser never reads as markup counted as an element.
  it.each([
    '<script>const s = "<div data-composition-id=\\"x\\"></div>";</script><p>hi</p>',
    '<script><div data-composition-id="x"></div></script>',
    '<script><div data-composition-id="x"></div>',
    '<style><div data-composition-id="x"></div></style>',
    '<textarea><div data-composition-id="x"></div></textarea>',
    '<noscript><div data-composition-id="x"></div></noscript>',
    '<plaintext><div data-composition-id="x"></div>',
    '<div data-composition-id=""></div>',
    '<title><div data-composition-id="x"></div></title>',
    '<xmp><div data-composition-id="x"></div></xmp>',
    '<iframe><div data-composition-id="x"></div></iframe>',
    '<noembed><div data-composition-id="x"></div></noembed>',
    '<noframes><div data-composition-id="x"></div></noframes>',
    '<plaintext></plaintext><div data-composition-id="x"></div>',
    // The script, comment or text goes on past where it looks to end, and holds the div.
    '<script><!--<script></script><div data-composition-id="x"></div>--></script>',
    '<script></script/><!-- </script><div data-composition-id="x"></div> -->',
    '<script/><div data-composition-id="x"></div>',
    '<![CDATA[><!-- ]]><div data-composition-id="x"></div>',
    '<![CDATA[ ><script> ]]><div data-composition-id="x"></div></script>',
    '<!-- --!><script> --><div data-composition-id="x"></div></script>',
    '<div><noscript></div><div data-composition-id="x"></div>',
    "</p a=\"><div data-composition-id='x'></div>\">",
    // A browser drops the tag here.
    '<html><head></head><frameset><div data-composition-id="x"></div></frameset></html>',
    '<template><col><div data-composition-id="x"></div>',
    // A browser keeps the first of two attributes with one name.
    '<div DATA-COMPOSITION-ID="" data-composition-id="x"></div>',
  ])("refuses a tag that is only text to a browser: %s", (html) => {
    expect(isCompositionSource(html)).toBe(false);
  });

  const root = '<div data-composition-id="main"></div>';

  it("accepts a root nested as deep as a browser nests, and refuses one nested deeper", () => {
    expect(isCompositionSource("<div>".repeat(500) + root)).toBe(true);
    expect(isCompositionSource("<div>".repeat(600) + root)).toBe(false);
    expect(isCompositionSource("<template>".repeat(600) + root)).toBe(false);
  });

  const attributes = (count: number) => Array.from({ length: count }, (_, i) => `a${i}`).join(" ");

  // fails without the limit: 100,000 attributes on one tag take about 15 seconds.
  it("accepts a root with 4,000 attributes, and refuses a tag with 100,000 within a second", () => {
    expect(isCompositionSource(`<div ${attributes(4000)} data-composition-id="main"></div>`)).toBe(
      true,
    );
    const started = performance.now();
    expect(isCompositionSource(`<div ${attributes(100_000)}></div>${root}`)).toBe(false);
    expect(isCompositionSource(`</div ${attributes(100_000)}>${root}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  // fails without the limit: a repeated name is not kept, so the count of kept attributes never grows.
  it("refuses a tag that repeats one attribute name 200,000 times after 4,000 others", () => {
    const started = performance.now();
    const tag = `<div b ${attributes(4000)} ${"b ".repeat(200_000)}>`;
    expect(isCompositionSource(tag + root)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  // fails without the limit: each paragraph opens the 480 unclosed elements again, 2.4 million in all.
  it("refuses a small page that makes the parser repeat its open elements without end", () => {
    const open = Array.from({ length: 480 }, (_, i) => `<b a=${i}>`).join("");
    const started = performance.now();
    expect(isCompositionSource(`<p>${open}</p>${"<p>x".repeat(5000)}${root}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("accepts a root after 400,000 elements moved out of an element closed out of order", () => {
    const started = performance.now();
    expect(isCompositionSource(`<b><div>${"<i>x</i>".repeat(400_000)}</b>${root}`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("accepts a root after a million siblings", () => {
    expect(isCompositionSource("<p>x</p>".repeat(1_000_000) + root)).toBe(true);
    expect(isCompositionSource(`<table>${"<i>x</i>".repeat(200_000)}</table>${root}`)).toBe(true);
  });

  // fails without the limit: 100,000 nested divs take minutes, and unclosed templates that deep overflow the stack.
  it.each(["<div>", "<template>", "<table><td>", "<a><div>", "<b>"])(
    "refuses 100,000 unclosed %s before the root within a second",
    (open) => {
      const started = performance.now();
      expect(isCompositionSource(open.repeat(100_000) + root)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1000);
    },
  );
});
