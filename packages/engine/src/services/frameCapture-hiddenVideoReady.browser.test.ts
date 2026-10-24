import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { pollVideosReady } from "./frameCapture.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

describe.skipIf(!hasBrowser)("pollVideosReady and a hidden video", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchTestChrome(chromePath);
  });
  afterAll(async () => {
    await closeTestChrome(browser);
  });

  it("does not wait for a video inside a hidden node, which has no source to decode", async () => {
    const page = await browser.newPage();
    await page.setContent(`<div data-hidden=""><video id="gone"></video></div>`);
    const started = Date.now();
    await expect(pollVideosReady(page, [], 3_000, 20)).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500);
    await page.close();
  }, 15_000);

  it("still waits for a live video that has not decoded", async () => {
    const page = await browser.newPage();
    await page.setContent(`<video id="live"></video>`);
    await expect(pollVideosReady(page, [], 400, 20)).resolves.toBe(false);
    await page.close();
  }, 15_000);
});
