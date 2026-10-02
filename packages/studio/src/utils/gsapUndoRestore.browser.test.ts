// Real Chrome: the box GSAP and a stylesheet translate produce together is what no DOM emulation computes.
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser } from "puppeteer-core";
import { build } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { findSystemChrome } from "../../vite.browser";
import { writeFixture } from "../../tests/e2e/edit-accuracy/grid.mjs";

const require = createRequire(import.meta.url);
const CROP = "inset(0px 40px 0px 0px)";
// Real Chrome on a loaded Windows runner exceeds Vitest's 5s test and 10s hook defaults.
const CHROME_MS = 60_000;
let browser: Browser;
let undoBundle: string;

beforeAll(async () => {
  const executablePath = findSystemChrome();
  if (!executablePath) throw new Error("no Chrome found: set HYPERFRAMES_BROWSER_PATH");
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const out = await build({
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: { canvas: fileURLToPath(new URL("../shims/canvasBrowserStub.js", import.meta.url)) },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("./gsapUndoRestore.ts", import.meta.url)),
        formats: ["iife"],
        name: "hfUndo",
      },
    },
  });
  undoBundle = (Array.isArray(out) ? out[0]! : (out as { output: [{ code: string }] })).output[0]
    .code;
}, CHROME_MS);

afterAll(() => browser?.close(), CHROME_MS);

it.each([
  { gsap: "hold", placement: "px", rotation: 0 },
  { gsap: "tween", placement: "px", rotation: 0 },
  { gsap: "tween", placement: "xpercent", rotation: 30 },
])("an undone crop leaves a $gsap $placement r$rotation layer where it was", async (spec) => {
  const dir = join(mkdtempSync(join(tmpdir(), "undo-gsap-")), "case");
  writeFixture({ gesture: "crop", nesting: "root", zoom: 100, ...spec }, dir);
  const restored = readFileSync(join(dir, "index.html"), "utf8");
  const previous = restored.replace(
    `<div id="target"`,
    `<div id="target" style="clip-path: ${CROP}"`,
  );
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.on("request", (request) =>
    request.url().endsWith("/gsap.min.js")
      ? request.respond({ body: readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8") })
      : request.continue(),
  );
  await page.setContent(restored, { waitUntil: "load" });
  await page.evaluate(readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8"));
  await page.waitForFunction(() => "__player" in window);
  await page.evaluate(undoBundle);

  const box = () =>
    page.evaluate(() => {
      const { left, top, width, height } = document
        .getElementById("target")!
        .getBoundingClientRect();
      return [left, top, width, height].map((n) => Math.round(n * 100) / 100);
    });
  await page.evaluate(() =>
    (window as unknown as { __player: { seek(t: number): void } }).__player.seek(1),
  );
  const before = await box();
  const outcome = await page.evaluate(
    (files, crop) => {
      document.getElementById("target")!.style.setProperty("clip-path", crop);
      const undo = (window as unknown as { hfUndo: typeof import("./gsapUndoRestore") }).hfUndo;
      const iframe = { contentDocument: document, contentWindow: window } as HTMLIFrameElement;
      return undo.applyUndoRestoreToPreview(iframe, "index.html", files, 1, () => {});
    },
    { "index.html": { previous, restored } },
    CROP,
  );

  expect(outcome).toBe("soft");
  expect(await box()).toEqual(before);
  await page.close();
}, CHROME_MS);
