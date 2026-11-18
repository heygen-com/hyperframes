import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser();

try {
  const page = await browser.newPage();
  await page.goto(`${server.origin}/host.html?fixture=sandbox-probe`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 1);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    false,
    "a default player must seal the composition away from the embedding page",
  );

  await page.evaluate(() => {
    const player = document.querySelector("hyperframes-player");
    player?.setAttribute("sandbox-origin", "same-origin");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 2);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    true,
    "sandbox-origin=same-origin must reload into the page's origin",
  );

  await page.evaluate(() => {
    const player = document.querySelector("hyperframes-player");
    player?.setAttribute("sandbox-origin", "Same-Origin");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 3);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    false,
    "any other sandbox-origin value must reload sealed",
  );

  await page.evaluate(() => {
    const player = document.querySelector("hyperframes-player");
    player?.setAttribute("sandbox-origin", "same-origin");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 4);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    true,
    "returning to same-origin must reload into the page's origin",
  );

  await page.evaluate(() => {
    const player = document.querySelector("hyperframes-player");
    player?.removeAttribute("sandbox-origin");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 5);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    false,
    "removing sandbox-origin must reload sealed",
  );
} finally {
  await browser.close();
  await server.stop();
}
