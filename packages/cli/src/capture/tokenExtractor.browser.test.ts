import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { extractTokens } from "./tokenExtractor.js";

const RED = "oklch(0.6279554 0.2576833 29.2338851)";
// Tailwind v4 writes its palette in oklch, so every sampled color takes the canvas path.
// Sixty swatches in six colors: each color is sampled many times.
const SWATCHES = Array.from(
  { length: 60 },
  (_, i) =>
    `<div style="height:8px;background:oklch(0.${3 + (i % 6)} 0.15 ${(i % 6) * 40})">x</div>`,
).join("");
const PAGES: Record<string, string> = {
  "/swatches": `<!doctype html><html><body style="background:oklch(1 0 0)">
<h1 style="color:${RED}">Red</h1>${SWATCHES}</body></html>`,
  // No black anywhere on the page: the only #000000 can come from the unparseable variable.
  "/variables": `<!doctype html><html style="color:#123456;background:#abcdef"><head><style>
:root { --brand: ${RED}; --broken: oklch(not a color); }</style></head><body>text</body></html>`,
};

let browser: Browser;
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGES[req.url ?? ""] ?? "");
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}, 60_000);

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await browser?.close();
});

async function tokensOf(path: string) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(`
    window.__contexts2d = [];
    window.__pixelReads = 0;
    var getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === "2d") window.__contexts2d.push(!!(attrs && attrs.willReadFrequently));
      return getContext.call(this, type, attrs);
    };
    var getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      window.__pixelReads++;
      return getImageData.apply(this, arguments);
    };
  `);
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
  const tokens = await extractTokens(page);
  const probes = (await page.evaluate(
    `({ contexts: window.__contexts2d, pixelReads: window.__pixelReads })`,
  )) as { contexts: boolean[]; pixelReads: number };
  await page.close();
  return { tokens, ...probes };
}

it("resolves oklch colors through one CPU-readable canvas, once per distinct color", async () => {
  const { tokens, contexts, pixelReads } = await tokensOf("/swatches");
  expect(contexts).toEqual([true]);
  // Eight distinct oklch colors on the page: red, white and the six swatches.
  expect(pixelReads).toBeLessThanOrEqual(8);
  expect(tokens.colors).toEqual(expect.arrayContaining(["#FF0000", "#FFFFFF"]));
});

it("resolves an unparseable color to the canvas default, not to the color before it", async () => {
  const { tokens } = await tokensOf("/variables");
  expect(tokens.colors).toEqual(expect.arrayContaining(["#FF0000", "#000000"]));
});
