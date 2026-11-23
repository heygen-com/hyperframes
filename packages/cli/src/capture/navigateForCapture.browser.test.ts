import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { documentRequestSent, unfinishedPageLoadRequests } from "./navigateForCapture.js";

let browser: Browser;
let held: ServerResponse | undefined;
let requested: () => void = () => undefined;
const server = createServer((req, res) => {
  if (req.url === "/with-script") {
    res.end('<script src="/held.js"></script><p>page</p>');
    return;
  }
  held = res;
  requested();
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}, 60_000);

afterAll(async () => {
  const closed = once(server.close(), "close");
  server.closeAllConnections();
  await Promise.all([browser?.close(), closed]);
});

it("settles when Chrome sends the document request, before the server answers", async () => {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const serverGotRequest = new Promise<void>((resolve) => (requested = resolve));
  const sent = documentRequestSent(cdp);
  const navigation = page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
    waitUntil: "domcontentloaded",
    timeout: 0,
  });
  await serverGotRequest;
  await sent;
  held?.end("<p>page</p>");
  await navigation;
  expect(await page.content()).toContain("page");
  await page.close();
});

it("settles for a page answered by interception, which never reaches the network", async () => {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await page.setRequestInterception(true);
  page.on("request", (request) =>
    request.respond({ status: 200, contentType: "text/html", body: "<p>answered</p>" }),
  );
  const sent = documentRequestSent(cdp);
  await page.goto("http://in-process.invalid/", { waitUntil: "domcontentloaded", timeout: 0 });
  await sent;
  expect(await page.content()).toContain("answered");
  await page.close();
});

it("lists a page's script while it is still loading, and drops it once it arrives", async () => {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const scriptRequested = new Promise<void>((resolve) => (requested = resolve));
  const unfinished = unfinishedPageLoadRequests(cdp);
  const scriptSeenByChrome = new Promise<void>((resolve) =>
    cdp.on("Network.requestWillBeSent", ({ request }) => {
      if (request.url.endsWith("/held.js")) resolve();
    }),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const navigation = page.goto(`${origin}/with-script`, {
    waitUntil: "domcontentloaded",
    timeout: 0,
  });
  await Promise.all([scriptRequested, scriptSeenByChrome]);
  expect(unfinished()).toContain(`${origin}/held.js`);
  const scriptDone = new Promise<void>((resolve) =>
    cdp.on("Network.loadingFinished", () => {
      if (!unfinished().includes(`${origin}/held.js`)) resolve();
    }),
  );
  held?.end("window.__held = true;");
  await Promise.all([navigation, scriptDone]);
  expect(unfinished()).not.toContain(`${origin}/held.js`);
  await page.close();
});
