// The edit accuracy grid: one flat-coloured element in a generated project, crossed with one gesture.
// Projects are written to a tmp dir per case; nothing checked in is edited.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const COMPOSITION = { width: 1920, height: 1080 };
/** Frame-aligned at 30 fps, inside every tween, so preview and producer sample the same instant. */
export const PLAYHEAD = 1;
export const TARGET = { width: 240, height: 160, color: "#f0c020" };
export const BACKGROUND = "#202020";
const NESTED_HOST = { left: 160, top: 90, width: 1600, height: 900 };
const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

// Studio has corner handles only (ResizeHandle is nw|ne|sw|se); its edge strips crop, so there is no edge resize.
const GESTURES = ["move", "resize", "rotate", "crop", "nudge"];
const AXES = {
  gsap: ["none", "tween", "hold"],
  placement: ["px", "pct", "center", "xpercent"],
  rotation: [0, 30],
  nesting: ["root", "nested"],
  zoom: [50, 100, 200],
};

const product = (axes) =>
  Object.entries(axes).reduce(
    (rows, [key, values]) => rows.flatMap((row) => values.map((v) => ({ ...row, [key]: v }))),
    [{}],
  );
const caseId = (c) =>
  [c.gesture, c.gsap, c.placement, `r${c.rotation}`, c.nesting, `z${c.zoom}`].join("-");

/** `pr` is a smaller slice for CI; its final size is still an open decision. */
export function buildGrid(kind = "full") {
  return product({ ...AXES, gesture: GESTURES })
    .filter((c) => c.placement !== "xpercent" || c.gsap !== "none") // xPercent only exists through GSAP
    .filter((c) => kind !== "pr" || (c.zoom === 100 && c.nesting === "root"))
    .map((c) => ({ id: caseId(c), ...c }));
}

const PLACEMENT_CSS = {
  px: "left: 560px; top: 300px; translate: 40px 30px;",
  pct: "left: 560px; top: 300px; translate: 25% 25%;",
  center: "left: 50%; top: 50%; translate: -50% -50%;",
  xpercent: "left: 50%; top: 50%;",
};

function targetCss(spec) {
  const rotate = spec.rotation ? ` rotate: ${spec.rotation}deg;` : "";
  return `#target { position: absolute; ${PLACEMENT_CSS[spec.placement]} width: ${TARGET.width}px; height: ${TARGET.height}px; background: ${TARGET.color};${rotate} }`;
}

function gsapLines(spec) {
  const percent = spec.placement === "xpercent" ? ", xPercent: -50, yPercent: -50" : "";
  if (spec.gsap === "hold") return [`gsap.set("#target", { x: 40, y: 20${percent} });`];
  const lines = [`tl.to("#target", { x: 120, y: 60, duration: 4, ease: "none" }, 0);`];
  if (percent) lines.unshift(`gsap.set("#target", { ${percent.slice(2)} });`);
  return lines;
}

function timelineScript(id, lines) {
  return `<script src="${GSAP_CDN}"></script>
    <script>
      (function () {
        window.__timelines = window.__timelines || {};
        var tl = gsap.timeline({ paused: true });
        ${lines.join("\n        ")}
        window.__timelines["${id}"] = tl;
      })();
    </script>`;
}

// fallow-ignore-next-line complexity
function rootHtml(spec) {
  const nested = spec.nesting === "nested";
  const body = nested
    ? `<div id="scene-sub" data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="4" data-track-index="1" style="position: absolute; left: ${NESTED_HOST.left}px; top: ${NESTED_HOST.top}px; width: ${NESTED_HOST.width}px; height: ${NESTED_HOST.height}px; overflow: hidden"></div>`
    : `<div id="target" class="clip" data-start="0" data-duration="4" data-track-index="1"></div>`;
  const script = spec.gsap === "none" ? "" : timelineScript("main", nested ? [] : gsapLines(spec));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body { margin: 0; width: ${COMPOSITION.width}px; height: ${COMPOSITION.height}px; overflow: hidden; background: ${BACKGROUND}; }
      #root { position: relative; width: 100%; height: 100%; }
      ${nested ? "" : targetCss(spec)}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="${COMPOSITION.width}" data-height="${COMPOSITION.height}">
      ${body}
    </div>
    ${script}
  </body>
</html>
`;
}

function subHtml(spec) {
  const script = spec.gsap === "none" ? "" : timelineScript("sub", gsapLines(spec));
  return `<template id="sub-template">
  <div id="sub" data-composition-id="sub" data-width="${NESTED_HOST.width}" data-height="${NESTED_HOST.height}">
    <div id="target"></div>
    <style>
      #sub { position: relative; width: ${NESTED_HOST.width}px; height: ${NESTED_HOST.height}px; background: ${BACKGROUND}; overflow: hidden; }
      ${targetCss(spec)}
    </style>
    ${script}
  </div>
</template>
`;
}

/** Writes the case's project into `dir` and returns the files a gesture may rewrite. */
export function writeFixture(spec, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), rootHtml(spec));
  if (spec.nesting !== "nested") return ["index.html"];
  mkdirSync(join(dir, "compositions"), { recursive: true });
  writeFileSync(join(dir, "compositions/sub.html"), subHtml(spec));
  return ["index.html", "compositions/sub.html"];
}
