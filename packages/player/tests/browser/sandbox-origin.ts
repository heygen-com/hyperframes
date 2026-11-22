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
    true,
    "the default trusted sandbox should allow same-origin parent access",
  );

  await page.evaluate(() => {
    document.querySelector("hyperframes-player")?.setAttribute("sandbox-origin", "opaque");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 2);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    false,
    "switching a live player to opaque must reload into an isolated origin",
  );

  await page.evaluate(() => {
    document.querySelector("hyperframes-player")?.setAttribute("sandbox-origin", "opaqu");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 3);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    false,
    "an unrecognized non-null policy must remain isolated",
  );

  await page.evaluate(() => {
    document.querySelector("hyperframes-player")?.removeAttribute("sandbox-origin");
  });
  await page.waitForFunction(() => (window.__sandboxProbeResults?.length ?? 0) >= 4);
  assert.equal(
    await page.evaluate(() => window.__sandboxProbeResults?.at(-1)),
    true,
    "removing the policy must reload into the documented trusted mode",
  );
  // A sealed player adds the runtime to a composition from its own site, so the missing-runtime
  // error belongs to one from another origin (localhost against 127.0.0.1).
  const direct = await browser.newPage();
  await direct.goto(`${server.origin}/host.html?fixture=direct-timeline&sealed=1`, {
    waitUntil: "domcontentloaded",
  });
  await direct.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  await direct.evaluate(
    (url) => {
      document.querySelector("hyperframes-player")!.setAttribute("src", url);
    },
    `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/direct-timeline/index.html`,
  );
  await direct.waitForFunction(() => window.__playerError !== undefined, { timeout: 15_000 });
  const sealedError = String(await direct.evaluate(() => window.__playerError));
  assert.match(
    sealedError,
    /include the runtime script/,
    "a sealed timeout must name the runtime script",
  );
  assert.match(sealedError, /without sandbox-origin/, "a sealed timeout must name the trusted way");

  const elsewhere = await browser.newPage();
  await elsewhere.goto(`${server.origin}/host.html?fixture=direct-timeline`, {
    waitUntil: "domcontentloaded",
  });
  await elsewhere.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  await elsewhere.evaluate(
    (url) => {
      document.querySelector("hyperframes-player")!.setAttribute("src", url);
    },
    `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/direct-timeline/index.html`,
  );
  await elsewhere.waitForFunction(() => window.__playerError !== undefined, { timeout: 15_000 });
  assert.doesNotMatch(
    String(await elsewhere.evaluate(() => window.__playerError)),
    /sandbox-origin/,
    "a default player with a composition on another origin is not told it is sealed",
  );

  const trusted = await browser.newPage();
  await trusted.goto(`${server.origin}/host.html?fixture=direct-timeline`, {
    waitUntil: "domcontentloaded",
  });
  await trusted.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  assert.equal(
    await trusted.evaluate(() => window.__playerDuration),
    5,
    "a default player must still add the runtime to a composition that has none",
  );

  const bundled = await browser.newPage();
  await bundled.goto(`${server.origin}/host.html?fixture=direct-timeline-runtime&sealed=1`, {
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
