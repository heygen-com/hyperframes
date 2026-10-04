// Run with: node packages/studio/tests/e2e/motion-path-home.mjs
// Real Chromium and real GSAP: reading where a layer's motion path is anchored must leave the CSS
// translate Studio wrote alone (GSAP's transform parse folds it into `transform`), and happy-dom
// computes no `translate` to show that.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { resolveChromeExecutable } from "./chrome-executable.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const output = mkdtempSync(join(tmpdir(), "motion-path-home-"));
const studio = createRequire(join(root, "packages/studio/package.json"));
const gsapSource = readFileSync(studio.resolve("gsap/dist/gsap.js"), "utf8");
let browser;
try {
  execFileSync(
    "bun",
    [
      "build",
      "packages/studio/src/components/editor/motionPathHome.ts",
      "--target",
      "browser",
      "--outdir",
      output,
    ],
    { cwd: root },
  );
  const homeUrl = `data:text/javascript;base64,${readFileSync(join(output, "motionPathHome.js")).toString("base64")}`;
  browser = await puppeteer.launch({
    executablePath: resolveChromeExecutable(),
    headless: true,
    pipe: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setContent(
    `<body style="margin:0"><div id="stage" style="position:relative;width:1920px;height:1080px"></div></body>`,
  );
  await page.addScriptTag({ content: gsapSource });
  const got = await page.evaluate(async (url) => {
    const { elementHome } = await import(url);
    const layer = (css) => {
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;left:10px;top:10px;width:240px;height:160px;${css}`;
      document.getElementById("stage").append(el);
      return el;
    };
    const plain = layer("translate: 40px 30px");
    const offset = layer(
      "--hf-studio-offset-x: 40px; --hf-studio-offset-y: 30px; translate: var(--hf-studio-offset-x) var(--hf-studio-offset-y)",
    );
    const owned = layer("left: 50%; top: 50%");
    window.gsap.set(owned, { xPercent: -50, yPercent: -50 });
    const read = (el) => {
      const home = elementHome(el);
      return { home, translate: el.style.translate, transform: el.style.transform };
    };
    return { plain: read(plain), offset: read(offset), owned: read(owned) };
  }, homeUrl);

  assert.deepEqual([got.plain.translate, got.plain.transform], ["40px 30px", ""]);
  assert.deepEqual(
    [got.offset.translate, got.offset.transform],
    ["var(--hf-studio-offset-x) var(--hf-studio-offset-y)", ""],
  );
  assert.deepEqual([got.offset.home.x, got.offset.home.y], [10 + 120 + 40, 10 + 80 + 30]);
  const { x, y, ax, ay } = got.owned.home;
  assert.deepEqual([x, y, ax, ay], [960, 540, 0, 0]);
  console.log(
    "motion-path home: plain and var() translates kept; GSAP's xPercent read from its cache",
  );
} finally {
  await browser?.close();
  rmSync(output, { recursive: true, force: true });
}
