import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser();

type Player = HTMLElement & { play(): void; currentTime: number };

/** A sealed player given a same-site composition by URL, as an embedder writes it, with nothing added. */
async function play(fixture: string) {
  const page = await browser.newPage();
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== server.origin) elsewhere.push(url);
  });
  await page.goto(`${server.origin}/host.html?fixture=${fixture}&sealed=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  const error = await page.evaluate(() => window.__playerError ?? null);
  await page.evaluate(() => (document.getElementById("player") as Player).play());
  await page
    .waitForFunction(() => (document.getElementById("player") as Player).currentTime > 0.3, {
      timeout: 10_000,
    })
    .catch(() => {});
  const time = await page.evaluate(() => (document.getElementById("player") as Player).currentTime);
  const iframe = await page.evaluateHandle(
    () => document.getElementById("player")!.shadowRoot!.querySelector("iframe")!,
  );
  const frame = await iframe.asElement()!.contentFrame();
  const inFrame = await frame!.evaluate(() => ({
    origin: window.origin,
    runtimes: [...document.scripts].filter(
      (s) => s.src.includes("hyperframe.runtime") || s.text.includes("__hyperframes"),
    ).length,
    moved: getComputedStyle(document.getElementById("box")!).transform,
  }));
  await page.close();
  return { error, time, elsewhere, ...inFrame };
}

try {
  const bare = await play("direct-timeline");
  assert.equal(bare.error, null, `a sealed composition with no runtime must load: ${bare.error}`);
  assert.equal(bare.origin, "null", "the frame stays sealed");
  assert.ok(bare.time > 0.3, `it plays: currentTime ${bare.time}`);
  assert.notEqual(bare.moved, "none", "its animation runs");
  assert.equal(bare.runtimes, 1, "the player adds the runtime once");
  assert.deepEqual(bare.elsewhere, [], "nothing is fetched from another origin");

  const carried = await play("direct-timeline-runtime");
  assert.equal(
    carried.error,
    null,
    `a sealed composition with its own runtime loads: ${carried.error}`,
  );
  assert.equal(carried.runtimes, 1, "a composition carrying the runtime gets no second copy");
  console.log(
    "[sealed-runtime] a sealed same-site composition plays with the runtime the player ships",
  );
} finally {
  await browser.close();
  await server.stop();
}
