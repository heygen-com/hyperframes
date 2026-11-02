import { spawnSync } from "node:child_process";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { beginFrameCapture } from "./screenshotService.js";
import { closeTestChrome } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;
const INTERVAL = 1000 / 30;
const options = { width: 160, height: 90, fps: { num: 30, den: 1 }, format: "jpeg" as const };

describe.skipIf(!hasBrowser)("beginFrameCapture reuse", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--deterministic-mode",
        "--enable-begin-frame-control",
        "--disable-new-content-rendering-timeout",
        "--run-all-compositor-stages-before-draw",
      ],
    });
  }, 30_000);
  afterAll(() => closeTestChrome(browser));

  it("reuses a frame only when the page reports no change, never a stale one", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 160, height: 90 });
    await page.setContent(
      `<body style="margin:0"><div id="b" style="width:160px;height:90px;background:#f00"></div></body>`,
    );
    const grab = (tick: number) => beginFrameCapture(page, options, tick * INTERVAL, INTERVAL);
    const paint = (color: string) =>
      page.evaluate(
        (c) => ((document.getElementById("b") as HTMLElement).style.background = c),
        color,
      );

    // The first ticks after load may still report paint settling; reuse starts once it ends.
    let tick = 1;
    let last = await grab(tick);
    expect(last.hasDamage).toBe(true);
    let held = await grab(++tick);
    while (held.hasDamage && tick < 8) {
      last = held;
      held = await grab(++tick);
    }
    expect(held.hasDamage).toBe(false);
    expect(held.buffer.equals(last.buffer)).toBe(true);
    const first = held;

    await paint("#00f");
    const changed = await grab(++tick);
    expect(changed.hasDamage).toBe(true);
    expect(changed.buffer.equals(first.buffer)).toBe(false);
    await page.close();
  }, 30_000);
});
