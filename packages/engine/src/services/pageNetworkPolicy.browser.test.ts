import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { restrictPageNetwork } from "./pageNetworkPolicy.js";
import { closeTestChrome, launchTestChrome, listenOnLoopback } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

// Chrome dials these names where the rules say; the policy decides from `answers`, its own resolver.
const answers: Record<string, string[]> = {
  "private.hf-test": ["127.0.0.1"],
  "meta.hf-test": ["169.254.169.254"],
  "public.hf-test": ["8.8.8.8"],
};
let flakyLookups = 0;
const resolveHost = async (host: string) => {
  // Fails its first lookup only, like a passing DNS blip.
  if (host === "flaky.hf-test" && flakyLookups++ === 0) throw new Error(`EAI_AGAIN ${host}`);
  if (host === "flaky.hf-test") return ["8.8.4.4"];
  const found = answers[host];
  if (!found) throw new Error(`ENOTFOUND ${host}`);
  return found;
};

function serve(handler: (path: string) => { type: string; body: string }): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://site").pathname;
    if (path.startsWith("/redirect/")) {
      res.writeHead(302, { location: decodeURIComponent(path.slice("/redirect/".length)) });
      return void res.end();
    }
    const { type, body } = handler(path);
    res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
    res.end(body);
  });
}

describe.skipIf(!hasBrowser)("restrictPageNetwork in Chrome", () => {
  let browser: Browser;
  let site: Server;
  let other: Server;
  let siteOrigin: string;
  let otherPort: string;
  const otherHits: string[] = [];
  let page: Page | undefined;

  beforeAll(async () => {
    site = serve((path) =>
      path === "/worker.js"
        ? {
            type: "text/javascript",
            body: "fetch(self.location.search.slice(1)).then(() => postMessage('ok'), () => postMessage('refused'));",
          }
        : path === "/asset.txt"
          ? { type: "text/plain", body: "asset" }
          : { type: "text/html", body: "<!doctype html><title>site</title>" },
    );
    other = createServer((req, res) => {
      otherHits.push(req.url ?? "/");
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
      res.end("secret");
    });
    siteOrigin = await listenOnLoopback(site);
    otherPort = new URL(await listenOnLoopback(other)).port;
    // The render browser runs frames in-process (no site isolation); mirror that.
    browser = await launchTestChrome(chromePath, [
      "--disable-features=IsolateOrigins,site-per-process",
      "--host-resolver-rules=MAP private.hf-test 127.0.0.1, MAP public.hf-test 127.0.0.1, MAP flaky.hf-test 127.0.0.1, MAP meta.hf-test 169.254.169.254",
    ]);
  });
  afterEach(async () => {
    await page?.close();
    page = undefined;
    otherHits.length = 0;
  });
  afterAll(async () => {
    await closeTestChrome(browser);
    site?.close();
    other?.close();
  });

  async function openRestricted(refused: string[]): Promise<Page> {
    page = await browser.newPage();
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText.startsWith("net::ERR_BLOCKED_BY_CLIENT"))
        refused.push(request.url());
    });
    await restrictPageNetwork(page, siteOrigin, resolveHost);
    await page.goto(`${siteOrigin}/`, { waitUntil: "load" });
    return page;
  }

  const fetchText = (target: Page, url: string) =>
    target.evaluate(
      (u) =>
        fetch(u).then(
          (r) => r.text(),
          () => "refused",
        ),
      url,
    );

  it("lets the page load from its own server", async () => {
    const restricted = await openRestricted([]);
    expect(await fetchText(restricted, `${siteOrigin}/asset.txt`)).toBe("asset");
  });

  it("refuses another local port, by address and by a name that resolves to it", async () => {
    const refused: string[] = [];
    const restricted = await openRestricted(refused);
    expect(await fetchText(restricted, `http://127.0.0.1:${otherPort}/by-address`)).toBe("refused");
    expect(await fetchText(restricted, `http://private.hf-test:${otherPort}/by-name`)).toBe(
      "refused",
    );
    expect(otherHits).toEqual([]);
    expect(refused).toEqual([
      `http://127.0.0.1:${otherPort}/by-address`,
      `http://private.hf-test:${otherPort}/by-name`,
    ]);
  });

  it("refuses link-local addresses, by address and by name, without waiting on them", async () => {
    const refused: string[] = [];
    const restricted = await openRestricted(refused);
    const started = Date.now();
    expect(await fetchText(restricted, "http://169.254.169.254/")).toBe("refused");
    expect(await fetchText(restricted, "http://meta.hf-test/")).toBe("refused");
    expect(await fetchText(restricted, "http://2852039166/")).toBe("refused");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(refused).toEqual([
      "http://169.254.169.254/",
      "http://meta.hf-test/",
      "http://169.254.169.254/",
    ]);
  });

  it("refuses frames and workers too", async () => {
    const restricted = await openRestricted([]);
    await restricted.evaluate(
      (src) =>
        new Promise<void>((resolve) => {
          const frame = document.createElement("iframe");
          frame.onload = frame.onerror = () => resolve();
          frame.src = src;
          document.body.append(frame);
          setTimeout(resolve, 2_000);
        }),
      `http://127.0.0.1:${otherPort}/frame`,
    );
    const fromWorker = await restricted.evaluate(
      (src) =>
        new Promise<string>((resolve) => {
          const worker = new Worker(src);
          worker.onmessage = (event) => resolve(String(event.data));
          worker.onerror = () => resolve("worker failed to start");
        }),
      `${siteOrigin}/worker.js?http://127.0.0.1:${otherPort}/worker`,
    );
    expect(fromWorker).toBe("refused");
    expect(otherHits).toEqual([]);
  });

  it("refuses a redirect from its own server to another local port", async () => {
    const restricted = await openRestricted([]);
    const target = `http://127.0.0.1:${otherPort}/redirected`;
    expect(
      await fetchText(restricted, `${siteOrigin}/redirect/${encodeURIComponent(target)}`),
    ).toBe("refused");
    expect(otherHits).toEqual([]);
  });

  it("allows a name that resolves to a public address", async () => {
    const restricted = await openRestricted([]);
    expect(await fetchText(restricted, `http://public.hf-test:${otherPort}/public`)).toBe("secret");
    expect(otherHits).toEqual(["/public"]);
  });

  it("asks again after a lookup fails, rather than refusing the host for the rest of the page", async () => {
    const restricted = await openRestricted([]);
    expect(await fetchText(restricted, `http://flaky.hf-test:${otherPort}/first`)).toBe("refused");
    expect(await fetchText(restricted, `http://flaky.hf-test:${otherPort}/second`)).toBe("secret");
    expect(otherHits).toEqual(["/second"]);
  });

  it("refuses a name it cannot resolve", async () => {
    const refused: string[] = [];
    const restricted = await openRestricted(refused);
    expect(await fetchText(restricted, `http://unknown.hf-test:${otherPort}/x`)).toBe("refused");
    expect(refused).toEqual([`http://unknown.hf-test:${otherPort}/x`]);
  });
});
