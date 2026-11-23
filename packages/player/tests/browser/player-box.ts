import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

// An embed that sets no height, only a height, only a width, or both, gets the box it asks for.
const server = startServer({ noCache: true });
const browser = await launchBrowser({ width: 1280, height: 1200 });

type BoxCase = { name: string; width: number; height: number; ok: boolean };

try {
  const page = await browser.newPage();
  await page.goto(`${server.origin}/fixtures/_control/player-box.html`);
  await page.waitForFunction(() => (window as { __box?: unknown }).__box, { timeout: 30_000 });
  const { cases, ratioHeightOnlyWidth } = (await page.evaluate(
    () => (window as { __box?: unknown }).__box,
  )) as { cases: BoxCase[]; ratioHeightOnlyWidth: number };
  console.log(
    `a plain block with aspect-ratio and only a height is ${ratioHeightOnlyWidth}px wide`,
  );
  for (const c of cases) {
    assert(c.ok, `${c.name}: player box is ${c.width}x${c.height}`);
  }
  console.log(`player takes the box its embed asks for (${cases.length} embeds): PASS`);
} finally {
  await browser.close();
  await server.stop();
}
