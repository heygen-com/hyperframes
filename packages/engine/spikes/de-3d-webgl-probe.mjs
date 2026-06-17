// Fidelity probe for the 3D-rewrite idea: replace a CSS 3D flip-card with
// face textures (SVG foreignObject rasterization) projected by WebGL using
// the same perspective math Blink applies — then PSNR against the browser's
// own 3D rendering at several flip angles.
//
// This tests RASTERIZATION + PROJECTION fidelity only. Capture integration is
// already proven: the fast path composites live WebGL canvases under the DOM
// paint (instrumentAcceleratedCanvases / ec037e2a).
//
// Run: node spikes/de-3d-webgl-probe.mjs

import puppeteer from "puppeteer";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const W = 400, H = 300;
// flip-wrap rect: top 80, left 100, 200x60 → center (200, 110)
const CARD_W = 200, CARD_H = 60, CX = 200, CY = 110, PERSPECTIVE = 1000;

const HTML = `<!doctype html><meta charset=utf-8>
<style>
*{margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:#ece8dd}
#root{position:relative;width:${W}px;height:${H}px;background:#ece8dd}
.headline{position:absolute;top:20px;left:0;width:100%;text-align:center;
  font:700 28px serif;color:#1a2640}
.flip-wrap{position:absolute;top:80px;left:100px;width:200px;height:60px;
  perspective:${PERSPECTIVE}px}
.flip-card{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.face{position:absolute;inset:0;backface-visibility:hidden;
  display:flex;align-items:center;justify-content:center;font:700 24px serif}
.front{background:#1a2640;color:#fff}
.back{background:#c8a870;color:#1a2640;transform:rotateX(-180deg);font-style:italic}
#footer{position:absolute;top:200px;left:0;width:100%;text-align:center;
  font:700 20px serif;color:#406080}
#gl{position:absolute;top:0;left:0;width:${W}px;height:${H}px;display:none}
</style>
<div id=root>
  <div class=headline>HEADLINE TEXT</div>
  <div class=flip-wrap id=wrap><div class=flip-card id=card>
    <div class="face front" id=front>FRONT</div>
    <div class="face back" id=back>backface</div>
  </div></div>
  <div id=footer>FOOTER TEXT</div>
  <canvas id=gl width=${W} height=${H}></canvas>
</div>
<script>
window.__setAngle = a => {
  document.getElementById("card").style.transform = "rotateX(" + a + "deg)";
};

// ── face rasterization via SVG foreignObject ──
const FACE_STYLE =
  "display:flex;align-items:center;justify-content:center;" +
  "width:${CARD_W}px;height:${CARD_H}px;font:700 24px serif;";
function faceSvg(text, extra) {
  const html =
    '<div xmlns="http://www.w3.org/1999/xhtml" style="' + FACE_STYLE + extra + '">' +
    text + "</div>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">' +
    '<foreignObject width="100%" height="100%">' + html + "</foreignObject></svg>");
}
async function loadTex(gl, url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// ── 4x4 helpers (row-major, CSS convention: x right, y down, z toward viewer) ──
function mat4mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function rotX(deg) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  // CSS rotateX: y' = c*y - s*z ; z' = s*y + c*z
  return [1,0,0,0, 0,c,-s,0, 0,s,c,0, 0,0,0,1];
}
function perspectiveM(d) {
  const m = ident(); m[14] = -1 / d; // w' = 1 - z/d  (row 3, col 2)
  return m;
}
function translateM(x, y) {
  const m = ident(); m[3] = x; m[7] = y;
  return m;
}
function ndcM(w, h) {
  // page px → clip: x: 2/w*x - 1 ; y: 1 - 2/h*y (flip). z row is ZERO:
  // raw rotated z (±card-height px) would blow past the |z|<=w clip volume
  // and get near/far-plane clipped to a sliver. Culling only needs x/y winding.
  return [2 / w,0,0,-1, 0,-2 / h,0,1, 0,0,0,0, 0,0,0,1];
}
// WebGL1 requires transpose=false in uniformMatrix4fv — convert row-major here
function colMajor(m) {
  return new Float32Array([
    m[0], m[4], m[8],  m[12],
    m[1], m[5], m[9],  m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ]);
}

window.__initGL = async () => {
  const canvas = document.getElementById("gl");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true });
  const vs = "attribute vec3 p; attribute vec2 t; uniform mat4 m; varying vec2 v;" +
    "void main(){ gl_Position = m * vec4(p,1.0); v = t; }";
  const fs = "precision mediump float; uniform sampler2D s; varying vec2 v;" +
    "void main(){ gl_FragColor = texture2D(s, v); }";
  function sh(type, src) {
    const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(x));
    return x;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // unit quad in card-local coords (centered), CCW
  const hw = ${CARD_W} / 2, hh = ${CARD_H} / 2;
  const verts = new Float32Array([
    -hw, -hh, 0,  0, 1,
     hw, -hh, 0,  1, 1,
     hw,  hh, 0,  1, 0,
    -hw, -hh, 0,  0, 1,
     hw,  hh, 0,  1, 0,
    -hw,  hh, 0,  0, 0,
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const pLoc = gl.getAttribLocation(prog, "p");
  const tLoc = gl.getAttribLocation(prog, "t");
  gl.enableVertexAttribArray(pLoc);
  gl.vertexAttribPointer(pLoc, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(tLoc);
  gl.vertexAttribPointer(tLoc, 2, gl.FLOAT, false, 20, 12);

  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  // y-flip in ndcM reverses winding: local CCW arrives CW in clip space
  gl.frontFace(gl.CW);

  const texFront = await loadTex(gl, faceSvg("FRONT", "background:#1a2640;color:#fff;"));
  const texBack = await loadTex(gl, faceSvg("backface",
    "background:#c8a870;color:#1a2640;font-style:italic;"));

  window.__glDraw = (angleDeg) => {
    gl.viewport(0, 0, ${W}, ${H});
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const base = mat4mul(ndcM(${W}, ${H}),
      mat4mul(translateM(${CX}, ${CY}),
        mat4mul(perspectiveM(${PERSPECTIVE}), rotX(angleDeg))));
    const mLoc = gl.getUniformLocation(prog, "m");
    // front face: card rotation only
    gl.bindTexture(gl.TEXTURE_2D, texFront);
    gl.uniformMatrix4fv(mLoc, false, colMajor(base));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // back face: card rotation ∘ rotateX(-180)
    const backM = mat4mul(ndcM(${W}, ${H}),
      mat4mul(translateM(${CX}, ${CY}),
        mat4mul(perspectiveM(${PERSPECTIVE}),
          mat4mul(rotX(angleDeg), rotX(-180)))));
    gl.bindTexture(gl.TEXTURE_2D, texBack);
    gl.uniformMatrix4fv(mLoc, false, colMajor(backM));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
};

window.__swapToGL = () => {
  document.getElementById("card").style.visibility = "hidden";
  document.getElementById("gl").style.display = "block";
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

mkdirSync("/tmp/de-3d-webgl", { recursive: true });

function psnr(a, b) {
  const r = spawnSync("ffmpeg", ["-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"],
    { encoding: "utf8" });
  const m = String(r.stderr).match(/average:([\d.inf]+)/);
  return m ? m[1] : "n/a";
}

const ANGLES = [0, 30, 45, 90, 135, 160, 180];

// Phase 1: references — real CSS 3D rendering
for (const a of ANGLES) {
  await page.evaluate((x) => window.__setAngle(x), a);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
  writeFileSync(`/tmp/de-3d-webgl/ref-${a}.png`, await page.screenshot({ type: "png" }));
}

// Phase 2: swap card for WebGL projection, re-screenshot
await page.evaluate(() => window.__initGL());
await page.evaluate(() => window.__swapToGL());
for (const a of ANGLES) {
  await page.evaluate((x) => {
    window.__setAngle(x); // keeps hidden card animated (engine parity)
    window.__glDraw(x);
  }, a);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
  const out = `/tmp/de-3d-webgl/gl-${a}.png`;
  writeFileSync(out, await page.screenshot({ type: "png" }));
  console.log(`angle=${a}: psnr=${psnr(`/tmp/de-3d-webgl/ref-${a}.png`, out)}`);
}

console.log(await browser.version());
await browser.close();
