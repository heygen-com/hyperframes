// A sealed preview never keeps the keyboard: when its own script focuses an input in it, the next real key still
// reaches Studio; a real Delete after a canvas click deletes the picked clip. STUDIO_URL: a Studio started with
// VITE_STUDIO_OPAQUE_PREVIEW_ENABLED=1 on the sealed-keyboard fixture, whose folder is STUDIO_PROJECT_DIR.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchStudioChrome } from "./chrome-executable.mjs";

const url = process.env.STUDIO_URL;
const projectDir = process.env.STUDIO_PROJECT_DIR;
assert(
  url && projectDir,
  "STUDIO_URL and STUDIO_PROJECT_DIR must point at a sealed Studio's sealed-keyboard project",
);
const saved = () => readFileSync(join(projectDir, "index.html"), "utf8");
/** A person's click on an element of the preview, mapped through the frame's on-screen scale. */
async function clickInPreview(page, frame, selector) {
  const inFrame = await frame.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: innerWidth };
  }, selector);
  const iframe = await page.evaluateHandle(() =>
    document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe"),
  );
  const box = await iframe.boundingBox();
  const scale = box.width / inFrame.width;
  await page.mouse.click(box.x + inFrame.x * scale, box.y + inFrame.y * scale, { delay: 120 });
}
const { browser } = await launchStudioChrome();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("hyperframes-player")?.painted === true);
  const frame = page.frames().find((f) => /\/preview\/~[\w-]{43}/.test(f.url()));
  assert.ok(frame, "the preview loads under its frame token");
  assert.equal(
    await frame.evaluate(() => String(window.origin)),
    "null",
    "the preview frame is sealed",
  );
  await page.evaluate(() => {
    window.__studioKeys = [];
    addEventListener("keydown", (e) => window.__studioKeys.push(e.key), true);
  });
  const keyboardBackInStudio = () =>
    page.waitForFunction(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el?.tagName !== "IFRAME";
    });
  // The frame's own script puts focus on an ordinary input in it, as a composition may.
  await frame.evaluate(() => document.getElementById("field").focus());
  await keyboardBackInStudio();
  await page.keyboard.press("y");
  await page.waitForFunction(() => window.__studioKeys.includes("y"));
  assert.equal(
    await frame.evaluate(() => document.getElementById("field").value),
    "",
    "the frame got no key",
  );

  // A clip picked on the canvas, then a real Delete: Studio deletes it.
  assert.ok(saved().includes('id="plain"'));
  await clickInPreview(page, frame, "#plain");
  await page.waitForFunction(
    () => new URLSearchParams(location.hash.split("?")[1]).get("selId") === "plain",
  );
  await keyboardBackInStudio();
  await page.keyboard.press("Delete");
  for (let i = 0; i < 100 && saved().includes('id="plain"'); i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(!saved().includes('id="plain"'), "a real Delete after a canvas click deletes the clip");
  console.log(JSON.stringify({ studioKeys: await page.evaluate(() => window.__studioKeys) }));
} finally {
  await browser.close();
}
