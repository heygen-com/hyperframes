import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";

const INLINE_ONLY_POLICY = `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'">`;

describe("bundled local scripts under a page policy that allows inline scripts only", () => {
  let browser: Browser;
  let dir: string;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    dir = mkdtempSync(join(tmpdir(), "hf-bundle-policy-"));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head>${INLINE_ONLY_POLICY}
<style>
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(100px); } }
  #box.go { animation: slide 2s linear both; }
</style>
</head><body>
<div data-composition-id="root" data-start="0" data-duration="2" data-width="320" data-height="180">
  <div id="box"></div>
</div>
<script defer src="main.js"></script>
<script>window.ORDER = ["classic"];</script>
</body></html>`,
    );
    writeFileSync(
      join(dir, "main.js"),
      `window.ORDER.push("deferred"); document.getElementById("box").classList.add("go");`,
    );
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a local defer script after the classic scripts and animates", async () => {
    const page = await browser.newPage();
    const blocked: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
    });
    await page.setContent(await bundleToSingleHtml(dir));
    await page.waitForFunction(
      () => (window as unknown as { __playerReady?: boolean }).__playerReady === true,
    );

    const result = await page.evaluate(() => {
      const runtimeWindow = window as unknown as {
        ORDER?: string[];
        __player?: { renderSeek?: (timeSeconds: number) => void };
      };
      runtimeWindow.__player?.renderSeek?.(1);
      const animation = document.getElementById("box")?.getAnimations()[0];
      return { order: runtimeWindow.ORDER, animationTime: Number(animation?.currentTime) };
    });

    expect(blocked).toEqual([]);
    expect(result).toEqual({ order: ["classic", "deferred"], animationTime: 1000 });
  });
});
