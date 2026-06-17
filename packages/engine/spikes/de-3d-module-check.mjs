// Drive the engine's initThreeDProjectionInPage against a denovo-style
// inline flip card (flip-container inside an h1 text flow) and screenshot
// the page directly — no capture pipeline — to isolate projection bugs.
// Run with bun (TS import): bun spikes/de-3d-module-check.mjs

import puppeteer from "puppeteer";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { initThreeDProjectionInPage } from "../src/services/threeDProjection.ts";

const W = 960, H = 540;

const HTML = `<!doctype html><meta charset=utf-8>
<style>
*{margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:#ece8dd}
#root{position:relative;width:${W}px;height:${H}px;background:#ece8dd}
h1.headline{position:absolute;top:160px;left:0;width:100%;text-align:center;
  font:600 64px serif;color:#1a2640}
.flip-container{display:inline-block;perspective:1000px;vertical-align:baseline;
  height:1.2em;position:relative;min-width:300px}
.flip-card{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.flip-front,.flip-back{position:absolute;width:100%;height:100%;
  backface-visibility:hidden;display:flex;align-items:center;justify-content:center;
  left:0;top:0}
.flip-back{transform:rotateX(-180deg);color:#C8A870;font-style:italic;white-space:nowrap}
</style>
<div id=root data-composition-id="check">
  <h1 class=headline>tools are <span class=flip-container><span class=flip-card id=card>
    <span class=flip-front>agentic workflows</span>
    <span class=flip-back>blind</span>
  </span></span></h1>
</div>
<script>
window.__setAngle = a => {
  document.getElementById("card").style.transform = "rotateX(" + a + "deg)";
};
</script>`;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--no-sandbox", "--use-gl=angle", `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent(HTML, { waitUntil: "load" });
page.on("console", (m) => console.log("[page]", m.text()));

mkdirSync("/tmp/de-3d-module", { recursive: true });

function psnr(a, b) {
  const r = spawnSync("ffmpeg", ["-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"],
    { encoding: "utf8" });
  const m = String(r.stderr).match(/average:([\d.inf]+)/);
  return m ? m[1] : "n/a";
}

const ANGLES = [0, 45, 90, 135, 180];

// refs: real CSS 3D
for (const a of ANGLES) {
  await page.evaluate((x) => window.__setAngle(x), a);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
  writeFileSync(`/tmp/de-3d-module/ref-${a}.png`, await page.screenshot({ type: "png" }));
}

// engine projection
const res = await page.evaluate(initThreeDProjectionInPage);
console.log("init:", JSON.stringify(res));

for (const a of ANGLES) {
  await page.evaluate((x) => {
    window.__setAngle(x);
    window.__hf3d?.update();
  }, a);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
  const out = `/tmp/de-3d-module/proj-${a}.png`;
  writeFileSync(out, await page.screenshot({ type: "png" }));
  console.log(`angle=${a}: psnr=${psnr(`/tmp/de-3d-module/ref-${a}.png`, out)}`);
}

console.log(await browser.version());
await browser.close();
