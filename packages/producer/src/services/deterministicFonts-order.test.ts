import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

let previousCacheDir: string | undefined;
let testCacheDir: string;

beforeAll(() => {
  previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  testCacheDir = mkdtempSync(join(tmpdir(), "hf-font-order-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = testCacheDir;
});

afterAll(() => {
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(testCacheDir, { recursive: true, force: true });
});

const fetchImpl = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://fonts.googleapis.com/")) {
    return new Response(
      `@font-face { font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/order/${process.pid}.woff2) format('woff2'); }`,
      { status: 200 },
    );
  }
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
}) as typeof fetch;

let familySequence = 0;
function family(): string {
  familySequence += 1;
  return `OrderTestFont${process.pid}${familySequence}`;
}

async function inject(html: string): Promise<string> {
  return injectDeterministicFontFaces(html, { fetchImpl, allowSystemFontCapture: false });
}

// A stylesheet declared after the deterministic faces wins the cascade for the same family
// whenever it has loaded, so early frames could differ between render workers.
const link = (name: string) =>
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${name}" />`;
const style = (name: string) => `<style>body { font-family: "${name}", sans-serif; }</style>`;

describe("deterministic font faces come after every stylesheet", () => {
  it.each([
    [
      "a Google Fonts link in the head",
      (n: string) => `<head>${link(n)}${style(n)}</head><body>text</body>`,
    ],
    [
      "a stylesheet link in the body",
      (n: string) => `<head>${style(n)}</head><body>text${link(n)}</body>`,
    ],
  ])("follows %s", async (_case, page) => {
    const result = await inject(`<!doctype html><html>${page(family())}</html>`);

    const injected = result.indexOf("data-hyperframes-deterministic-fonts");
    expect(injected).toBeGreaterThan(-1);
    expect(injected).toBeGreaterThan(result.indexOf("fonts.googleapis.com/css2"));
    expect(injected).toBeGreaterThan(result.indexOf("<style>body"));
  });
});
