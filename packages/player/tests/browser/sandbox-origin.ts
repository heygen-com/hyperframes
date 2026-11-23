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
  // fails without the fix: a sealed player told a cross-site film without the runtime more than an unsealed one.
  const crossSiteFilm = async (sealed: boolean) => {
    const page = await browser.newPage();
    await page.goto(
      `${server.origin}/host.html?fixture=direct-timeline${sealed ? "&sealed=1" : ""}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await page.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
    await page.evaluate(
      (url) => {
        const player = document.querySelector("hyperframes-player")!;
        const events: string[] = [];
        (window as { __events?: string[] }).__events = events;
        for (const type of ["ready", "error", "durationchange", "play"])
          player.addEventListener(type, () => events.push(type));
        window.__playerError = undefined;
        player.setAttribute("src", url);
      },
      `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/direct-timeline/index.html`,
    );
    await page.waitForFunction(() => window.__playerError !== undefined, { timeout: 15_000 });
    return page.evaluate(() => ({
      error: String(window.__playerError),
      events: (window as { __events?: string[] }).__events,
    }));
  };
  const sealedCrossSite = await crossSiteFilm(true);
  const openCrossSite = await crossSiteFilm(false);
  assert.deepEqual(
    sealedCrossSite,
    openCrossSite,
    "a cross-site film without the runtime fails sealed exactly as unsealed",
  );
  assert.equal(
    openCrossSite.error,
    "Composition timeline not found after 8s. A player can't add the HyperFrames runtime to a composition from another site: include the runtime script in it.",
  );

  // fails without the fix: Chrome drops a once or aborted listener without calling removeEventListener, so the
  // player kept counting it and the next unheard error reached no one.
  const listenerPage = await browser.newPage();
  const unheard: string[] = [];
  listenerPage.on("console", (message) => {
    if (message.text().includes("error with no listener")) unheard.push(message.text());
  });
  await listenerPage.goto(`${server.origin}/host.html?fixture=direct-timeline&sealed=1`, {
    waitUntil: "domcontentloaded",
  });
  await listenerPage.waitForFunction(() => window.__playerReady === true, { timeout: 15_000 });
  await listenerPage.evaluate(
    (url) => {
      const heard: string[] = [];
      Object.assign(window, { __heard: heard });
      const once = document.createElement("hyperframes-player");
      once.setAttribute("sandbox-origin", "");
      once.addEventListener("error", () => heard.push("once"), { once: true });
      once.setAttribute("src", url);
      document.body.appendChild(once);
      const aborted = document.createElement("hyperframes-player");
      aborted.setAttribute("sandbox-origin", "");
      const added = new AbortController();
      aborted.addEventListener("error", () => heard.push("aborted"), { signal: added.signal });
      added.abort();
      aborted.setAttribute("src", url);
      document.body.appendChild(aborted);
      Object.assign(window, { __again: () => once.setAttribute("src", `${url}?again`) });
    },
    `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/direct-timeline/index.html`,
  );
  await listenerPage.waitForFunction(
    () => (window as { __heard?: string[] }).__heard?.includes("once") === true,
    { timeout: 15_000 },
  );
  await listenerPage.evaluate(() => (window as { __again?: () => void }).__again?.());
  for (let waited = 0; unheard.length < 2 && waited < 15_000; waited += 250)
    await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    unheard.length,
    2,
    "the aborted listener's error and the once listener's second error both warn",
  );
  assert.deepEqual(await listenerPage.evaluate(() => (window as { __heard?: string[] }).__heard), [
    "once",
  ]);
  await listenerPage.close();

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
  // From another origin, since a same-site film gets the runtime added.
  const lateError = await switched.evaluate(
    async (url) => {
      const w = window as { __lastTimeline?: unknown; __playerError?: string };
      const player = document.querySelector("hyperframes-player")!;
      const frame = player.shadowRoot!.querySelector("iframe")!;
      w.__playerError = undefined;
      player.setAttribute("src", url);
      dispatchEvent(
        new MessageEvent("message", { data: w.__lastTimeline, source: frame.contentWindow }),
      );
      const started = performance.now();
      while (performance.now() - started < 14_000 && w.__playerError === undefined)
        await new Promise((resolve) => setTimeout(resolve, 100));
      return w.__playerError ?? null;
    },
    `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/sandbox-probe/index.html`,
  );
  assert.ok(
    lateError,
    "a sealed player switched to a film with no runtime must fail, even after a late old timeline",
  );
} finally {
  await browser.close();
  await server.stop();
}
