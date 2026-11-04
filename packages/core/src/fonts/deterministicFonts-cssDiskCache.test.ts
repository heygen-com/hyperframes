// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const FACE_URL = "https://fonts.gstatic.com/s/diskfam/v1/latin.woff2";
const CSS = `/* latin */
@font-face {
  font-family: 'DiskFam';
  font-style: normal;
  font-weight: 400;
  src: url(${FACE_URL}) format('woff2');
  unicode-range: U+0000-00FF;
}`;
const HTML = `<!doctype html><html><head><style>
  h1 { font-family: "DiskFam", sans-serif; }
</style></head><body><h1>Offline</h1></body></html>`;
const quiet = { warn: () => {}, info: () => {} };

let cacheDir: string;
let previousCacheDir: string | undefined;

beforeEach(() => {
  previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "hf-font-css-disk-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = cacheDir;
});

afterEach(() => {
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(cacheDir, { recursive: true, force: true });
});

// A fresh copy of the module is a new process: its lookups held in memory start empty, the disk does not.
async function buildInNewProcess(fetchImpl: typeof fetch): Promise<string> {
  vi.resetModules();
  const { injectDeterministicFontFaces } = await import("./deterministicFonts.js");
  return injectDeterministicFontFaces(HTML, { fetchImpl, logger: quiet });
}

function googleFonts(cssStatus: number, css: string): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("css2")) return new Response(css, { status: cssStatus });
    if (url === FACE_URL) return new Response("DISK_FACE", { status: 200 });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

const offline = vi.fn(async (input: unknown): Promise<Response> => {
  throw new TypeError(`fetch failed: ${String(input)}`);
});

it("builds the same page in a new process without the network once the font cache is warm", async () => {
  const online = googleFonts(200, CSS);
  const first = await buildInNewProcess(online.fetchImpl);
  expect(online.urls.filter((url) => url.includes("css2"))).toHaveLength(1);
  expect(first).toContain(Buffer.from("DISK_FACE").toString("base64"));

  offline.mockClear();
  const second = await buildInNewProcess(offline as unknown as typeof fetch);

  expect(offline).not.toHaveBeenCalled();
  expect(second).toBe(first);
});

it.each([
  { label: "a lookup that named no faces", status: 200, css: "/* no faces */" },
  { label: "a lookup Google refused", status: 503, css: "" },
])("asks the network again in a new process after $label", async ({ status, css }) => {
  await buildInNewProcess(googleFonts(status, css).fetchImpl);

  const again = googleFonts(200, CSS);
  const page = await buildInNewProcess(again.fetchImpl);

  expect(again.urls.filter((url) => url.includes("css2"))).toHaveLength(1);
  expect(page).toContain(Buffer.from("DISK_FACE").toString("base64"));
});
