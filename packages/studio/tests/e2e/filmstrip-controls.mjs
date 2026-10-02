#!/usr/bin/env node
// Run against a disposable Studio project with editable video and audio clips, both with zero fades.
import assert from "node:assert/strict";
import { launchStudioChrome } from "./chrome-executable.mjs";

const STUDIO_URL = process.env.STUDIO_URL;
assert(STUDIO_URL, "STUDIO_URL must point at the disposable filmstrip fixture");
const { browser } = await launchStudioChrome();
const evidence = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  for (const kind of ["video", "audio"]) {
    const selector =
      kind === "audio"
        ? '.timeline-clip.is-audio:has([data-badge="fx"])'
        : '.timeline-clip:not(.is-audio):has([data-badge="volume"])';
    await page.waitForSelector(selector, { timeout: 60_000 });
    const clip = await page.$(selector);
    await clip.hover();
    const fx = await clip.$('[data-badge="fx"]');
    const handle = await clip.$('[data-testid="clip-fade-handle-out"]');
    assert(fx && handle, `${kind} must expose FX and an editable fade-out handle`);
    assert.equal(await handle.evaluate((node) => node.getAttribute("aria-valuenow")), "0");
    const geometry = await clip.evaluate((node) => {
      const fx = node.querySelector('[data-badge="fx"]');
      const fade = node.querySelector('[data-testid="clip-fade-handle-out"]');
      const f = fx.getBoundingClientRect();
      const h = fade.getBoundingClientRect();
      const c = node.getBoundingClientRect();
      const hit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
      return {
        fxReached: hit === fx || fx.contains(hit),
        fadeBelowFx: h.top >= f.bottom,
        fadeInsideClip: h.bottom <= c.bottom,
        fadeHitHeight: h.height,
      };
    });
    assert(geometry.fxReached, `${kind} FX centre must receive the pointer`);
    assert(geometry.fadeBelowFx, `${kind} fade target must clear FX`);
    assert(geometry.fadeInsideClip, `${kind} fade target must stay inside its clip`);
    assert.equal(geometry.fadeHitHeight, 24);
    const fxBox = await fx.boundingBox();
    await page.mouse.click(fxBox.x + fxBox.width / 2, fxBox.y + fxBox.height / 2);
    await page.waitForSelector('[role="menu"][aria-label="Clip actions"]', { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="menu"][aria-label="Clip actions"]', { hidden: true });
    await clip.hover();
    const fadeBox = await handle.boundingBox();
    const x = fadeBox.x + fadeBox.width / 2;
    const y = fadeBox.y + fadeBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 40, y, { steps: 8 });
    const preview = Number(await handle.evaluate((node) => node.getAttribute("aria-valuenow")));
    assert(preview > 0, `${kind} fade must preview during a pointer drag`);
    await page.mouse.up();
    const saveStatus = await page.evaluate(async () => {
      const { flushStudioPendingEdits } = await import("/src/utils/studioPendingEdits.ts");
      return (await flushStudioPendingEdits()).status;
    });
    assert.equal(saveStatus, "clean", `${kind} fade save must settle successfully`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(selector, { timeout: 60_000 });
    await (await page.$(selector)).hover();
    await page.waitForFunction(
      (selector) => Number(document.querySelector(selector)?.getAttribute("aria-valuenow")) > 0,
      { timeout: 10_000 },
      `${selector} [data-testid="clip-fade-handle-out"]`,
    );
    evidence.push({
      kind,
      ...geometry,
      menuOpened: true,
      fadePreview: preview,
      fadeCommitted: true,
    });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ evidence }, null, 2));
