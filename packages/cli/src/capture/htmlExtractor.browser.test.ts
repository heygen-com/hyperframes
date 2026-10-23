import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { extractHtml } from "./htmlExtractor.js";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#c33"/></svg>`;

let browser: Browser;
let page: Server;
let images: Server;
const held: ServerResponse[] = [];
const port = (server: Server) => (server.address() as AddressInfo).port;

beforeAll(async () => {
  images = createServer((req, res) => {
    // The image loads without an Origin header; only extractHtml's in-page fetch sends one.
    if (req.url?.startsWith("/stuck/") && req.headers.origin) {
      held.push(res);
      return;
    }
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" });
    res.end(SVG);
  });
  page = createServer((req, res) => {
    // /canvas: CORS images drawn to a canvas. /fetch and /stuck: tainted images, so extractHtml
    // falls back to fetching them; /stuck's fetch never answers.
    const kind = req.url?.slice(1) ?? "";
    const imgs = [1, 2, 3]
      .map(
        (n) =>
          `<img${kind === "canvas" ? ' crossorigin="anonymous"' : ""} src="http://127.0.0.1:${port(images)}/${kind}/${n}.svg">`,
      )
      .join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><body>${imgs}</body></html>`);
  });
  await Promise.all(
    [images, page].map((s) => new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve))),
  );
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}, 60_000);

afterAll(async () => {
  for (const res of held) res.destroy();
  for (const s of [page, images]) {
    s.closeAllConnections();
    s.close();
  }
  await browser?.close();
});

async function extract(kind: string, opts: { budget?: number; timeBudgetMs?: number } = {}) {
  const tab = await browser.newPage();
  await tab.goto(`http://127.0.0.1:${port(page)}/${kind}`, { waitUntil: "networkidle0" });
  const warnings: string[] = [];
  const startedAt = Date.now();
  const { bodyHtml } = await extractHtml(tab, {
    settleTime: 0,
    inlineImageBudgetChars: opts.budget,
    timeBudgetMs: opts.timeBudgetMs,
    onWarning: (message) => warnings.push(message),
  });
  const elapsedMs = Date.now() - startedAt;
  await tab.close();
  const inlined = [...bodyHtml.matchAll(/src="(data:image\/[^"]+)"/g)].map((m) => m[1]!.length);
  return { bodyHtml, inlined, warnings, elapsedMs };
}

it.each(["canvas", "fetch"])(
  "inlines %s-path images into page.html until the byte budget runs out",
  async (kind) => {
    const all = await extract(kind);
    expect(all.inlined).toHaveLength(3);
    expect(all.warnings).toEqual([]);
    // Room for one image and not a second: the rest keep their absolute URL.
    const capped = await extract(kind, { budget: all.inlined[0]! * 2 - 1 });
    expect(capped.inlined).toHaveLength(1);
    expect(capped.warnings).toEqual([expect.stringContaining("stopped at its")]);
  },
);

it("returns the page's HTML when image inlining outlives the time budget", async () => {
  const { bodyHtml, inlined, warnings, elapsedMs } = await extract("stuck", {
    timeBudgetMs: 1_000,
  });
  expect(inlined).toEqual([]);
  expect(bodyHtml.match(/<img /g)).toHaveLength(3);
  expect(warnings).toEqual([expect.stringContaining("time budget ran out")]);
  // One unanswered fetch alone would hold the step for its 5 s timeout.
  expect(elapsedMs).toBeLessThan(4_500);
}, 30_000);
