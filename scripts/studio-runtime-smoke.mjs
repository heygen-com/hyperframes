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
  [`${PROJECT_PATH}/renders`, json({ renders: [] })],
  [`${PROJECT_PATH}/lint`, json({ findings: [] })],
  [
    `${PROJECT_PATH}/storyboard`,
    json({
      exists: false,
      path: "STORYBOARD.md",
      globals: { extra: {} },
      frames: [],
      warnings: [],
      script: { exists: false, path: "SCRIPT.md", content: "" },
    }),
  ],
  [`${PROJECT_PATH}/selection`, json({ selection: null, updatedAt: null })],
  ["/api/registry/blocks", json([])],
  ["/api/fonts", json({ fonts: [] })],
  ["/api/fonts/google", json({ fonts: [] })],
  ["/api/assets/global", json({ assets: [] })],
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
