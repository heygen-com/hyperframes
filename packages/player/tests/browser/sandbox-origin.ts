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

  const direct = await browser.newPage();
  await direct.goto(`${server.origin}/host.html?fixture=direct-timeline`, {
    waitUntil: "domcontentloaded",
  });
  await direct.waitForFunction(() => window.__playerError !== undefined, { timeout: 15_000 });
  const sealedError = String(await direct.evaluate(() => window.__playerError));
  assert.match(
    sealedError,
    /include the runtime script/,
    "a sealed timeout must name the runtime script",
  );
  assert.match(
    sealedError,
    /sandbox-origin="same-origin"/,
    "a sealed timeout must name the trusted opt-in",
  );

  const trusted = await browser.newPage();
  await trusted.goto(`${server.origin}/host.html?fixture=direct-timeline`, {
    waitUntil: "domcontentloaded",
  });
  await trusted.evaluate(() => {
    document.querySelector("hyperframes-player")?.setAttribute("sandbox-origin", "same-origin");
  });
  await trusted.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  assert.equal(
    await trusted.evaluate(() => window.__playerDuration),
    5,
    "a trusted player must still add the runtime to a composition that has none",
  );

  const bundled = await browser.newPage();
  await bundled.goto(`${server.origin}/host.html?fixture=direct-timeline-runtime`, {
    waitUntil: "domcontentloaded",
  });
  await bundled.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  assert.equal(
    await bundled.evaluate(() => window.__playerDuration),
    5,
    "a sealed player must play a composition that brings the runtime script",
  );
} finally {
  await browser.close();
  await server.stop();
}
