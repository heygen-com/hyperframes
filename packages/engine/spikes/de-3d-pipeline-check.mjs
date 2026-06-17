// Full-combination check: projection module + layoutsubtree wrap +
// drawElementImage capture (mirrors the engine pipeline minus the encoder).
import puppeteer from "puppeteer";
import { writeFileSync, readFileSync } from "node:fs";
import { initThreeDProjectionInPage } from "../src/services/threeDProjection.ts";

const HTML = readFileSync(new URL("../../producer/tests/fast-capture-3d/src/index.html", import.meta.url), "utf8");
const W = 960, H = 540;
const b = await puppeteer.launch({headless:true,
  args:["--no-sandbox","--enable-features=CanvasDrawElement","--use-gl=angle",`--window-size=${W},${H}`]});
const p = await b.newPage();
await p.setViewport({width:W,height:H});
await p.setContent(HTML,{waitUntil:"networkidle0"});
await p.evaluate(() => { window.__timelines["fast-capture-3d"].pause(0); });

const res = await p.evaluate(initThreeDProjectionInPage);
console.log("init:", JSON.stringify(res));

// engine-style layoutsubtree injection
await p.evaluate(({w,h}) => {
  const root = document.querySelector("[data-composition-id]");
  const canvas = document.createElement("canvas");
  canvas.id = "__hf_de_canvas";
  canvas.setAttribute("layoutsubtree","");
  canvas.width = w; canvas.height = h;
  canvas.style.cssText = "display:block;position:absolute;top:0;left:0;z-index:0";
  root.parentNode.insertBefore(canvas, root);
  canvas.appendChild(root);
}, {w:W,h:H});

for (const t of [0.2, 1.0, 2.0]) {
  const r = await p.evaluate((tt) => {
    window.__timelines["fast-capture-3d"].seek(tt);
    window.__hf3d?.update();
    const canvas = document.getElementById("__hf_de_canvas");
    const root = document.querySelector("[data-composition-id]");
    const ctx = canvas.getContext("2d");
    // composite like captureDrawElementFrame: hide gl canvases, drawImage, drawElementImage
    const glcs = Array.from(root.querySelectorAll("[data-hf-3d]"));
    for (const c of glcs) c.style.visibility = "hidden";
    return new Promise(done => requestAnimationFrame(() => setTimeout(() => {
      try {
        ctx.clearRect(0,0,960,540);
        ctx.fillStyle = "#ece8dd"; ctx.fillRect(0,0,960,540);
        const rootRect = root.getBoundingClientRect();
        for (const c of glcs) {
          const r2 = c.getBoundingClientRect();
          ctx.drawImage(c, r2.left-rootRect.left, r2.top-rootRect.top, r2.width, r2.height);
        }
        ctx.drawElementImage(root, 0, 0);
      } catch(e) { return done({err:String(e)}); }
      const url = canvas.toDataURL("image/png");
      ctx.clearRect(0,0,960,540);
      done({url});
    }, 40)));
  }, t);
  if (r.err) { console.log(`t=${t}: ERR ${r.err}`); continue; }
  writeFileSync(`/tmp/pl-${t}.png`, Buffer.from(r.url.split(",")[1],"base64"));
  console.log(`t=${t}: ok`);
}
await b.close();
