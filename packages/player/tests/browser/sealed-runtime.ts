import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HTTPRequest } from "puppeteer-core";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const PLAYER_DIST = join(import.meta.dirname, "../../dist");
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
  const read = await page.evaluate(() =>
    document.getElementById("player")!.shadowRoot!.querySelector("iframe")!.hasAttribute("srcdoc"),
  );
  await page.close();
  return { error, time, elsewhere, read, ...inFrame };
}

/** A page with its scripts inlined, as a CLI render carries the runtime: a sealed srcdoc can't fetch loopback files. */
async function inlinedScripts(path: string): Promise<string> {
  const read = async (url: string) => (await fetch(`${server.origin}${url}`)).text();
  let html = await read(path);
  for (const src of ["/vendor/gsap.min.js", "/vendor/hyperframe.runtime.iife.js"]) {
    const code = (await read(src)).replace(/<\/script/gi, "<\\/script");
    html = html.replace(` src="${src}"></script>`, () => `>${code}</script>`);
  }
  return html;
}

async function playAsModule(sealed: boolean, load: { src: string } | { srcdocFrom: string }) {
  const page = await browser.newPage();
  const asked: string[] = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    asked.push(path);
    const options = sealed ? ' sandbox-origin="opaque"' : "";
    if (path === "/module-host.html") {
      void request.respond({
        contentType: "text/html",
        body: `<!doctype html><script type="module" src="/module/hyperframes-player.js"></script>
<hyperframes-player id="player"${options} width="640" height="360" muted></hyperframes-player>`,
      });
    } else if (path.startsWith("/module/")) {
      void request.respond({
        contentType: "text/javascript",
        body: readFileSync(join(PLAYER_DIST, path.slice("/module/".length))),
      });
    } else void request.continue();
  });
  await page.goto(`${server.origin}/module-host.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => customElements.get("hyperframes-player") !== undefined);
  const srcdoc = "srcdocFrom" in load ? await inlinedScripts(load.srcdocFrom) : null;
  const outcome = await page.evaluate(
    (src, html) =>
      new Promise<string>((resolve) => {
        const el = document.getElementById("player")!;
        el.addEventListener("ready", () => resolve("ready"));
        el.addEventListener("error", (e) => resolve(String((e as CustomEvent).detail?.message)));
        if (html === null) el.setAttribute("src", src!);
        else el.setAttribute("srcdoc", html);
      }),
    "src" in load ? load.src : null,
    srcdoc,
  );
  let time = 0;
  if (outcome === "ready") {
    await page.evaluate(() => (document.getElementById("player") as Player).play());
    await page
      .waitForFunction(() => (document.getElementById("player") as Player).currentTime > 0.3, {
        timeout: 10_000,
      })
      .catch(() => {});
    time = await page.evaluate(() => (document.getElementById("player") as Player).currentTime);
  }
  await page.close();
  return { outcome, time, readRuntime: asked.includes("/module/hyperframe.runtime.iife.js") };
}

/** Answers from the test server, on either site's name: every answer in a page then comes the same way. */
async function proxy(request: HTTPRequest) {
  const url = new URL(request.url());
  const answer = await fetch(`${server.origin}${url.pathname}${url.search}`);
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "access-control-allow-origin"]) {
    const value = answer.headers.get(name);
    if (value) headers[name] = value;
  }
  await request.respond({
    status: answer.status,
    headers,
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

/**
 * Site A answers its page with a redirect to site B, which grants no cross-origin reads (a media route that
 * redirects to a storage URL): what one load of the player costs, and whether it plays.
 */
async function playRedirected(sealed: boolean, film: string) {
  const page = await browser.newPage();
  const asked = { a: 0, b: 0 };
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url === film) asked.b++;
    if (url.endsWith("/redirect-host.html")) {
      void request.respond({
        contentType: "text/html",
        body: `<!doctype html><style>hyperframes-player { display: block; width: 640px; }</style>
<script src="/player/hyperframes-player.global.js"></script>
<hyperframes-player id="player"${sealed ? ' sandbox-origin="opaque"' : ""} width="640" height="360" muted
  src="/media/doc.html"></hyperframes-player>
<script>document.getElementById("player").addEventListener("ready", () => (window.__playerReady = true));</script>`,
      });
    } else if (url === `${server.origin}/media/doc.html`) {
      asked.a++;
      void request.respond({ status: 307, headers: { location: film } });
    } else void proxy(request);
  });
  await page.goto(`${server.origin}/redirect-host.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__playerReady, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => (document.getElementById("player") as Player).play());
  await page
    .waitForFunction(() => (document.getElementById("player") as Player).currentTime > 0.3, {
      timeout: 10_000,
    })
    .catch(() => {});
  const time = await page.evaluate(() => (document.getElementById("player") as Player).currentTime);
  const read = await page.evaluate(() =>
    document.getElementById("player")!.shadowRoot!.querySelector("iframe")!.hasAttribute("srcdoc"),
  );
  await page.close();
  return { ...asked, errors, time, read };
}

