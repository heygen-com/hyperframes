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
async function read(page) {
  const seen = await page.evaluate(() => {
    const frame = document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe");
    const doc = frame.contentDocument;
    const selection = doc.getSelection();
    const rects = selection.rangeCount ? [...selection.getRangeAt(0).getClientRects()] : [];
    const caret = document.querySelector("[data-inline-text-caret]");
    return {
      editing: doc.querySelector("[contenteditable]") !== null,
      collapsed: selection.isCollapsed,
      box: frame.getBoundingClientRect().toJSON(),
      scale: frame.getBoundingClientRect().width / frame.contentWindow.innerWidth,
      at: rects.at(-1)?.toJSON() ?? null,
      drawn: caret && {
        box: caret.getBoundingClientRect().toJSON(),
        animation: getComputedStyle(caret).animationName,
      },
    };
  });
  const { box, scale, at, drawn } = seen;
  return {
    editing: seen.editing,
    collapsed: seen.collapsed,
    caret: drawn && {
      left: drawn.box.left,
      top: drawn.box.top,
      width: drawn.box.width,
      height: drawn.box.height,
    },
    animation: drawn ? drawn.animation : null,
    expected: at && {
      left: box.left + at.left * scale,
      top: box.top + at.top * scale,
      height: at.height * scale,
    },
  };
}

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

// One press selects the element and Enter opens its text with the caret at the end: Studio's dependable way in, where
// a double press has to survive the canvas' gesture machinery.
async function openEdit(page, selector) {
  const at = await onScreen(page, selector);
  await page.mouse.click(at.x + at.w / 2, at.y + at.h / 2);
  await pause(600);
  await page.keyboard.press("Enter");
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

  await openEdit(page, "#title");
  evidence.opened = await read(page);
  check(evidence.opened.editing, "a press and Enter open the Title for editing");
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
  // The player rescales the iframe by a transform, which the iframe's own size never shows.
  await page.setViewport({ width: 1200, height: 800 });
  await pause(500);
  evidence.resized = await read(page);
  check(
    standsOnSelection(evidence.resized),
    "after the window resizes, the caret stands where the selection is",
  );
  await page.setViewport({ width: 1440, height: 900 });
  await pause(500);
  await page.keyboard.press("Escape");
  await pause(500);
  check(!(await read(page)).caret, "no caret once the edit ends");

  // Enter puts the caret after the last child; past a <strong> that is an element boundary, which has no box.
  await openEdit(page, "#mixed");
  evidence.boundary = await read(page);
  const bold = await onScreen(page, "#mixed strong");
  check(
    Math.abs(
      evidence.boundary.caret?.left + evidence.boundary.caret?.width / 2 - (bold.x + bold.w),
    ) <= NEAR_PX,
    `past a bold word the caret stands at its end: ${evidence.boundary.caret?.left} for ${bold.x + bold.w}`,
  );
  await page.keyboard.press("Escape");
  await pause(500);

  // The paragraph wraps onto three lines: End on the middle one stands at its end, not at the next line's start.
  await openEdit(page, "#body");
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
  // Shift+Enter at the end opens an empty line, which has no box either: the caret stands at its start.
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  evidence.emptyLine = await read(page);
  const body = await onScreen(page, "#body");
  check(
    evidence.emptyLine.caret?.top > evidence.nextLine.caret?.top &&
      Math.abs(evidence.emptyLine.caret?.left + evidence.emptyLine.caret?.width / 2 - body.x) <=
        NEAR_PX,
    `on an empty line the caret stands at its start: ${JSON.stringify(evidence.emptyLine.caret)} for ${body.x}`,
  );

  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  evidence.reduced = await read(page);
  check(evidence.reduced.animation === "none", "under reduced motion the caret does not blink");
  if (EVIDENCE_DIR)
    await page.screenshot({ path: join(EVIDENCE_DIR, "inline-text-caret-multiline.png") });
  await page.keyboard.press("Escape");
  await pause(500);

  await openEdit(page, "#title");
  const { caret } = await read(page);
  if (EVIDENCE_DIR && caret) {
    const clip = { x: caret.left - 80, y: caret.top - 16, width: 160, height: caret.height + 32 };
    await page.screenshot({ path: join(EVIDENCE_DIR, "after-caret.png"), clip });
    // What the preview showed without this change: the browser's own caret, the drawn one hidden.
    await page.evaluate(() => {
      document.querySelector("[data-inline-text-caret]").style.visibility = "hidden";
      const frame = document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe");
      frame.contentDocument.querySelector("#title").style.caretColor = "";
    });
    await page.screenshot({ path: join(EVIDENCE_DIR, "before-caret.png"), clip });
    await page.screenshot({ path: join(EVIDENCE_DIR, "inline-text-caret-title.png") });
  }
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
