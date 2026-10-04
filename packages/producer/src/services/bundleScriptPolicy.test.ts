import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";

const INLINE_ONLY_POLICY = `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'">`;
const ROOT = `<div data-composition-id="root" data-start="0" data-duration="2" data-width="320" data-height="180">`;

async function bundled(indexHtml: string, mainJs: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hf-bundle-scripts-"));
  try {
    writeFileSync(join(dir, "index.html"), indexHtml);
    writeFileSync(join(dir, "main.js"), mainJs);
    return await bundleToSingleHtml(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("bundled local scripts in Chrome", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("runs a local defer script after the classic scripts and animates under an inline-only policy", async () => {
    const html = await bundled(
      `<!doctype html><html><head>${INLINE_ONLY_POLICY}
<style>
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(100px); } }
  #box.go { animation: slide 2s linear both; }
</style>
</head><body>
${ROOT}<div id="box"></div></div>
<script defer src="main.js"></script>
<script>window.ORDER = ["classic"];</script>
</body></html>`,
      `window.ORDER.push("deferred"); document.getElementById("box").classList.add("go");`,
    );
    const page = await browser.newPage();
    const blocked: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
    });
    await page.setContent(html);
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

  it("runs a local defer script after the inline module before it", async () => {
    const html = await bundled(
      `<!doctype html><html><head></head><body>
${ROOT}</div>
<script type="module">window.MODULE_RAN = true;</script>
<script defer src="main.js"></script>
</body></html>`,
      "window.SAW_MODULE = window.MODULE_RAN === true;",
    );
    const page = await browser.newPage();
    await page.setContent(html);
    await page.waitForFunction(
      () => (window as unknown as { __playerReady?: boolean }).__playerReady === true,
    );

    expect(
      await page.evaluate(() => (window as unknown as { SAW_MODULE?: boolean }).SAW_MODULE),
    ).toBe(true);
  });

  it("runs a local defer script only after the deferred CDN script before it has loaded", async () => {
    const html = await bundled(
      `<!doctype html><html><head></head><body>
${ROOT}</div>
<script defer src="https://cdn.example/lib.js"></script>
<script defer src="main.js"></script>
</body></html>`,
      "window.SEEN = window.LIB;",
    );
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) =>
      request.url() === "https://cdn.example/lib.js"
        ? request.respond({ contentType: "text/javascript", body: "window.LIB = 'loaded';" })
        : request.continue(),
    );
    await page.setContent(html);
    await page.waitForFunction(
      () => (window as unknown as { __playerReady?: boolean }).__playerReady === true,
    );

    expect(await page.evaluate(() => (window as unknown as { SEEN?: string }).SEEN)).toBe("loaded");
  });
});
