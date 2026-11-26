#!/usr/bin/env bun
// bun run --cwd packages/studio test:edit-accuracy:frames -- --chrome <full Chrome>: frame reads in both modes.
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { resolveHeadlessShellPath } from "../../../../engine/src/index.ts";
import { contentQuad, throttleCpu } from "./case.mjs";
import { quadDistance } from "./geometry.mjs";

const { values: opt } = parseArgs({ options: { chrome: { type: "string" } } });
if (!opt.chrome) {
  console.error("usage: frames-selftest.mjs --chrome <full Chrome>");
  process.exit(2);
}

const MOVE = { x: 37, y: 21, scale: 0.6 };
const BOX = { left: 120, top: 80, width: 200, height: 100 };
const PAGES = {
  "/": `<!doctype html><body style="margin:0"><div style="transform-origin:0 0;transform:translate(${MOVE.x}px,${MOVE.y}px) scale(${MOVE.scale})"><iframe sandbox="allow-scripts" src="/frame.html" style="display:block;width:800px;height:450px;border:0"></iframe></div>`,
  "/frame.html": `<!doctype html><body style="margin:0"><div id="t" style="position:absolute;left:${BOX.left}px;top:${BOX.top}px;width:${BOX.width}px;height:${BOX.height}px;background:#e0b020"></div>`,
};
const server = createServer((req, res) => res.end(PAGES[req.url] ?? "")).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const at = (x, y) => [MOVE.x + MOVE.scale * x, MOVE.y + MOVE.scale * y];
const expected = [
  at(BOX.left, BOX.top),
  at(BOX.left + BOX.width, BOX.top),
  at(BOX.left + BOX.width, BOX.top + BOX.height),
  at(BOX.left, BOX.top + BOX.height),
];

async function read(frames, executablePath) {
  if (frames === "isolated") process.env.PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES = "true";
  else delete process.env.PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    const frame = page.frames().find((f) => f.url().endsWith("/frame.html"));
    const quad = await contentQuad(await frame.$("#t"));
    const own = frame.client !== page.mainFrame().client;
    const spin = () =>
      frame.evaluate(() => {
        const t = performance.now();
        for (let i = 0; i < 3e7; i++);
        return performance.now() - t;
      });
    const before = await spin();
    await throttleCpu(page, 4);
    const slowed = (await spin()) / before;
    return { quad, own, slowed };
  } finally {
    await browser.close();
  }
}

const shared = await read("shared", resolveHeadlessShellPath());
const isolated = await read("isolated", opt.chrome);
server.close();
const checks = [
  ["shared: preview in the page's process", !shared.own],
  ["isolated: preview in its own process", isolated.own],
  [
    `shared quad within 0.5 px (${quadDistance(shared.quad, expected).toFixed(3)})`,
    quadDistance(shared.quad, expected) <= 0.5,
  ],
  [
    `isolated quad within 0.5 px (${quadDistance(isolated.quad, expected).toFixed(3)})`,
    quadDistance(isolated.quad, expected) <= 0.5,
  ],
  [
    `modes agree within 0.5 px (${quadDistance(shared.quad, isolated.quad).toFixed(3)})`,
    quadDistance(shared.quad, isolated.quad) <= 0.5,
  ],
  [`--cpu 4 slows the isolated frame (${isolated.slowed.toFixed(1)}x)`, isolated.slowed >= 2.5],
  [`--cpu 4 slows the shared frame (${shared.slowed.toFixed(1)}x)`, shared.slowed >= 2.5],
];
for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
