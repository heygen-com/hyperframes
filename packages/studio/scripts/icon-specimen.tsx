// Renders the icon specimen sheet from the module itself, so the sheet cannot
// drift from the code. Usage: bun scripts/icon-specimen.tsx <out.html>
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import * as Ph from "@phosphor-icons/react";
import { Icon, ICON_NAMES, type IconName } from "../src/icons";

// The 20 most-used Studio icons today, Phosphor glyph beside ours.
const TODAY: [IconName, Ph.Icon][] = [
  ["chevron-down", Ph.CaretDown],
  ["x", Ph.X],
  ["plus", Ph.Plus],
  ["check", Ph.Check],
  ["trash", Ph.Trash],
  ["eye", Ph.Eye],
  ["eye-off", Ph.EyeSlash],
  ["copy", Ph.Copy],
  ["film", Ph.FilmStrip],
  ["layers", Ph.Stack],
  ["music", Ph.MusicNote],
  ["type", Ph.TextT],
  ["settings", Ph.Gear],
  ["undo", Ph.ArrowCounterClockwise],
  ["redo", Ph.ArrowClockwise],
  ["camera", Ph.Camera],
  ["scissors", Ph.Scissors],
  ["magnet", Ph.Magnet],
  ["warning", Ph.Warning],
  ["pencil", Ph.PencilSimple],
];

// The specimen paints with Studio's own tokens, read off theme.css so the two cannot drift.
const THEME = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
const TOKENS = [...THEME.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)]
  .map(([, k, v]) => `${k}:${v}`)
  .join(";");

const SIZES = [12, 14, 16, 20] as const;
const STATES = [
  ["enabled", "var(--color-text-2)"],
  ["hover", "var(--color-text-0)"],
  ["active", "var(--color-accent)"],
  ["disabled", "var(--color-text-4)"],
] as const;
const DISTINCT: IconName[][] = [
  ["scissors", "split", "razor"],
  ["keyframe", "keyframe-auto", "marker", "beat"],
  ["snap", "magnet"],
  ["eye", "eye-off"],
  ["link", "unlink"],
  ["undo", "redo", "rotate-cw", "rotate-ccw", "loop"],
  ["sidebar-show", "sidebar-hide", "inspector", "window"],
  ["copy", "clipboard"],
  ["layers", "bring-forward", "send-backward", "bring-to-front", "send-to-back"],
  ["download", "upload"],
  ["group", "ungroup"],
  ["file", "file-code", "file-image", "file-video", "file-audio", "file-text", "file-font"],
];

const svg = (name: IconName, size: number, filled = false) =>
  renderToStaticMarkup(<Icon name={name} size={size} filled={filled} />);

const cell = (inner: string, label = "") =>
  `<div class="cell">${inner}${label ? `<span>${label}</span>` : ""}</div>`;

const distinctRows = DISTINCT.map(
  (group) => `<div class="row">${group.map((n) => cell(svg(n, 12), n)).join("")}</div>`,
).join("");

const sizeRows = ICON_NAMES.map(
  (n) =>
    `<div class="row"><b>${n}</b>${SIZES.map((s) => cell(svg(n, s))).join("")}` +
    `<i></i>${STATES.map(([st, color]) => `<div class="cell" style="color:${color}">${svg(n, 16, st === "active")}<span>${st}</span></div>`).join("")}</div>`,
).join("");

const btn = (n: IconName, active = false, label = "") =>
  `<button class="ib${active ? " on" : ""}" title="${n}">${svg(n, 14, active)}${label ? `<em>${label}</em>` : ""}</button>`;
const chrome = `
<section class="chrome">
  <div class="header">
    <span class="logo">HyperFrames Studio</span>
    <div class="seg">${btn("camera", false, "Capture")}${btn("window", false, "Window")}${btn("inspector", true, "Inspector")}</div>
    ${btn("download", false, "Export")}
  </div>
  <div class="body">
    <div class="tree">
      <div class="tabs">${btn("file", true)}${btn("layers")}${btn("image")}${btn("music")}${btn("sparkle")}</div>
      <div class="li">${svg("chevron-down", 12)}${svg("folder", 14)}compositions</div>
      <div class="li in">${svg("file-code", 14)}intro.html</div>
      <div class="li in">${svg("file-code", 14)}outro.html</div>
      <div class="li">${svg("chevron-right", 12)}${svg("folder", 14)}assets</div>
      <div class="li in">${svg("file-video", 14)}clip.mp4</div>
      <div class="li in">${svg("file-audio", 14)}music.mp3</div>
      <div class="li in">${svg("file-image", 14)}logo.png</div>
      <div class="li in">${svg("file-font", 14)}Inter.woff2</div>
      <div class="li">${svg("file-text", 14)}README.md</div>
    </div>
    <div class="stage"><div class="frame"></div>
      <div class="pc">${btn("play")}${btn("pause")}<span class="t">00:00:00</span>${btn("loop", true)}${btn("volume-high")}${btn("fullscreen")}</div>
    </div>
    <div class="insp">
      <div class="ih">${svg("square", 13)}<b>hero</b>${btn("eye")}${btn("copy")}${btn("x")}</div>
      <div class="ir"><span>Position</span>${btn("keyframe")}${btn("link", true)}</div>
      <div class="ir"><span>Opacity</span>${btn("keyframe", true)}${btn("caret-down")}</div>
      <div class="ir"><span>Fill</span>${btn("eyedropper")}${btn("palette")}</div>
      <div class="ir"><span>Order</span>${btn("bring-to-front")}${btn("bring-forward")}${btn("send-backward")}${btn("send-to-back")}</div>
      <div class="ir"><span>Text</span>${btn("type")}${btn("font")}</div>
    </div>
  </div>
  <div class="tl">
    <div class="tb">${btn("select", true)}${btn("undo")}${btn("redo")}<i></i>${btn("razor")}${btn("split")}${btn("scissors")}<i></i>${btn("magnet", true)}${btn("snap")}${btn("beat")}${btn("marker")}${btn("keyframe-auto")}<i></i>${btn("zoom-out")}${btn("zoom-in")}${btn("waves")}${btn("record")}<span class="grow"></span>${btn("keyboard")}${btn("settings")}</div>
    <div class="lane">${svg("eye", 12)}${svg("film", 12)}<span>Video</span><div class="clip v"></div></div>
    <div class="lane">${svg("eye", 12)}${svg("type", 12)}<span>Title</span><div class="clip t"></div></div>
    <div class="lane">${svg("eye-off", 12)}${svg("music", 12)}<span>Music</span><div class="clip a"></div></div>
  </div>
</section>`;