try {
  const bare = await play("direct-timeline");
  assert.equal(bare.error, null, `a sealed composition with no runtime must load: ${bare.error}`);
  assert.equal(bare.origin, "null", "the frame stays sealed");
  assert.ok(bare.time > 0.3, `it plays: currentTime ${bare.time}`);
  assert.notEqual(bare.moved, "none", "its animation runs");
  assert.equal(bare.runtimes, 1, "the player adds the runtime once");
  assert.equal(bare.read, true, "a same-site page is read and shown as srcdoc");
  assert.deepEqual(bare.elsewhere, [], "nothing is fetched from another origin");

  const carried = await play("direct-timeline-runtime");
  assert.equal(
    carried.error,
    null,
    `a sealed composition with its own runtime loads: ${carried.error}`,
  );
  assert.equal(carried.runtimes, 1, "a composition carrying the runtime gets no second copy");
  // fails without the fix: the ES build's bare runtime import can't resolve without a bundler.
  for (const load of [
    { src: "/fixtures/direct-timeline/index.html" },
    { srcdocFrom: "/fixtures/direct-timeline-runtime/index.html" },
  ]) {
    const open = await playAsModule(false, load);
    const sealed = await playAsModule(true, load);
    assert.equal(open.outcome, "ready", `unsealed, the module page plays ${JSON.stringify(load)}`);
    assert.equal(sealed.outcome, "ready", `sealed, it plays as unsealed: ${sealed.outcome}`);
    assert.ok(sealed.time > 0.3, `sealed, it plays: currentTime ${sealed.time}`);
    assert.equal(
      sealed.readRuntime,
      "src" in load,
      "only a composition without its own runtime reads the file beside the module",
    );
  }
  // fails without the fix: a redirect to another site without CORS logged a blocked fetch on every sealed load.
  const offSite = `${server.origin.replace("127.0.0.1", "localhost")}/fixtures-no-cors/direct-timeline-runtime/index.html`;
  const open = await playRedirected(false, offSite);
  const sealed = await playRedirected(true, offSite);
  const within = await playRedirected(true, `${server.origin}/fixtures/direct-timeline/index.html`);
  console.log(
    `[sealed-runtime] redirect off-site: unsealed ${JSON.stringify(open)}, sealed ${JSON.stringify(sealed)}`,
  );
  console.log(`[sealed-runtime] redirect within the site: sealed ${JSON.stringify(within)}`);
  assert.ok(open.time > 0.3 && sealed.time > 0.3, "both play the redirected composition");
  assert.deepEqual(sealed.errors, open.errors, "sealed logs what unsealed logs");
  assert.equal(
    sealed.read,
    false,
    "an off-site redirect is not read, so the frame loads it by address",
  );
  assert.ok(
    within.read,
    "a same-site redirect is still followed and read, so the runtime is inlined",
  );
  assert.ok(within.time > 0.3, `and it plays: ${within.time}`);
  assert.deepEqual(within.errors, [], "and logs nothing");
  console.log(
    "[sealed-runtime] a sealed same-site composition plays with the runtime the player ships",
  );
} finally {
  await browser.close();
  await server.stop();
}
