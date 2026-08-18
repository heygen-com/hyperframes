#!/usr/bin/env node
/**
 * hfir -> HyperFrames composition.
 *
 * Compiles a flat table of (op, frame, element, property, value) into a
 * renderable composition. The agent writing the table never sees HTML, CSS, the
 * cascade, the box model, or an easing name.
 *
 * Two opcodes, and the difference is the whole point:
 *   SET   frame el prop value   hard step, holds until the next op
 *   RAMP  frame el prop value   linear interpolation from the previous value
 *
 * Interpolation is stated per property per segment, so there is no implicit
 * tween and no eased default to misread.
 *
 * Output targets the Web Animations API rather than CSS keyframes, because
 * seeking a WAAPI animation by `currentTime` is the path the render engine
 * treats as authoritative. That also means the IR inherits browser text
 * shaping, compositing and colour for free.
 *
 * Usage: node compile.mjs scene.hfir out/index.html
 */

import { readFileSync, writeFileSync } from "node:fs";

/** How each IR property maps onto a CSS property and unit. */
const PROPS = {
  x: { css: "left", unit: "px" },
  y: { css: "top", unit: "px" },
  w: { css: "width", unit: "px" },
  h: { css: "height", unit: "px" },
  opacity: { css: "opacity", unit: "" },
  size: { css: "fontSize", unit: "px" },
  rotate: { css: "rotate", unit: "deg" },
  fill: { css: "backgroundColor", unit: "" },
};

export function parse(src) {
  const scene = { canvas: null, frames: null, decls: [], ops: [] };

  src.split("\n").forEach((raw, i) => {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) return;
    const [op, ...rest] = line.split(/\s+/);
    const at = `line ${i + 1}`;

    switch (op) {
      case "CANVAS":
        scene.canvas = { w: +rest[0], h: +rest[1], fps: +rest[2] };
        break;
      case "FRAMES":
        scene.frames = +rest[0];
        break;
      case "DECL":
        scene.decls.push({ id: rest[0], kind: rest[1] });
        break;
      case "SET":
      case "RAMP": {
        const [frame, el, prop] = rest;
        if (prop !== "text" && !PROPS[prop]) {
          throw new Error(`${at}: unknown property "${prop}"`);
        }
        scene.ops.push({
          op,
          frame: +frame,
          el,
          prop,
          value: rest.slice(3).join(" "),
        });
        break;
      }
      default:
        throw new Error(`${at}: unknown op "${op}"`);
    }
  });

  if (!scene.canvas) throw new Error("missing CANVAS");
  if (!scene.frames) throw new Error("missing FRAMES");

  const declared = new Set(scene.decls.map((d) => d.id));
  for (const o of scene.ops) {
    if (!declared.has(o.el)) throw new Error(`op targets undeclared element "${o.el}"`);
    if (o.frame > scene.frames) {
      throw new Error(`op at frame ${o.frame} is past FRAMES ${scene.frames}`);
    }
  }
  return scene;
}

/**
 * One WAAPI animation per (element, property). Offsets land on exact frames, so
 * seeking to frame N produces the value the table declared for frame N.
 */
export function plan(scene) {
  const groups = new Map();
  for (const o of scene.ops) {
    const key = `${o.el}|${o.prop}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const animations = [];
  const textTracks = [];

  for (const [key, list] of groups) {
    const [el, prop] = key.split("|");
    list.sort((a, b) => a.frame - b.frame);

    // Text content is not animatable by WAAPI, so it is driven from a discrete
    // per-frame table on seek. This is the one place the mapping is not 1:1.
    if (prop === "text") {
      textTracks.push({ el, steps: list.map((o) => ({ frame: o.frame, value: o.value })) });
      continue;
    }

    const isText = scene.decls.find((d) => d.id === el)?.kind === "text";
    const spec = PROPS[prop];
    // On a text element, `fill` means the glyph colour, not a background.
    const css = prop === "fill" && isText ? "color" : spec.css;

    const keyframes = list.map((o) => ({
      offset: Math.min(1, o.frame / scene.frames),
      value: spec.unit ? `${o.value}${spec.unit}` : o.value,
      // A SET holds its value; a RAMP interpolates into it.
      easing: o.op === "SET" ? "steps(1, end)" : "linear",
    }));

    animations.push({ el, css, keyframes });
  }

  return { animations, textTracks };
}

export function emit(scene, { animations, textTracks }) {
  const { w, h, fps } = scene.canvas;
  const durationMs = (scene.frames / fps) * 1000;

  const elements = scene.decls
    .map((d) => {
      const textStyle =
        d.kind === "text" ? "white-space:nowrap;font-family:monospace;font-weight:700;" : "";
      return (
        `    <div id="${d.id}" data-start="0" data-duration="${scene.frames / fps}"` +
        ` style="position:absolute;${textStyle}"></div>`
      );
    })
    .join("\n");

  const animJs = animations
    .map((a) => {
      const frames = a.keyframes.map(
        (k) =>
          `{ offset: ${k.offset}, ${a.css}: ${JSON.stringify(k.value)}, ` +
          `easing: ${JSON.stringify(k.easing)} }`,
      );
      // A lone keyframe still needs an end frame to have a duration.
      if (frames.length === 1) frames.push(frames[0].replace(/offset: [\d.]+/, "offset: 1"));
      return (
        `  document.getElementById(${JSON.stringify(a.el)}).animate([\n` +
        `    ${frames.join(",\n    ")}\n  ], { duration: ${durationMs}, fill: "both" });`
      );
    })
    .join("\n");

  const textJs = textTracks.length
    ? `
  // Discrete text, applied on every seek from an explicit frame table.
  var TEXT = ${JSON.stringify(textTracks)};
  var FPS = ${fps};
  var probe = document.getElementById(${JSON.stringify(scene.decls[0].id)});
  function seekSeconds() {
    var a = probe.getAnimations()[0];
    return a ? (Number(a.currentTime) || 0) / 1000 : 0;
  }
  function applyText() {
    var f = seekSeconds() * FPS + 1e-4;
    for (var i = 0; i < TEXT.length; i++) {
      var el = document.getElementById(TEXT[i].el);
      var v = "";
      for (var j = 0; j < TEXT[i].steps.length; j++) {
        if (f >= TEXT[i].steps[j].frame) v = TEXT[i].steps[j].value;
      }
      if (el.textContent !== v) el.textContent = v;
    }
    requestAnimationFrame(applyText);
  }
  applyText();`
    : "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>hfir</title><style>body{margin:0}</style></head>
<body>
  <!-- Generated from a .hfir table. Do not hand-edit. -->
  <div id="root" data-composition-id="root" data-duration="${scene.frames / fps}"
       data-width="${w}" data-height="${h}" data-no-timeline
       style="position:relative;width:${w}px;height:${h}px;overflow:hidden">
${elements}
  </div>
  <script>
${animJs}
${textJs}
  </script>
</body>
</html>
`;
}

export function compile(src) {
  const scene = parse(src);
  return { scene, html: emit(scene, plan(scene)) };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error("usage: compile.mjs <scene.hfir> <out/index.html>");
    process.exit(1);
  }
  const { scene, html } = compile(readFileSync(input, "utf8"));
  writeFileSync(output, html);
  const { animations, textTracks } = plan(scene);
  console.log(
    `${scene.ops.length} ops / ${scene.decls.length} elements -> ` +
      `${animations.length} animations, ${textTracks.length} text tracks`,
  );
}
