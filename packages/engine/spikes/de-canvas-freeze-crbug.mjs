// Repro: accelerated (webgl) canvas content freezes at the FIRST frame in
// drawElementImage captures — the canvas's paint record never invalidates
// when the canvas re-renders, because presentation happens via compositor
// texture swap. A 2d canvas shows the same freeze when no unrelated paint
// invalidation occurs nearby.
//
// The page animates a WebGL clear color through hues every frame. On screen
// (and in CDP screenshots, when not wrapped) the canvas cycles colors;
// drawElementImage returns the FIRST captured frame's color forever.
//
// Run: node spikes/de-canvas-freeze-crbug.mjs
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";

const W = 300, H = 200;
const HTML = `<!doctype html><meta charset=utf-8>
<style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;background:#202020}
#root{position:relative;width:${W}px;height:${H}px;background:#202020}
#gl{position:absolute;top:50px;left:50px;width:200px;height:100px}
.label{position:absolute;top:10px;left:0;width:100%;text-align:center;color:#fff;font:700 16px sans-serif}
</style>
<div id=root><div class=label id=label>frame 0</div><canvas id=gl width=200 height=100></canvas></div>
<script>
const gl = document.getElementById("gl").getContext("webgl", { preserveDrawingBuffer: true });
window.__renderFrame = (i) => {
  document.getElementById("label").textContent = "frame " + i;
  const hue = (i * 24) % 360, c = (h) => {
    const f = (n) => { const k = (n + h / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  };
  const [r, g, b] = c(hue);
  gl.clearColor(r, g, b, 1); gl.clear(gl.COLOR_BUFFER_BIT);
};
const root = document.getElementById("root");
const canvas = document.createElement("canvas");
canvas.id = "cap"; canvas.setAttribute("layoutsubtree", "");
canvas.width = ${W}; canvas.height = ${H};
canvas.style.cssText = "display:block;position:absolute;top:0;left:0";
root.parentNode.insertBefore(canvas, root); canvas.appendChild(root);
window.__cap = () => {
  const ctx = canvas.getContext("2d");
  return new Promise((done) => requestAnimationFrame(() => setTimeout(() => {
    try { ctx.clearRect(0, 0, ${W}, ${H}); ctx.drawElementImage(root, 0, 0); }
    catch (e) { return done({ err: String(e) }); }
    // sample the center pixel of the webgl canvas area
    const d = ctx.getImageData(150, 100, 1, 1).data;
    const url = canvas.toDataURL("image/png"); ctx.clearRect(0, 0, ${W}, ${H});
    done({ px: [d[0], d[1], d[2]], url });
  }, 40)));
};
</script>`;

const b = await puppeteer.launch({ headless: true,
  args: ["--no-sandbox", "--enable-features=CanvasDrawElement", "--use-gl=angle", `--window-size=${W},${H}`] });
const p = await b.newPage();
await p.setViewport({ width: W, height: H });
await p.setContent(HTML, { waitUntil: "load" });

const colors = [];
for (let i = 0; i < 10; i++) {
  await p.evaluate((n) => window.__renderFrame(n), i);
  const r = await p.evaluate(() => window.__cap());
  if (r.err) { console.log("f" + i, r.err); break; }
  colors.push(r.px.join(","));
  if (i === 0 || i === 9) writeFileSync(`/tmp/canvas-freeze-f${i}.png`, Buffer.from(r.url.split(",")[1], "base64"));
}
const unique = new Set(colors);
console.log("sampled canvas-region pixels per frame:", colors.join(" | "));
console.log(unique.size === 1
  ? `BUG: all 10 captures identical (${[...unique][0]}) — canvas frozen at first frame`
  : `no repro: ${unique.size} distinct colors captured`);
console.log(await b.version());
await b.close();
