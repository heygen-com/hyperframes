import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { runPageStep } from "./captureTimeout.js";

let browser: Browser;

beforeAll(async () => {
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

it("frees a page whose step script never returns, so the next step runs", async () => {
  const page = await browser.newPage();
  // Attached before the page is stuck: attaching afterwards waits on the busy page.
  const cdp = await page.createCDPSession();

  const outcome = await runPageStep(() => page.evaluate("while (true) {}"), {
    label: "stuck step",
    stopPageScript: () => cdp.send("Runtime.terminateExecution"),
    capMs: 500,
  });

  expect(outcome).toEqual({ kind: "timed-out", pageAnswered: true });
  const next = await Promise.race([
    page.evaluate("1 + 1"),
    new Promise((resolve) => setTimeout(() => resolve("page still stuck"), 5_000)),
  ]);
  expect(next).toBe(2);
  await page.close();
}, 30_000);
