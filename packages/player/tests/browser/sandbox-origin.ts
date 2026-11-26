import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

// Linux's 30 s load limit, as on CI, plus slack: every wait for an error that comes at the limit.
const PAST_LOAD_LIMIT_MS = 36_000;
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
    await page.waitForFunction(() => window.__playerError !== undefined, {
      timeout: PAST_LOAD_LIMIT_MS,
    });
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
  assert.match(
    openCrossSite.error,
    /^Composition timeline not found after \d+s\. A player can't add the HyperFrames runtime to a composition from another site: include the runtime script in it\.$/,
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
      // A once-listener that installs the next one while the first error dispatches: the second error is heard.
      const replaced = document.createElement("hyperframes-player");
      replaced.setAttribute("sandbox-origin", "");
      replaced.addEventListener(
        "error",
        () => {
          heard.push("first");
          replaced.addEventListener("error", () => heard.push("second"), { once: true });
        },
        { once: true },
      );
      replaced.setAttribute("src", url);
      document.body.appendChild(replaced);
      // A callback removed and added again, then the first registration's signal aborts. Engines differ on whether
      // that drops the new registration; either way the error reaches it or warns.
      const readded = document.createElement("hyperframes-player");
      readded.setAttribute("sandbox-origin", "");
      const first = new AbortController();
      const listen = () => heard.push("readded");
      readded.addEventListener("error", listen, { signal: first.signal });
      readded.removeEventListener("error", listen);
      readded.addEventListener("error", listen);
      first.abort();
      readded.setAttribute("src", url);
      document.body.appendChild(readded);
      Object.assign(window, {
        __again: () => {
          once.setAttribute("src", `${url}?again`);
          replaced.setAttribute("src", `${url}?again`);
        },
      });
    },
    `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/direct-timeline/index.html`,
  );
  const heardAll = (...names: string[]) =>
    listenerPage
      .waitForFunction(
        (wanted: string[]) =>
          wanted.every((name) => (window as { __heard?: string[] }).__heard?.includes(name)),
        { timeout: PAST_LOAD_LIMIT_MS },
        names,
      )
      .catch(async (error: unknown) => {
        const heard = await listenerPage.evaluate(() => (window as { __heard?: string[] }).__heard);
        throw new Error(
          `waited for ${names.join(", ")}; heard ${JSON.stringify(heard)}, warned ${unheard.length}`,
          {
            cause: error,
          },
        );
      });
  await heardAll("once", "first");
  await listenerPage.evaluate(() => (window as { __again?: () => void }).__again?.());
  await heardAll("second");
  for (let waited = 0; unheard.length < 2 && waited < 15_000; waited += 250)
    await new Promise((resolve) => setTimeout(resolve, 250));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const heard =
    (await listenerPage.evaluate(() => (window as { __heard?: string[] }).__heard)) ?? [];
  assert.equal(
    unheard.length,
    heard.includes("readded") ? 2 : 3,
    "every error either reached a listener or warned, never both",
  );
  assert.deepEqual(heard.filter((name) => name !== "readded").sort(), ["first", "once", "second"]);
  assert.ok(
    unheard.every((text) => !text.includes("index.html")),
    "the warning carries no composition URL",
  );
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
    const playerFrame = () =>
      document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe")
        ?.contentWindow;
    addEventListener("message", (event) => {
      if (event.source !== playerFrame()) return;
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
      // Linux's 30 s load limit, as on CI, plus slack.
      while (performance.now() - started < 36_000 && w.__playerError === undefined)
        await new Promise((resolve) => setTimeout(resolve, 100));
      return w.__playerError ?? null;
    },
    `${server.origin.replace("127.0.0.1", "localhost")}/fixtures/sandbox-probe/index.html`,
  );
  assert.ok(
    lateError,
    "a sealed player switched to a film with no runtime must fail, even after a late old timeline",
  );
  // fails without the fix: a click inside a sealed film let the film take the screen.
  const fullscreenAfterClick = async (sealed: boolean) => {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      const playerFrame = () =>
        document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe")
          ?.contentWindow;
      const w = window as { __fullscreen?: string[] };
      w.__fullscreen = [];
      addEventListener("message", (event) => {
        if (event.source !== playerFrame()) return;
        if (event.data?.source === "hf-fullscreen-probe") w.__fullscreen!.push(event.data.result);
      });
    });
    await page.goto(
      `${server.origin}/host.html?fixture=fullscreen-probe${sealed ? "&sealed=1" : ""}`,
      { waitUntil: "domcontentloaded" },
    );
    const results = () => page.evaluate(() => (window as { __fullscreen?: string[] }).__fullscreen);
    await page.waitForFunction(() =>
      (window as { __fullscreen?: string[] }).__fullscreen?.includes("loaded"),
    );
    await page.evaluate(() =>
      document.querySelector("hyperframes-player")!.setAttribute("interactive", ""),
    );
    const box = await (await page.$("hyperframes-player"))!.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForFunction(
      () => ((window as { __fullscreen?: string[] }).__fullscreen?.length ?? 0) >= 2,
    );
    const result = (await results())!.at(-1);
    await page.close();
    return result;
  };
  assert.equal(await fullscreenAfterClick(false), "granted", "an unsealed film keeps fullscreen");
  assert.notEqual(
    await fullscreenAfterClick(true),
    "granted",
    "a click inside a sealed film must not let it go fullscreen",
  );
} finally {
  await browser.close();
  await server.stop();
}
