import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// One composition per defect from the 60-composition motion blur sweep. Each is 640x360, 30 fps, 1 s,
// and its mover #m travels x 0 to 480 between 0.25 s and 0.75 s (32 px a frame). No text anywhere, so
// no pin depends on how a host rasterises glyphs.

export type Tier = "capture" | "filter";

interface SweepFixture {
  name: string;
  width: 640;
  height: 360;
  dpr: 1;
  durationSeconds: 1;
  fps: 30;
  html(blur: "on" | "off", tier: Tier): string;
}

const repoRoot = resolve(import.meta.dirname, "../../../../../..");
const GSAP = readFileSync(
  createRequire(resolve(repoRoot, "packages/core/package.json")).resolve("gsap/dist/gsap.min.js"),
  "utf8",
);

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box }
  html, body { width: 640px; height: 360px; overflow: hidden; background: #000 }
  #root { position: relative; width: 640px; height: 360px; overflow: hidden;
    background: linear-gradient(135deg, #1d3557 0%, #457b9d 50%, #2a9d8f 100%) }
  .deco { position: absolute; width: 40px; height: 40px; border-radius: 50%; background: #f1faee }
  .m { position: absolute; left: 40px; top: 140px; width: 120px; height: 80px; background: #e76f51; border: 4px solid #fff }`;

const DECO = Array.from(
  { length: 9 },
  (_, i) => `<div class="deco" style="left:${20 + i * 70}px;top:${30 + (i % 3) * 110}px"></div>`,
).join("");

const MOVER = `<div id="m" class="m"></div>`;
const SLIDE = `tl.fromTo("#m", { x: 0 }, { x: 480, duration: 0.5, ease: "none" }, 0.25);`;
const STRIPES = `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#000 0 20px,#fff 20px 40px)"></div>`;

interface Spec {
  name: string;
  css?: string;
  body?: string;
  script?: string;
}

const rootAttrs = (blur: "on" | "off", tier: Tier): string =>
  blur === "off"
    ? 'data-motion-blur="off"'
    : `data-motion-blur="on" data-motion-blur-tier="${tier}"`;

function sweepFixture(spec: Spec): SweepFixture {
  return {
    name: spec.name,
    width: 640,
    height: 360,
    dpr: 1,
    durationSeconds: 1,
    fps: 30,
    html: (blur, tier) => `<!doctype html><html><head><meta charset="utf-8"><style>
      ${BASE_CSS}
      ${spec.css ?? ""}
    </style></head><body>
      <div id="root" data-composition-id="root" data-start="0" data-duration="1" data-width="640" data-height="360" ${rootAttrs(blur, tier)}>${DECO}${spec.body ?? MOVER}</div>
      <script>${GSAP}</script><script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        ${spec.script ?? SLIDE}
        tl.set({}, {}, 1);
        window.__timelines.root = tl;
      </script>
    </body></html>`,
  };
}

const card = (style: string): string =>
  `<div id="card" style="position:absolute;left:200px;top:80px;width:240px;height:200px;background:#264653;${style}"><div id="m" class="m" style="left:-160px;top:60px"></div></div>`;

const SWEEP_FIXTURES = [
  // Control: a plain mover. Both tiers draw it the way the oracle does.
  sweepFixture({ name: "plain" }),
  // A: a static panel painted over the mover.
  sweepFixture({
    name: "behind-panel",
    css: ".m { z-index: 1 }",
    body: `${MOVER}<div id="panel" style="position:absolute;left:260px;top:100px;width:120px;height:160px;background:#ffd166;z-index:5;border:4px solid #000"></div>`,
  }),
  // B: the mover blends with what is under it.
  sweepFixture({
    name: "blend-difference",
    css: ".m { background: #fff; mix-blend-mode: difference }",
    body: STRIPES + MOVER,
  }),
  // C: an ancestor casts a drop shadow from the mover.
  sweepFixture({
    name: "ancestor-drop-shadow",
    body: `<div style="position:absolute;inset:0;filter:drop-shadow(14px 14px 3px #000)">${MOVER}</div>`,
  }),
  // D: generated content drawn outside the mover's box.
  sweepFixture({
    name: "pseudo-after",
    css: ".m::after { content: ''; position: absolute; left: 130px; top: 10px; width: 60px; height: 60px; background: #ffd166; border-radius: 50% }",
  }),
  // E: the mover's own clip-path.
  sweepFixture({
    name: "own-clip-polygon",
    css: ".m { clip-path: polygon(50% 0, 100% 100%, 0 100%) }",
  }),
  // F: a position:fixed child of a mover that moves through left.
  sweepFixture({
    name: "fixed-child-left",
    body: `<div id="m" class="m"><div id="badge" style="position:fixed;left:10px;top:10px;width:60px;height:30px;background:#ffd166"></div></div>`,
    script: `tl.fromTo("#m", { left: 40 }, { left: 520, duration: 0.5, ease: "none" }, 0.25);`,
  }),
  // H: an author selector that goes through the root's parent.
  sweepFixture({ name: "body-child-selector", css: "body > #root > .m { background: #06d6a0 }" }),
  // I: an author selector on the root's last child.
  sweepFixture({
    name: "last-child-selector",
    css: "#root > :last-child { outline: 6px solid #ffd166 }",
    body: `${MOVER}<div id="last" style="position:absolute;left:500px;top:20px;width:100px;height:50px;background:#000"></div>`,
  }),
  // J: an overflow:hidden card the mover slides into.
  sweepFixture({ name: "overflow-card", body: card("overflow:hidden;border-radius:24px") }),
  // K: two movers that cross.
  sweepFixture({
    name: "overlapping-movers",
    css: ".m2 { position: absolute; left: 480px; top: 150px; width: 120px; height: 80px; background: #2a9d8f; border: 4px solid #000 }",
    body: `${MOVER}<div id="m2" class="m2"></div>`,
    script: `${SLIDE} tl.fromTo("#m2", { x: 0 }, { x: -440, duration: 0.5, ease: "none" }, 0.25);`,
  }),
  // M: movers that rise in from below the frame edge.
  sweepFixture({
    name: "rise-from-below",
    css: ".r { position: absolute; top: 300px; width: 40px; height: 40px; background: #ffd166; border: 3px solid #000 }",
    body: Array.from(
      { length: 9 },
      (_, i) => `<div class="r" style="left:${20 + i * 68}px"></div>`,
    ).join(""),
    script: `tl.from(".r", { y: 120, duration: 0.3, ease: "none", stagger: 0.012 }, 0.2);`,
  }),
  // O: the mover is hidden half way through a frame's shutter.
  sweepFixture({
    name: "visibility-toggle",
    script: `${SLIDE} tl.set("#m", { visibility: "hidden" }, 0.5);`,
  }),
] as const satisfies readonly SweepFixture[];

export type SweepFixtureName = (typeof SWEEP_FIXTURES)[number]["name"];

export function sweepFixtureNamed(name: SweepFixtureName): SweepFixture {
  const f = SWEEP_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing sweep fixture ${name}`);
  return f;
}
