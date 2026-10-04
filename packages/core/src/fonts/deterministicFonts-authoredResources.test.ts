// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

let cacheDir: string;
let previousCacheDir: string | undefined;
const requests: string[] = [];
let restoreFetch: () => void;

beforeEach(() => {
  previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-authored-resources-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
  requests.length = 0;
  _clearGoogleFontCssCacheForTests();
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    requests.push(url.href);
    if (url.hostname === "fonts.googleapis.com") {
      const weight = url.searchParams.get("family")?.endsWith("700") ? "700" : "400";
      return new Response(`@font-face {
        font-family: 'Fraunces'; font-style: normal; font-weight: ${weight};
        src: url(https://fonts.gstatic.com/fraunces-${weight}.woff2) format('woff2');
      }`);
    }
    return new Response(url.pathname);
  });
  restoreFetch = () => mock.mockRestore();
});

afterEach(() => {
  restoreFetch();
  _clearGoogleFontCssCacheForTests();
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(cacheDir, { recursive: true, force: true });
});

const normal = "https://fonts.googleapis.com/css2?family=Fraunces:wght@400";
const bold = "https://fonts.googleapis.com/css2?family=Fraunces:wght@700";
const page = (head: string) => `<!doctype html><html><head>${head}
  <style>p { font-family: Fraunces; }</style></head><body><p>Hi</p></body></html>`;

function requestedFamilies(): (string | null)[] {
  return requests
    .filter((url) => url.startsWith("https://fonts.googleapis.com/"))
    .map((url) => new URL(url).searchParams.get("family"));
}

it("decodes HTML entities and preserves an authored text subset", async () => {
  await injectDeterministicFontFaces(page(`<link rel=stylesheet href="${normal}&amp;text=Hi">`));
  expect(requests[0]).toBe(`${normal}&text=Hi`);
});

it("embeds every separate weight resource once in document order", async () => {
  const result = await injectDeterministicFontFaces(
    page(
      `<link rel=stylesheet href="${normal}"><link rel=stylesheet href="${bold}">` +
        `<link rel=stylesheet href="${normal}">`,
    ),
  );
  expect(requestedFamilies()).toEqual(["Fraunces:wght@700", "Fraunces:wght@400"]);
  expect(result).toContain(Buffer.from("/fraunces-400.woff2").toString("base64"));
  expect(result).toContain(Buffer.from("/fraunces-700.woff2").toString("base64"));
});

it.each([
  `<link rel="stylesheet" media="print" href="${bold}">`,
  `<link rel="stylesheet" disabled href="${bold}">`,
  `<link rel="alternate stylesheet" title="other" href="${bold}">`,
  `<style media="print">@import url("${bold}");</style>`,
  `<style>@import url("${bold}") print;</style>`,
  `<style>@import url("${bold}") supports(display: grid);</style>`,
  `<!-- <link rel="stylesheet" href="${bold}"> -->`,
])("does not promote an inactive font source: %s", async (inactive) => {
  await injectDeterministicFontFaces(page(`${inactive}<link rel="stylesheet" href="${normal}">`));
  expect(requestedFamilies()).toEqual(["Fraunces:wght@400"]);
});
