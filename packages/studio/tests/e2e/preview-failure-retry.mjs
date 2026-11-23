#!/usr/bin/env node
// A failed preview's retry button must take a real click: the editing canvas above the stage stands aside.
import assert from "node:assert/strict";
import { launchStudioChrome } from "./chrome-executable.mjs";

const STUDIO_URL = process.env.STUDIO_URL;
if (!STUDIO_URL) {
  console.error("STUDIO_URL is required and must point at a Studio project");
  process.exit(2);
}
const FAILURE = '[data-testid="composition-preview-error"]';
const { browser } = await launchStudioChrome();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("hyperframes-player")?.painted === true, {
    timeout: 60_000,
  });
  // As the player reports a film with no timeline by its load limit.
  await page.evaluate(() =>
    document.querySelector("hyperframes-player").dispatchEvent(
      new CustomEvent("error", {
        detail: { message: "Composition timeline not found after 30s" },
      }),
    ),
  );
  const button = await page.waitForSelector(`${FAILURE} button`, { timeout: 10_000 });
  const box = await button.boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const onTop = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return {
      isRetry: hit?.closest("button")?.closest('[data-testid="composition-preview-error"]') != null,
      hit: `${hit?.tagName.toLowerCase()} ${hit?.getAttribute("aria-label") ?? ""}`.trim(),
    };
  }, center);
  console.log(JSON.stringify({ topAtRetry: onTop.hit }));
  assert.ok(onTop.isRetry, `a click at the retry button lands on ${onTop.hit}`);

  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(
    () =>
      new URL(
        document.querySelector("hyperframes-player").getAttribute("src"),
        location.origin,
      ).searchParams.has("_hfStudioRetry"),
    { timeout: 10_000 },
  );
  await page.waitForFunction(() => document.querySelector("hyperframes-player")?.painted === true, {
    timeout: 60_000,
  });
  const canvasBack = await page
    .waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Composition canvas"]')
          ?.classList.contains("pointer-events-auto"),
      { timeout: 10_000 },
    )
    .then(
      () => true,
      () => false,
    );
  assert.ok(canvasBack, "the editing canvas takes clicks again once the retried preview shows");
  console.log("preview failure retry: ok");
} finally {
  await browser.close();
}
