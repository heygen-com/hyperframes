#!/usr/bin/env node
// A text edited in place shows a caret on screen: the preview is drawn scaled, so the browser's own caret shrinks
// below a pixel. Layout, focus and media queries only exist in a real browser, so this measures it in Chrome.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launchStudioChrome } from "./chrome-executable.mjs";

const STUDIO_URL = process.env.STUDIO_URL;
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const NEAR_PX = 1.5;

if (!STUDIO_URL) {
  console.error("STUDIO_URL is required and must point at the inline-text-caret fixture");
  process.exit(2);
}
if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
const { browser } = await launchStudioChrome();
const failures = [];
const evidence = {};
const check = (ok, what) => ok || failures.push(what);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** The drawn caret's box on screen, and the box the preview's own selection maps to there. */
const read = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe");
    const doc = frame?.contentDocument;
    const selection = doc?.getSelection();
    const caret = document.querySelector("[data-inline-text-caret]");
    const box = frame.getBoundingClientRect();
    const scale = box.width / frame.contentWindow.innerWidth;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rects = range ? [...range.getClientRects()] : [];
    const at = rects.at(-1);
    const drawn = caret?.getBoundingClientRect();
    return {
      editing: Boolean(doc?.querySelector("[contenteditable]")),
      collapsed: selection?.isCollapsed ?? null,
      caret: drawn && {
        left: drawn.left,
        top: drawn.top,
        width: drawn.width,
        height: drawn.height,
      },
      animation: caret ? getComputedStyle(caret).animationName : null,
      expected: at && {
        left: box.left + at.left * scale,
        top: box.top + at.top * scale,
        height: at.height * scale,
      },
    };
  });

/** Where an element of the composition stands on Studio's screen. */
const onScreen = (page, selector) =>
  page.evaluate((selector) => {
    const frame = document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe");
    const box = frame.getBoundingClientRect();
    const scale = box.width / frame.contentWindow.innerWidth;
    const rect = frame.contentDocument.querySelector(selector).getBoundingClientRect();
    return {
      x: box.left + rect.left * scale,
      y: box.top + rect.top * scale,
      w: rect.width * scale,
      h: rect.height * scale,
    };
  }, selector);

async function openEdit(page, selector, xFraction) {
  const at = await onScreen(page, selector);
  // The middle of the element: its edges hold the selection box's resize handles once the first press picks it.
  await page.mouse.click(at.x + at.w * xFraction, at.y + at.h / 2, { clickCount: 2 });
  for (let i = 0; i < 50 && !(await read(page)).caret; i++) await pause(100);
}

const standsOnSelection = ({ caret, expected }) =>
  Boolean(caret && expected) &&
  Math.abs(caret.left + caret.width / 2 - expected.left) <= NEAR_PX &&
  Math.abs(caret.top - expected.top) <= NEAR_PX;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document
        .querySelector("hyperframes-player")
        ?.shadowRoot?.querySelector("iframe")
        ?.contentDocument?.querySelector("#body"),
    { timeout: 60_000 },
  );
  await pause(1000);

  await openEdit(page, "#title", 0.5);
  evidence.opened = await read(page);
  check(evidence.opened.editing, "a double-click opens the Title for editing");
  check(
    evidence.opened.caret?.width === 2,
    `the caret is 2 px wide on screen: ${evidence.opened.caret?.width}`,
  );
  check(
    evidence.opened.caret?.height > 8,
    `the caret is a line tall on screen: ${evidence.opened.caret?.height}`,
  );
  check(standsOnSelection(evidence.opened), "the caret stands where the selection is");
  check(evidence.opened.animation === "hf-inline-text-caret-blink", "the caret blinks");

  await page.keyboard.type("!");
  evidence.typed = await read(page);
  check(evidence.typed.caret?.left > evidence.opened.caret?.left, "typing moves the caret on");
  check(standsOnSelection(evidence.typed), "after typing, the caret stands where the selection is");

  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  evidence.selecting = await read(page);
  check(!evidence.selecting.caret, "no caret while a range is selected");
  await page.keyboard.press("ArrowRight");
  evidence.collapsedAgain = await read(page);
  check(
    standsOnSelection(evidence.collapsedAgain),
    "an arrow key collapses the range and the caret is back",
  );
  await page.keyboard.press("Escape");
  await pause(500);
  check(!(await read(page)).caret, "no caret once the edit ends");

  // The paragraph wraps onto three lines: End on the middle one stands at its end, not at the next line's start.
  await openEdit(page, "#body", 0.2);
  await page.keyboard.press("Home");
  const lineStart = await read(page);
  await page.keyboard.press("End");
  evidence.lineEnd = await read(page);
  check(
    standsOnSelection(evidence.lineEnd),
    "at a wrapped line's end the caret stands where the selection is",
  );
  check(
    Math.abs(evidence.lineEnd.caret?.top - lineStart.caret?.top) <= NEAR_PX,
    "End keeps the caret on its line",
  );
  await page.keyboard.press("ArrowDown");
  evidence.nextLine = await read(page);
  check(
    evidence.nextLine.caret?.top > evidence.lineEnd.caret?.top,
    "ArrowDown moves the caret down a line",
  );
  check(
    standsOnSelection(evidence.nextLine),
    "on the next line the caret stands where the selection is",
  );

  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  evidence.reduced = await read(page);
  check(evidence.reduced.animation === "none", "under reduced motion the caret does not blink");
  if (EVIDENCE_DIR)
    await page.screenshot({ path: join(EVIDENCE_DIR, "inline-text-caret-multiline.png") });
  await page.keyboard.press("Escape");
  await pause(500);

  await openEdit(page, "#title", 0.5);
  if (EVIDENCE_DIR)
    await page.screenshot({ path: join(EVIDENCE_DIR, "inline-text-caret-title.png") });
  await page.evaluate(() =>
    document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe").blur(),
  );
  await page.mouse.click(5, 5);
  await pause(500);
  check(!(await read(page)).caret, "no caret once the text loses focus");
} finally {
  await browser.close();
}
console.log(JSON.stringify({ evidence, failures }, null, 2));
if (failures.length > 0) process.exit(1);
