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

async function stagePoint(page, id) {
  return page.evaluate((id) => {
    const frame = document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe");
    const el = frame.contentDocument.getElementById(id).getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const scale = box.width / frame.contentWindow.innerWidth;
    return { x: box.x + (el.x + el.width / 2) * scale, y: box.y + (el.y + el.height / 2) * scale };
  }, id);
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

  await open(page, "inline-text-caret");
  const title = await stagePoint(page, "title");
  // One press selects the title and Enter opens its text with the caret at the end, as inline-text-caret.mjs does.
  await page.mouse.click(title.x, title.y);
  await page.waitForFunction(
    () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("selId") === "title",
    { timeout: 10_000 },
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector("hyperframes-player")
        .shadowRoot.querySelector("iframe")
        .contentDocument.querySelector("[contenteditable]") !== null,
    { timeout: 10_000 },
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" kept");
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
