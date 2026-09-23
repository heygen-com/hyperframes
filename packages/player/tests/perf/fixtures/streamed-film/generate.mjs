#!/usr/bin/env node
// Writes a load-benchmark film with the weight of a real long film (24 timed scenes, ~1.2 MB of script,
// ~12 MB of PNG, one 5 MB mp4) in two shapes that render the same frames:
//   <out>/single  one index.html, every scene inline, one script builds the whole timeline
//   <out>/scenes  index.html hosts each scene from compositions/sNN.html, which builds its own timeline
// usage: node generate.mjs <out-dir>   (needs ffmpeg on PATH)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const SCENES = 24;
const SCENE_SECONDS = 2.5;
const FILLER_TABLES = 2600;
const out = resolve(process.argv[2] ?? "streamed-film");

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// Noise PNGs keep the byte weight of real image plates; a seeded generator keeps both shapes byte-identical.
function noisePng(width, height, seed) {
  let s = seed + 1;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < raw.length; i++) {
    if (i % (width * 3 + 1) === 0) continue;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    raw[i] = s >>> 24;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeAssets(dir) {
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (let i = 0; i < 8; i++)
    writeFileSync(join(dir, "assets", `plate-${i}.png`), noisePng(900, 450 + 30 * i, i));
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=20",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    "2M",
    join(dir, "assets", "clip.mp4"),
  ]);
}

const fillerTable = (i) =>
  `const table${i} = [${Array.from({ length: 120 }, (_, j) => (i * 31 + j) % 997).join(",")}];`;
const fillerFor = (scene) =>
  Array.from({ length: FILLER_TABLES }, (_, i) => i)
    .filter((i) => i % SCENES === scene)
    .map(fillerTable)
    .join("\n");
const sceneMarkup = (s) =>
  `<img src="assets/plate-${s % 8}.png" style="position:absolute;left:${40 + s * 7}px;top:60px;width:900px"><img src="assets/plate-${(s + 4) % 8}.png" style="position:absolute;right:40px;bottom:40px;width:420px;opacity:.8">
  <h1 class="t">Scene ${s + 1}</h1>`;
const tween = (selector, at) =>
  `tl.fromTo("${selector}", { x: -200, opacity: 0 }, { x: 0, opacity: 1, duration: 0.8 }, ${at});`;
const head = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>streamed film</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>html,body{margin:0;background:#123} #root{position:relative;width:1920px;height:1080px;overflow:hidden;background:linear-gradient(135deg,#1d4ed8,#9333ea);font-family:sans-serif}
.clip{position:absolute;inset:0} .t{position:absolute;left:80px;bottom:80px;margin:0;font-size:120px;color:#fff}</style></head>
<body><div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="60">
<video id="clip" src="assets/clip.mp4" class="clip" data-start="0" data-duration="20" data-track-index="4" muted playsinline style="position:absolute;right:60px;top:60px;width:480px"></video>`;
const scenes = Array.from({ length: SCENES }, (_, s) => s);
const id = (s) => `s${String(s).padStart(2, "0")}`;

function writeSingle(dir) {
  writeAssets(dir);
  const sections = scenes.map(
    (
      s,
    ) => `<section id="${id(s)}" class="clip" data-start="${s * SCENE_SECONDS}" data-duration="${SCENE_SECONDS}" data-track-index="${s % 3}">
  ${sceneMarkup(s)}</section>`,
  );
  writeFileSync(
    join(dir, "index.html"),
    `${head}
${sections.join("\n")}
</div>
<script>
${scenes.map(fillerFor).join("\n")}
const tl = gsap.timeline({ paused: true });
${scenes.map((s) => tween(`#${id(s)} .t`, s * SCENE_SECONDS)).join("\n")}
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
</script></body></html>
`,
  );
}

function writeScenes(dir) {
  writeAssets(dir);
  mkdirSync(join(dir, "compositions"), { recursive: true });
  const hosts = scenes.map(
    (s) =>
      `<div id="host-${id(s)}" data-composition-id="${id(s)}" data-composition-src="compositions/${id(s)}.html" data-start="${s * SCENE_SECONDS}" data-duration="${SCENE_SECONDS}" data-track-index="${s % 3}"></div>`,
  );
  writeFileSync(
    join(dir, "index.html"),
    `${head}
${hosts.join("\n")}
</div>
<script>
window.__timelines = window.__timelines || {};
window.__timelines["main"] = gsap.timeline({ paused: true });
</script></body></html>
`,
  );
  for (const s of scenes) {
    writeFileSync(
      join(dir, "compositions", `${id(s)}.html`),
      `<template id="${id(s)}-template">
<div id="${id(s)}" data-composition-id="${id(s)}" data-width="1920" data-height="1080" data-duration="${SCENE_SECONDS}">
  ${sceneMarkup(s)}
  <style>#${id(s)} .t{position:absolute;left:80px;bottom:80px;margin:0;font-size:120px;color:#fff}</style>
  <script>
    (function () {
${fillerFor(s)}
      const tl = gsap.timeline({ paused: true });
      ${tween(`#${id(s)} .t`, 0)}
      window.__timelines = window.__timelines || {};
      window.__timelines["${id(s)}"] = tl;
    })();
  </script>
</div>
</template>
`,
    );
  }
}

writeSingle(join(out, "single"));
writeScenes(join(out, "scenes"));
console.log(`wrote ${out}/single and ${out}/scenes`);
