#!/usr/bin/env node

import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const PROJECT_ID = "smoke-test";
export const SMOKE_COMPOSITION_HTML =
  '<!doctype html><html><body><div data-composition-id="root" data-width="1920" ' +
  'data-height="1080" data-duration="1" data-start="0"><div class="clip" ' +
  'data-hf-id="title" data-start="0" data-duration="1">Test</div></div></body></html>';
const SMOKE_THUMBNAIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9"/></svg>';

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function text(body, contentType = "text/plain") {
  return { status: 200, contentType, body };
}

const PROJECT_PATH = `/api/projects/${PROJECT_ID}`;
const GET_RESPONSES = new Map([
  [
    "/api/projects",
    json({ projects: [{ id: PROJECT_ID, dir: "/tmp/smoke-test", title: "Smoke test" }] }),
  ],
  [
    PROJECT_PATH,
    json({
      id: PROJECT_ID,
      dir: "/tmp/smoke-test",
      title: "Smoke test",
      files: ["index.html"],
      compositions: ["index.html"],
    }),
  ],
  [`${PROJECT_PATH}/preview`, text(SMOKE_COMPOSITION_HTML, "text/html")],
  [`${PROJECT_PATH}/thumbnail/index.html`, text(SMOKE_THUMBNAIL_SVG, "image/svg+xml")],
  [`${PROJECT_PATH}/renders`, json({ renders: [] })],
  [`${PROJECT_PATH}/lint`, json({ findings: [] })],
  [`${PROJECT_PATH}/selection`, json({ selection: null, updatedAt: null })],
  ["/api/registry/blocks", json([])],
  ["/api/fonts", json({ fonts: [] })],
  ["/api/fonts/google", json({ fonts: [] })],
  ["/api/assets/global", json({ assets: [] })],
  // Studio asks this on load so it can warn before Export instead of failing
  // at encode time. A usable encoder is the case this smoke run wants: the
  // interesting assertion is that the shell mounts clean, not that a blocking
  // notice renders. The notice has its own tests.
  ["/api/environment/ffmpeg", json({ ok: true })],
]);
const MUTATION_RESPONSES = new Map([
  [`${PROJECT_PATH}/selection`, json({ ok: true, selection: null, updatedAt: null })],
]);

function projectFileResponse(pathname) {
  if (!pathname.startsWith(`${PROJECT_PATH}/files/`)) return undefined;
  const filename = decodeURIComponent(pathname.split("/files/")[1] ?? "");
  return json({
    filename,
    content: filename === "index.html" ? SMOKE_COMPOSITION_HTML : "",
  });
}

function projectPreviewResponse(pathname) {
  if (!pathname.startsWith(`${PROJECT_PATH}/preview/`)) return undefined;
  return pathname.endsWith("/.media/manifest.jsonl")
    ? text("", "application/x-ndjson")
    : text(SMOKE_COMPOSITION_HTML, "text/html");
}

function gsapAnimationsResponse(pathname) {
  if (!pathname.startsWith(`${PROJECT_PATH}/gsap-animations/`)) return undefined;
  return json({ animations: [], timelineVar: "tl", preamble: "", postamble: "" });
}

function getStudioSmokeResponse(pathname) {
  return (
    GET_RESPONSES.get(pathname) ??
    projectFileResponse(pathname) ??
    projectPreviewResponse(pathname) ??
    gsapAnimationsResponse(pathname)
  );
}

function studioSmokeApiPathResponse(method, pathname) {
  return method === "GET"
    ? (getStudioSmokeResponse(pathname) ?? null)
    : (MUTATION_RESPONSES.get(pathname) ?? null);
}

export function studioSmokeApiResponse(method, requestUrl) {
  const { pathname } = new URL(requestUrl);
  return pathname.startsWith("/api/") ? studioSmokeApiPathResponse(method, pathname) : undefined;
}

// CI renders Studio's system font stack with Linux's fallback, which sets the default tab labels
// about 10px narrower than macOS does; keep that much room so a strip that fits here fits on a Mac.
const MAC_FONT_ALLOWANCE_PX = 10;

/** Runs in the page: the strip's tabs, plus the allowance, must fit before its action slot. */
function clippedStrip(index, allowance) {
  const strip = document.querySelectorAll(".dv-tabs-container")[index];
  const actions = strip
    .closest(".dv-tabs-and-actions-container")
    ?.querySelector(".dv-right-actions-container");
  const room =
    (actions?.getBoundingClientRect().left ?? Infinity) - strip.getBoundingClientRect().left;
  if (strip.scrollWidth + allowance <= room) return null;
  const labels = [...strip.querySelectorAll(".dv-tab")].map((tab) => tab.textContent);
  return `${labels.join(", ")}: ${strip.scrollWidth}px of tabs in ${Math.floor(room)}px`;
}

/** Every dock strip gives its tabs the whole width it can, and fits them while its group is active. */
async function dockStripErrors(page) {
  const found = [];
  const reservedSlots = await page.$$eval(
    ".dv-groupview.dv-inactive-group .dv-right-actions-container",
    (slots) => slots.filter((slot) => slot.getBoundingClientRect().width > 0).length,
  );
  if (reservedSlots > 0) {
    found.push(`${reservedSlots} inactive dock strips hold width for actions they do not draw`);
  }
  const shownTabs = await page.$$(".dv-tabs-container .dv-active-tab");
  for (const [index, tab] of shownTabs.entries()) {
    // An active group draws its strip actions, so this is the least room its tabs get.
    await tab.click();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const clipped = await page.evaluate(clippedStrip, index, MAC_FONT_ALLOWANCE_PX);
    if (clipped) {
      found.push(
        `Dock tab strip clips a label at the default layout (${MAC_FONT_ALLOWANCE_PX}px macOS allowance): ${clipped}`,
      );
    }
  }
  return found;
}

export function isExpectedStudioSmokeError(message) {
  return message.includes("favicon.ico");
}

async function loadPuppeteer() {
  const requireFromProducer = createRequire(join(ROOT, "packages", "producer", "package.json"));
  return requireFromProducer("puppeteer");
}

export async function runStudioRuntimeSmoke(targetUrl) {
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  // Studio's default layout is sized for a laptop window; the tab-strip check below depends on it.
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  const unmockedApiRequests = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const response = studioSmokeApiResponse(request.method(), request.url());
    if (response === undefined) {
      void request.continue();
      return;
    }
    if (response === null) {
      unmockedApiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      void request.respond(json({ error: "unmocked smoke endpoint" }, 501));
      return;
    }
    void request.respond(response);
  });

  try {
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const errorBoundary = await page.evaluate(() => {
      const textContent = document.body.innerText;
      return textContent.includes("Something went wrong") ? textContent : null;
    });
    if (errorBoundary) errors.push(`React error boundary triggered: ${errorBoundary}`);
    errors.push(...(await dockStripErrors(page)));
  } finally {
    await browser.close();
  }

  const fatal = errors.filter((error) => !isExpectedStudioSmokeError(error));
  const failures = [
    ...new Set(unmockedApiRequests.map((request) => `unmocked API request: ${request}`)),
    ...fatal,
  ];
  if (failures.length > 0) {
    throw new Error(
      `Studio runtime smoke failed:\n${failures.map((error) => `- ${error}`).join("\n")}`,
    );
  }
}

async function main() {
  const targetUrl = process.argv[2] ?? "http://localhost:5199/#project=smoke-test";
  await runStudioRuntimeSmoke(targetUrl);
  console.log("PASS: studio loaded with schema-valid API fixtures and no runtime errors");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
