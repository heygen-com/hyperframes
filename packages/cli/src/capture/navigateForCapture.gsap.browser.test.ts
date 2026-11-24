import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { gsapCdnDist } from "@hyperframes/core/gsap-cdn";
import { ensureBrowser } from "../browser/manager.js";
import { gotoWhenSent } from "./navigateForCapture.js";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PAGE = `<!doctype html><script src="${gsapCdnDist()}gsap.min.js"></script><img id="pic" src="/pic.png">`;

const server = createServer((req, res) => {
  const pic = req.url === "/pic.png";
  res.setHeader("Content-Type", pic ? "image/png" : "text/html");
  res.end(pic ? PIXEL : PAGE);
});
let browser: Browser;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1"],
  });
}, 60_000);

afterAll(async () => {
  const closed = once(server.close(), "close");
  server.closeAllConnections();
  await Promise.all([browser?.close(), closed]);
});

async function expectGsapAndPicture(page: Page): Promise<void> {
  await page.waitForFunction("document.getElementById('pic')?.complete", { timeout: 10_000 });
  expect(await page.evaluate("typeof window.gsap")).toBe("object");
  expect(await page.evaluate("document.getElementById('pic').naturalWidth")).toBe(1);
}

it("loads bundled GSAP and the page's own media while the CDN is unreachable", async () => {
  const page = await browser.newPage();
  await gotoWhenSent(page, `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, 20_000);
  await expectGsapAndPicture(page);
  await page.close();
});

it("does the same on a page whose own requests puppeteer interception answers, as a snapshot runs it", async () => {
  const origin = "http://in-process.invalid";
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const target = new URL(request.url());
    if (target.origin !== origin) return void request.continue().catch(() => {});
    const pic = target.pathname === "/pic.png";
    void request
      .respond({
        status: 200,
        contentType: pic ? "image/png" : "text/html",
        body: pic ? PIXEL : PAGE,
      })
      .catch(() => {});
  });
  await gotoWhenSent(page, `${origin}/`, 20_000);
  await expectGsapAndPicture(page);
  await page.close();
});
