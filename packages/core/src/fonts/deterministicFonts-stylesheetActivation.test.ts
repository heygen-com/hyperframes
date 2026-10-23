// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";
import { analyzeFontStylesheets } from "./fontStylesheets.js";
let dir: string;
let counter: number;
const requested: string[] = [];
const context = { viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 };
const face = "@font-face{font-family:Inter;src:url(authored.woff2)}";
const usage = "<style>p{font-family:Inter}</style>";
const fetchImpl = Object.assign(
  async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response("", { status: 404 });
  },
  { preconnect: fetch.preconnect },
);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-style-activation-"));
  counter = 0;
  requested.length = 0;
  _clearGoogleFontCssCacheForTests();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function sheet(kind: "style" | "link", title: string, css: string, attrs = ""): string {
  if (kind === "style") return `<style title="${title}" ${attrs}>${css}</style>`;
  const filename = `s${counter++}.css`;
  writeFileSync(join(dir, filename), css);
  return `<link rel="stylesheet" href="${filename}" title="${title}" ${attrs}>`;
}
async function injected(head: string): Promise<boolean> {
  const result = await injectDeterministicFontFaces(
    `<html><head>${head}${usage}</head><body><p>Text</p></body></html>`,
    { mediaContext: context, stylesheetBaseDir: dir, fetchImpl, allowSystemFontCapture: false },
  );
  return result.includes("data-hyperframes-deterministic-fonts");
}
it.each([
  ["style", "style"],
  ["style", "link"],
  ["link", "style"],
  ["link", "link"],
] as const)(
  "inactive differently titled %s/%s face cannot suppress injection",
  async (first, second) => {
    expect(await injected(sheet(first, "One", "p{color:red}") + sheet(second, "Two", face))).toBe(
      true,
    );
  },
);
it.each([
  ["style", "style"],
  ["style", "link"],
  ["link", "style"],
  ["link", "link"],
] as const)("active same-title %s/%s face retains precedence", async (first, second) => {
  expect(await injected(sheet(first, "One", "p{color:red}") + sheet(second, "One", face))).toBe(
    false,
  );
});
it("matches preferred titles case-sensitively", async () => {
  expect(await injected(sheet("style", "One", "p{color:red}") + sheet("style", "one", face))).toBe(
    true,
  );
});
it("an empty preferred sheet still selects its title", async () => {
  expect(await injected(sheet("style", "One", "") + sheet("style", "Two", face))).toBe(true);
});
it("preserves a whitespace-only preferred title", async () => {
  expect(await injected(sheet("style", " ", "p{color:red}") + sheet("style", "Two", face))).toBe(
    true,
  );
});
it("selects a preferred title even when its media is inactive", async () => {
  expect(
    await injected(
      sheet("style", "One", "p{color:red}", 'media="print"') + sheet("style", "Two", face),
    ),
  ).toBe(true);
});
it("a style disabled content attribute does not disable its authored face", async () => {
  expect(await injected(sheet("style", "", face, "disabled"))).toBe(false);
});
it("a disabled linked face cannot suppress injection", async () => {
  expect(await injected(sheet("link", "", face, "disabled"))).toBe(true);
});
it.each([
  '<link rel="stylesheet" title="One">',
  '<link rel="stylesheet" title="One" href="">',
  '<link rel="stylesheet" title="One" href="missing.css" disabled>',
  '<link rel="stylesheet" title="One" href="missing.css" type="text/plain">',
  '<style title="One" type="text/plain">p{color:red}</style>',
])("an ineligible first sheet does not select a preferred title: %s", async (first) => {
  expect(await injected(first + sheet("style", "Two", face))).toBe(false);
});
it("a failed linked resource still selects its preferred title", async () => {
  expect(
    await injected(
      '<link rel="stylesheet" title="One" href="missing.css">' + sheet("style", "Two", face),
    ),
  ).toBe(true);
});
it("honors a default-style meta before a preferred title is selected", async () => {
  expect(
    await injected(
      '<meta http-equiv="default-style" content="Two">' +
        sheet("style", "One", "p{color:red}") +
        sheet("style", "Two", face),
    ),
  ).toBe(false);
});
it("an untitled sheet does not prevent a later default-style meta", async () => {
  expect(
    await injected(
      '<style>p{color:red}</style><meta http-equiv="default-style" content="Two">' +
        sheet("style", "One", "p{color:blue}") +
        sheet("style", "Two", face),
    ),
  ).toBe(false);
});
it("a late default-style meta does not replace Chrome's selected preferred title", async () => {
  expect(
    await injected(
      sheet("style", "One", "p{color:red}") +
        '<meta http-equiv="default-style" content="Two">' +
        sheet("style", "Two", face),
    ),
  ).toBe(true);
});
it("an active same-title alternate linked face retains precedence", async () => {
  const alternate = sheet("link", "One", face).replace(
    'rel="stylesheet"',
    'rel="alternate stylesheet"',
  );
  expect(await injected(sheet("style", "One", "p{color:red}") + alternate)).toBe(false);
});
it("an untitled alternate face cannot suppress injection", async () => {
  const alternate = sheet("link", "", face).replace(
    'rel="stylesheet"',
    'rel="alternate stylesheet"',
  );
  expect(await injected(alternate)).toBe(true);
});
it("retains an active alternate's exact Google URL across repeated analysis", async () => {
  const url = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&text=Title";
  const alternate = `<link rel="alternate stylesheet" title="One" href="${url}">`;
  const html = `<html><head>${sheet("style", "One", "p{color:red}", 'media="print"')}<meta http-equiv="default-style" content="Two">${alternate}<style>p{font-family:Fraunces}</style></head><body><p>Text</p></body></html>`;
  const result = await injectDeterministicFontFaces(html, {
    mediaContext: context,
    fetchImpl,
    allowSystemFontCapture: false,
  });
  expect(requested).toContain(url);
  expect(result).toContain('rel="alternate stylesheet"');
  const once = analyzeFontStylesheets(html, context);
  expect(analyzeFontStylesheets(once, context)).toBe(once);
});
