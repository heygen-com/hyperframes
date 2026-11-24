#!/usr/bin/env node
// A failed preview's retry button must take a real click, whatever the editing canvas holds above the stage.
import assert from "node:assert/strict";
import { launchStudioChrome } from "./chrome-executable.mjs";

const STUDIO_URL = process.env.STUDIO_URL;
if (!STUDIO_URL) {
  console.error("STUDIO_URL is required and must point at Studio with the e2e fixtures installed");
  process.exit(2);
}
const ORIGIN = new URL(STUDIO_URL).origin;
const FAILURE = '[data-testid="composition-preview-error"]';
const SELECTION_BOX = '[data-dom-edit-selection-box="true"]';
const CANVAS_MENU = "body > div.fixed.z-200";
const TEXT_TOOLBAR = '[role="toolbar"][aria-label="Text formatting"]';

const painted = (page) =>
  page.waitForFunction(() => document.querySelector("hyperframes-player")?.painted === true, {
    timeout: 60_000,
  });

async function open(page, project) {
  await page.goto(`${ORIGIN}/#project/${project}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (project) => {
      const player = document.querySelector("hyperframes-player");
      return (
        player?.getAttribute("src")?.includes(`/projects/${project}/`) && player.painted === true
      );
    },
    { timeout: 60_000 },
    project,
  );
}

// A sealed frame is reached as a frame, never through contentDocument, which Studio's page cannot read.
async function previewFrame(page) {
  const iframe = await page.waitForFunction(
    () => document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe"),
    { timeout: 60_000 },
  );
  return { iframe: iframe.asElement(), frame: await iframe.asElement().contentFrame() };
}

async function stagePoint(page, id) {
  const { iframe, frame } = await previewFrame(page);
  const box = await iframe.boundingBox();
  const el = await frame.evaluate((id) => {
    const rect = document.getElementById(id).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewport: innerWidth };
  }, id);
  const scale = box.width / el.viewport;
  return { x: box.x + (el.x + el.width / 2) * scale, y: box.y + (el.y + el.height / 2) * scale };
}

// As the player reports a film with no timeline by its load limit; then a real click on its retry button.
async function failThenRetry(page) {
  await page.evaluate(() =>
    document.querySelector("hyperframes-player").dispatchEvent(
      new CustomEvent("error", {
        detail: { message: "Composition timeline not found after 30s" },
      }),
    ),
  );
  const button = await page.waitForSelector(`${FAILURE} button`, { timeout: 10_000 });
  const leftOpen = await page.evaluate(
    ({ menu, toolbar }) => ({
      menu: !!document.querySelector(menu),
      toolbar: !!document.querySelector(toolbar),
    }),
    { menu: CANVAS_MENU, toolbar: TEXT_TOOLBAR },
  );
  assert.deepEqual(
    leftOpen,
    { menu: false, toolbar: false },
    "a failed preview leaves no canvas menu or text toolbar open",
  );
  const box = await button.boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const onTop = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return {
      isRetry: hit?.closest("button")?.closest('[data-testid="composition-preview-error"]') != null,
      hit: `${hit?.tagName.toLowerCase()} ${hit?.getAttribute("aria-label") ?? ""}`.trim(),
    };
  }, center);
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
  await painted(page);
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Composition canvas"]')?.closest("[inert]"),
    { timeout: 10_000 },
  );
}

const selectedId = (page) =>
  page.evaluate(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("selId"));

const { browser } = await launchStudioChrome();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await open(page, "fade-handles");
  await failThenRetry(page);
  console.log("nothing selected: retry takes the click");

  await open(page, "aroll-backdrop");
  const aroll = await stagePoint(page, "aroll");
  await page.mouse.click(aroll.x, aroll.y);
  await page.waitForSelector(SELECTION_BOX, { timeout: 10_000 });
  const selected = await selectedId(page);
  assert.equal(selected, "aroll", "the full-frame layer is selected over the stage");
  await failThenRetry(page);
  await page.waitForSelector(SELECTION_BOX, { timeout: 10_000 });
  assert.equal(await selectedId(page), selected, "the selection comes back as after any reload");
  console.log("a selected layer over the stage: retry takes the click, the selection comes back");

  const centre = await page.evaluate(() => {
    const box = document
      .querySelector("hyperframes-player")
      .shadowRoot.querySelector("iframe")
      .getBoundingClientRect();
    return { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 60 };
  });
  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await page.waitForSelector(CANVAS_MENU, { timeout: 10_000 });
  await failThenRetry(page);
  console.log("a canvas menu open over the stage: the failure closes it, retry takes the click");

  await open(page, "inline-text-caret");
  const title = await stagePoint(page, "title");
  // One press selects the title and Enter opens its text with the caret at the end, as inline-text-caret.mjs does.
  await page.mouse.click(title.x, title.y);
  await page.waitForFunction(
    () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("selId") === "title",
    { timeout: 10_000 },
  );
  await page.keyboard.press("Enter");
  await (
    await previewFrame(page)
  ).frame.waitForFunction(() => document.querySelector("[contenteditable]") !== null, {
    timeout: 10_000,
  });
  await page.keyboard.press("End");
  await page.keyboard.type(" kept");
  // The toolbar shows only over a selection, never a bare caret.
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
  await page.waitForSelector(TEXT_TOOLBAR, { timeout: 10_000 });
  await failThenRetry(page);
  const saved = await page.waitForFunction(
    async (origin) => {
      const response = await fetch(`${origin}/api/projects/inline-text-caret/files/index.html`);
      const { content } = await response.json();
      const notice = [...document.querySelectorAll("[data-sonner-toast], [role=status]")].some(
        (toast) => /not saved/i.test(toast.textContent ?? ""),
      );
      return /Title kept</.test(content) ? "saved" : notice ? "refused with a notice" : false;
    },
    { timeout: 15_000, polling: 250 },
    ORIGIN,
  );
  console.log(`a text edit open at the failure: ${await saved.jsonValue()}`);
  console.log("preview failure retry: ok");
} finally {
  await browser.close();
}