const todayRows = [16, 12]
  .map(
    (size) =>
      `<div class="row"><b>${size} px</b>${TODAY.map(
        ([n, P]) =>
          `<div class="pair"><span>${renderToStaticMarkup(<P size={size} />)}${svg(n, size)}</span><span>${n}</span></div>`,
      ).join("")}</div>`,
  )
  .join("");

const html = `<!doctype html><meta charset="utf-8"><title>Studio icons</title>
<style>
:root{${TOKENS}}
body{margin:0;background:var(--color-bg-0);color:var(--color-text-2);font:12px/1.4 -apple-system,Inter,system-ui,sans-serif;padding:24px}
h1{font-size:13px;color:var(--color-text-0);margin:24px 0 8px}
.row{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--color-border)}
.row b{width:120px;font-weight:500;font-size:11px}
.row i{width:16px}
.cell{display:flex;flex-direction:column;align-items:center;gap:2px;width:78px}
.pair{display:flex;flex-direction:column;align-items:center;gap:2px;width:44px}.pair span{display:flex;gap:6px;font-size:8px;color:var(--color-text-4)}.pair svg{display:block}
.cell span{font-size:9px;color:var(--color-text-4);white-space:nowrap}
.cell svg{display:block}
.chrome{border:1px solid var(--color-border);background:var(--color-bg-0);width:900px;font-size:11px;user-select:none}
.header{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--color-surface);border-bottom:1px solid var(--color-border)}
.logo{color:var(--color-text-0);font-weight:600;flex:1}
.seg{display:flex;background:#0f0f11;border:1px solid var(--color-border);border-radius:6px;padding:2px;gap:2px}
.ib{all:unset;display:inline-flex;align-items:center;gap:5px;padding:4px;border-radius:5px;color:var(--color-text-2);cursor:default}
.ib em{font-style:normal}
.ib:hover{background:var(--color-hover);color:var(--color-text-0)}
.ib.on{color:var(--color-accent)}
.body{display:flex;height:260px}
.tree{width:180px;border-right:1px solid var(--color-border);padding:4px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--color-border);margin-bottom:6px;padding-bottom:4px}
.li{display:flex;align-items:center;gap:5px;padding:2px 4px;color:var(--color-text-2)}
.li.in{padding-left:22px}
.stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.frame{width:320px;height:180px;background:#000;border:1px solid var(--color-border)}
.pc{display:flex;align-items:center;gap:2px}.pc .t{color:var(--color-text-0);font-variant-numeric:tabular-nums;padding:0 8px}
.insp{width:220px;border-left:1px solid var(--color-border);padding:6px}
.ih,.ir{display:flex;align-items:center;gap:4px;padding:3px 2px;border-bottom:1px solid var(--color-border)}
.ih b{flex:1;color:var(--color-text-0);font-weight:500}.ir span{flex:1}
.tl{border-top:1px solid var(--color-border);background:var(--color-surface)}
.tb{display:flex;align-items:center;gap:2px;padding:4px 8px;border-bottom:1px solid var(--color-border)}
.tb i{width:1px;height:16px;background:var(--color-border);margin:0 4px}.grow{flex:1}
.lane{display:flex;align-items:center;gap:6px;padding:4px 8px;height:24px;border-bottom:1px solid var(--color-border)}
.lane span{width:60px}.clip{height:20px;border-radius:4px;width:240px}
.clip.v{background:#1f5fa5}.clip.t{background:#6b4fbb;width:140px;margin-left:40px}.clip.a{background:#1e7a5f;width:400px}
</style>
<h1>Today (Phosphor, left) and ours (right)</h1>${todayRows}
<h1>Must stay distinct at 12 px</h1>${distinctRows}
<h1>In Studio chrome (mock, 14 px)</h1>${chrome}
<h1>Every icon at 12 / 14 / 16 / 20 px, then enabled / hover / active / disabled at 16 px</h1>${sizeRows}
`;
writeFileSync(process.argv[2] ?? "icon-specimen.html", html);
console.log(`${ICON_NAMES.length} icons -> ${process.argv[2]}`);
