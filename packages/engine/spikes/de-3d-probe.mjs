// Probe: what exactly does drawElementImage get wrong about CSS 3D rendering
// contexts? Mirrors the engine harness: composition root reparented into a
// <canvas layoutsubtree>, captured via drawElementImage(root), PSNR'd against
// a CDP screenshot of the same state.
//
// Variants per flip angle (0/45/90/135/180):
//   whole    perspective + preserve-3d + backface-visibility flip card (gen_os pattern)
//   flatten  same visual but 3D context dismantled: transform-style flat,
//            per-face transform replaced by its ancestor-composed matrix,
//            backfaced faces display:none'd (simulated mitigation)
//
// Run: node spikes/de-3d-probe.mjs

import puppeteer from "puppeteer";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const W = 400, H = 300;

const HTML = `<!doctype html><meta charset=utf-8>
<style>
*{margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:#ece8dd}
#root{position:relative;width:${W}px;height:${H}px;background:#ece8dd}
.headline{position:absolute;top:20px;left:0;width:100%;text-align:center;
  font:700 28px serif;color:#1a2640}
.flip-wrap{position:absolute;top:80px;left:100px;width:200px;height:60px;
  perspective:1000px}
.flip-card{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.face{position:absolute;inset:0;backface-visibility:hidden;
  display:flex;align-items:center;justify-content:center;font:700 24px serif}
.front{background:#1a2640;color:#fff}
.back{background:#c8a870;color:#1a2640;transform:rotateX(-180deg);font-style:italic}
#footer{position:absolute;top:200px;left:0;width:100%;text-align:center;
  font:700 20px serif;color:#406080}
</style>
<div id=root>
  <div class=headline>HEADLINE TEXT</div>
  <div class=flip-wrap id=wrap><div class=flip-card id=card>
    <div class="face front" id=front>FRONT</div>
    <div class="face back" id=back>backface</div>
  </div></div>
  <div id=footer>FOOTER TEXT</div>
</div>
<script>
// Engine-style canvas injection — deferred so references can be captured
// first: children of a layoutsubtree canvas do not paint to the screen, so
// CDP screenshots after injection show a blank page.
window.__injectCanvas = () => {
  const root = document.getElementById("root");
  const canvas = document.createElement("canvas");
  canvas.id = "cap";
  canvas.setAttribute("layoutsubtree", "");
  canvas.width = ${W}; canvas.height = ${H};
  canvas.style.cssText = "display:block;position:absolute;top:0;left:0;z-index:0";
  root.parentNode.insertBefore(canvas, root);
  canvas.appendChild(root);
};

window.__setAngle = (a, variant) => {
  const card = document.getElementById("card");
  const wrap = document.getElementById("wrap");
  const front = document.getElementById("front");
  const back = document.getElementById("back");
  if (variant === "whole") {
    wrap.style.perspective = "1000px";
    card.style.transformStyle = "preserve-3d";
    card.style.transform = "rotateX(" + a + "deg)";
    front.style.transform = ""; front.style.display = "";
    back.style.transform = "rotateX(-180deg)"; back.style.display = "";
  } else {
    // flatten: no 3D context. Each face carries its own full perspective
    // transform; the culled face is display:none.
    wrap.style.perspective = "none";
    card.style.transformStyle = "flat";
    card.style.transform = "";
    const frontVisible = ((a % 360) + 360) % 360 < 90 || ((a % 360) + 360) % 360 > 270;
    front.style.display = frontVisible ? "" : "none";
    back.style.display = frontVisible ? "none" : "";
    front.style.transform = "perspective(1000px) rotateX(" + a + "deg)";
    back.style.transform = "perspective(1000px) rotateX(" + (a - 180) + "deg)";
  }
};
window.__cap = () => {
  const c = document.getElementById("cap");
  const ctx = c.getContext("2d");
  const root = document.getElementById("root");
  try {
    ctx.clearRect(0, 0, ${W}, ${H});
    ctx.drawElementImage(root, 0, 0);
  } catch (e) { return { err: String(e) }; }
  const url = c.toDataURL("image/png");
  ctx.clearRect(0, 0, ${W}, ${H});
  return { url };
};
</script>`;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--no-sandbox", "--enable-features=CanvasDrawElement", "--use-gl=angle",
    `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent(HTML, { waitUntil: "load" });

mkdirSync("/tmp/de-3d-probe", { recursive: true });

function psnr(a, b) {
  const r = spawnSync("ffmpeg",
    ["-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"],
    { encoding: "utf8" });
  const m = String(r.stderr).match(/average:([\d.inf]+)/);
  return m ? m[1] : "n/a";
}

// Phase 1: references — BEFORE canvas injection (layoutsubtree children
// don't paint to screen, so post-injection screenshots are blank).
for (const variant of ["whole", "flatten"]) {
  for (const angle of [0, 45, 90, 135, 180]) {
    await page.evaluate(({ a, v }) => window.__setAngle(a, v), { a: angle, v: variant });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
    writeFileSync(`/tmp/de-3d-probe/ref-${variant}-${angle}.png`,
      await page.screenshot({ type: "png" }));
  }
}

// Phase 2: inject the layoutsubtree canvas, capture via drawElementImage.
await page.evaluate(() => window.__injectCanvas());
for (const variant of ["whole", "flatten"]) {
  for (const angle of [0, 45, 90, 135, 180]) {
    await page.evaluate(({ a, v }) => window.__setAngle(a, v), { a: angle, v: variant });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));

    const r = await page.evaluate(() => window.__cap());
    if (r.err) { console.log(`${variant} angle=${angle}: ERR ${r.err}`); continue; }
    const out = `/tmp/de-3d-probe/cap-${variant}-${angle}.png`;
    writeFileSync(out, Buffer.from(r.url.split(",")[1], "base64"));
    console.log(`${variant} angle=${angle}: psnr=${psnr(`/tmp/de-3d-probe/ref-${variant}-${angle}.png`, out)}`);
  }
}

console.log(await browser.version());
await browser.close();
