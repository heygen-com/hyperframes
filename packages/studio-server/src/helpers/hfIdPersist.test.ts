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
});
