import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Frame } from "puppeteer";

const inline = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), "utf8").replace(/<\/script/gi, "<\\/script");
const RUNTIME = inline("../../../core/dist/hyperframe.runtime.iife.js");
const GSAP = inline("../../../core/node_modules/gsap/dist/gsap.min.js");

// Marks when the runtime starts waiting for layout, which the page cannot otherwise see.
const WATCH = `ResizeObserver.prototype.observe = ((observe) => function (...args) {
  window.__waitsForLayout = true; return observe.apply(this, args); })(ResizeObserver.prototype.observe);`;

const COMPOSITION = `<!doctype html><html><head>
<style>#t { position: absolute; left: 0; top: 0; width: 10px; height: 10px; translate: 40px 30px; }</style>
<script>${WATCH}</script><script>${RUNTIME}</script></head><body>
<div data-composition-id="main" data-start="0" data-duration="2" data-width="320" data-height="180"><div id="t"></div></div>
<script type="text/hf-after-fonts">${GSAP}</script>
<script type="text/hf-after-fonts">
  window.__timelines = { main: gsap.timeline({ paused: true }).from("#t", { x: -60, duration: 1 }) };
  window.__ran = true;
</script></body></html>`;

type FrameWindow = {
  __ran?: boolean;
  __waitsForLayout?: boolean;
  gsap: { getProperty: (t: string, p: string) => number };
};

describe("composition scripts in a frame with no layout yet", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function frameIn(display: string): Promise<{ frame: Frame; show: () => Promise<void> }> {
    const page = await browser.newPage();
    await page.setContent(
      `<iframe id="f" style="display: ${display}; width: 320px; height: 180px"></iframe>`,
    );
    const frame = page.frames()[1]!;
    await frame.setContent(COMPOSITION);
    return {
      frame,
      show: () => page.$eval("#f", (el) => void ((el as HTMLElement).style.display = "block")),
    };
  }

  const y = (frame: Frame) =>
    frame.evaluate(() => (window as unknown as FrameWindow).gsap.getProperty("#t", "y"));

  // fails without the fix: GSAP parsed the element before the frame had layout and cached the stylesheet
  // translate as 0, so a sealed preview drew the layer 30 px high and a drag saved from there.
  it("run once the frame is laid out, so GSAP keeps the stylesheet translate", async () => {
    const { frame, show } = await frameIn("none");
    await frame.waitForFunction(() => {
      const w = window as unknown as FrameWindow;
      return w.__ran || w.__waitsForLayout;
    });
    await show();
    await frame.waitForFunction(() => (window as unknown as FrameWindow).__ran === true);
    expect(await y(frame)).toBe(30);
  });

  it("run without waiting when the frame already has layout", async () => {
    const { frame } = await frameIn("block");
    await frame.waitForFunction(() => (window as unknown as FrameWindow).__ran === true);
    expect(
      await frame.evaluate(() => (window as unknown as FrameWindow).__waitsForLayout),
    ).toBeUndefined();
    expect(await y(frame)).toBe(30);
  });
});
