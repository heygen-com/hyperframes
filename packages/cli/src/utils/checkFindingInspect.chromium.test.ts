import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer-core";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";
import { prepareFindingInspector } from "./checkFindingInspect.js";
import { serveStaticProjectHtml } from "./staticProjectServer.js";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

const INDEX = `<!doctype html>
<html><head><style>#title { color: white; }</style></head>
<body>
  <div id="root" data-composition-id="main" data-width="640" data-height="360" data-duration="2">
    <h1 id="title" data-hf-id="hf-title">Title</h1>
    <div></div><div><p>Outer</p><section><div><div></div><div><p>Inner</p></div></div></section></div>
  </div>
  <script src="gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#title", { x: 100, duration: 1 });
    window.__timelines = { main: tl };
  </script>
</body></html>`;

describe.runIf(executablePath)("finding inspector in Chromium", () => {
  let browser: Browser;
  let dir: string;
  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
    dir = mkdtempSync(join(tmpdir(), "finding-inspect-chromium-"));
    writeFileSync(join(dir, "index.html"), INDEX);
    const core = createRequire(resolve(__dirname, "../../../core/package.json"));
    copyFileSync(core.resolve("gsap/dist/gsap.min.js"), join(dir, "gsap.min.js"));
  });
  afterAll(async () => {
    await browser?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a selector matching multiple elements instead of mixing their sources", async () => {
    const inspector = await prepareFindingInspector(dir, (options) =>
      bundleToSingleHtml(dir, options),
    );
    const server = await serveStaticProjectHtml(dir, inspector.html!);
    const page = await browser.newPage();
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await inspector.ready(server);
      const selector = "div > div:nth-of-type(2) > p";
      expect(await page.$$eval(selector, (elements) => elements.length)).toBe(2);
      expect(await inspector.inspect(page, { selector })).toEqual({
        error: `ambiguous_selector: ${selector} matches multiple elements`,
      });
      const unique = await inspector.inspect(page, { selector: `body > ${selector}` });
      expect(unique).toMatchObject({ results: [{ status: "found", candidates: [{ tag: "p" }] }] });
    } finally {
      await page.close();
      await server.close();
    }
  });

  it("returns the inspector's own report by hfId and by selector, and a missing target as missing", async () => {
    const inspector = await prepareFindingInspector(dir, (options) =>
      bundleToSingleHtml(dir, options),
    );
    expect(inspector.html).toBeDefined();
    const server = await serveStaticProjectHtml(dir, inspector.html!);
    const page = await browser.newPage();
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await inspector.ready(server);
      const byHfId = await inspector.inspect(page, { hfId: "hf-title" });
      const bySelector = await inspector.inspect(page, { selector: "#title" });
      const missing = await inspector.inspect(page, { selector: "#nope" });
      expect(byHfId).not.toHaveProperty("error");
      expect(bySelector).toMatchObject({
        results: [{ status: "found", animations: 1 }],
      });
      const kinds = "snippets" in bySelector ? bySelector.snippets.flatMap((s) => s.kind) : [];
      expect(kinds).toEqual(
        expect.arrayContaining(["html opening tag", "animation creation", "matched CSS candidate"]),
      );
      expect(missing).toMatchObject({ results: [{ status: "missing" }] });
    } finally {
      await page.close();
      await server.close();
    }
  });
});
