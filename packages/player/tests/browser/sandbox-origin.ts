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

  // fails without the fix: the old document's timeline, landing after a switch, made the new load skip its probe.
  const switched = await browser.newPage();
  await switched.evaluateOnNewDocument(() => {
    addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source === "hf-preview" && data.type === "timeline")
        (window as { __lastTimeline?: unknown }).__lastTimeline = data;
    });
  });
  await switched.goto(`${server.origin}/host.html?fixture=gsap-heavy`, {
    waitUntil: "domcontentloaded",
  });
  await switched.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  await switched.evaluate(() => {
    (window as { __lastTimeline?: unknown }).__lastTimeline = undefined;
    document.querySelector("hyperframes-player")!.setAttribute("sandbox-origin", "opaque");
  });
  // The sealed document's own timeline, which comes after its static ready: the one a switch leaves behind.
  await switched.waitForFunction(
    () => (window as { __lastTimeline?: unknown }).__lastTimeline !== undefined,
    { timeout: 15_000 },
  );
  const lateError = await switched.evaluate(async () => {
    const w = window as { __lastTimeline?: unknown; __playerError?: string };
    const player = document.querySelector("hyperframes-player")!;
    const frame = player.shadowRoot!.querySelector("iframe")!;
    w.__playerError = undefined;
    player.setAttribute("src", "/fixtures/sandbox-probe/index.html");
    dispatchEvent(
      new MessageEvent("message", { data: w.__lastTimeline, source: frame.contentWindow }),
    );
    const started = performance.now();
    while (performance.now() - started < 14_000 && w.__playerError === undefined)
      await new Promise((resolve) => setTimeout(resolve, 100));
    return w.__playerError ?? null;
  });
  assert.ok(
    lateError,
    "a sealed player switched to a film with no runtime must fail, even after a late old timeline",
  );
} finally {
  await browser.close();
  await server.stop();
}
