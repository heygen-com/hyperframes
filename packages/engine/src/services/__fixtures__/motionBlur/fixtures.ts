import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export interface BlurFixture {
  name: string;
  width: number;
  height: number;
  dpr: number;
  durationSeconds: number;
  fps: 30;
  /** Times inside holds: nothing moves within three frames of them. */
  checkpoints: readonly number[];
  /** Times while a mover moves. */
  moving: readonly number[];
  html(blur: "on" | "off"): string;
  expectOn: {
    state: "on" | "off";
    tier: "capture" | "filter" | null;
    reasonCode: string | null;
    minMovers?: number;
  };
}

const repoRoot = resolve(import.meta.dirname, "../../../../../..");
const GSAP = readFileSync(
  createRequire(resolve(repoRoot, "packages/core/package.json")).resolve("gsap/dist/gsap.min.js"),
  "utf8",
);

const CARD_WIDTH = 80;
const CARD_HEIGHT = 40;
const SLIDE = 0.4;
const frame = (k: number): number => k / 30;
const frames = (...ks: number[]): number[] => ks.map(frame);

interface Spec {
  name: string;
  width?: number;
  height?: number;
  dpr?: number;
  duration?: number;
  checkpoints?: readonly number[];
  moving?: readonly number[];
  expectOn?: Partial<BlurFixture["expectOn"]>;
  /** Pins the capture tier; left out for fixtures that exist to be handed to the filter tier. */
  captureTier?: boolean;
  cardLeft?: number;
  cardTop?: number;
  cardStyle?: string;
  cardContent?: string;
  /** Markup placed under the card, or over it when `over` is set. */
  extra?: string;
  over?: boolean;
  style?: string;
  /** Page script run after the root timeline `tl` exists. */
  script?: string;
  cssMotion?: boolean;
}

function slideScript(width: number, duration: number): string {
  return `tl.fromTo("#card",{x:-200},{x:0,duration:${SLIDE},ease:"power2.out"},0)
    .to("#card",{x:${width},duration:${SLIDE},ease:"power2.in"},${duration - SLIDE});`;
}

function cssSlide(width: number, duration: number): string {
  return `@keyframes slide {
    0% { transform: translateX(-200px); animation-timing-function: ease-out }
    ${(SLIDE / duration) * 100}% { transform: translateX(0) }
    ${100 - (SLIDE / duration) * 100}% { transform: translateX(0); animation-timing-function: ease-in }
    100% { transform: translateX(${width}px) }
  }
  #card { animation: slide ${duration}s linear both }`;
}

const rootAttrs = (spec: Spec, blur: "on" | "off"): string => {
  if (blur === "off") return 'data-motion-blur="off"';
  const tier = spec.captureTier === false ? "" : ' data-motion-blur-tier="capture"';
  return `data-motion-blur="on" data-motion-blur-events="on" data-motion-blur-shutter="240"${tier}`;
};

const rootBody = (spec: Spec): string => {
  const card = `<div id="card" style="${spec.cardStyle ?? ""}">${spec.cardContent ?? ""}</div>`;
  return spec.over ? card + (spec.extra ?? "") : (spec.extra ?? "") + card;
};

const pageScript = (spec: Spec, width: number, duration: number): string =>
  spec.cssMotion
    ? ""
    : `<script>${GSAP}</script><script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${slideScript(width, duration)}
      ${spec.script ?? ""}
      window.__timelines.root = tl;
    </script>`;

function compose(spec: Spec, blur: "on" | "off"): string {
  const width = spec.width ?? 320;
  const height = spec.height ?? 180;
  const duration = spec.duration ?? 2;
  const left = spec.cardLeft ?? (width - CARD_WIDTH) / 2;
  const top = spec.cardTop ?? (height - CARD_HEIGHT) / 2;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0 }
    #card { position: absolute; left: ${left}px; top: ${top}px; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; background: #e8a33d; border-radius: 4px }
    ${spec.cssMotion ? cssSlide(width, duration) : ""}
    ${spec.style ?? ""}
  </style></head><body>
    <div id="root" data-composition-id="root" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}" ${rootAttrs(spec, blur)}
      style="position:relative;width:${width}px;height:${height}px;background:#10131a;overflow:hidden">${rootBody(spec)}</div>
    ${pageScript(spec, width, duration)}
  </body></html>`;
}

function fixture(spec: Spec): BlurFixture {
  return {
    name: spec.name,
    width: spec.width ?? 320,
    height: spec.height ?? 180,
    dpr: spec.dpr ?? 1,
    durationSeconds: spec.duration ?? 2,
    fps: 30,
    checkpoints: spec.checkpoints ?? frames(15, 30, 45),
    moving: spec.moving ?? frames(6, 54),
    html: (blur) => compose(spec, blur),
    expectOn: { state: "on", tier: "capture", reasonCode: null, ...spec.expectOn },
  };
}

const rows = Array.from(
  { length: 30 },
  (_, i) =>
    `<div style="height:20px;line-height:20px;padding-left:8px;font:12px monospace;color:#cfd8e8;background:${i % 2 ? "#222b3a" : "#1c2330"}">Row ${i}</div>`,
).join("");

const WEBGL_TINT = `<canvas id="gl" width="320" height="180" style="position:absolute;left:0;top:0"></canvas>
  <script>
    const gl = document.getElementById("gl").getContext("webgl");
    gl.clearColor(0.05, 0.2, 0.1, 0.25);
    gl.clear(gl.COLOR_BUFFER_BIT);
  </script>`;

const FLIP = `<div style="position:absolute;left:210px;top:20px;width:100px;height:100px;perspective:400px"><div id="flip" style="width:100px;height:100px;background:#06c;backface-visibility:hidden;animation:flip 1s linear both"></div></div>`;

const LOGO_CLIP = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><clipPath id="logoClip" clipPathUnits="objectBoundingBox"><polygon points="0.5,0 1,0.5 0.5,1 0,0.5"/></clipPath></defs></svg>`;

const HOLD_AFTER_FLIP = frames(36, 45);

export const FIXTURES: readonly BlurFixture[] = [
  fixture({ name: "held-card" }),
  fixture({
    name: "nested-canvas-offset",
    style:
      ".clip { position: absolute; inset: 0; overflow: hidden; will-change: transform, filter, opacity }",
    extra: `<section class="clip"><canvas id="hcanvas" width="320" height="100" style="position:absolute;left:0;top:80px"></canvas></section>`,
    script: `const cvx = document.getElementById("hcanvas").getContext("2d");
      const draw = () => {
        cvx.clearRect(0, 0, 320, 100);
        cvx.strokeStyle = "#fff";
        cvx.strokeRect(2, 2, 316, 96);
        cvx.fillStyle = "#fff";
        cvx.font = "700 48px monospace";
        cvx.fillText("OPEN", 20, 60);
      };
      tl.to({}, { duration: 2, onUpdate: draw }, 0);`,
  }),
  fixture({
    name: "scroll-list",
    cardTop: 130,
    checkpoints: frames(30, 36, 45),
    extra: `<div id="list" style="position:absolute;left:8px;top:8px;width:160px;height:120px;overflow:auto;scrollbar-width:none">${rows}</div>`,
    script: `const list = document.getElementById("list");
      const scroll = { v: 0 };
      tl.to(scroll, { v: 400, duration: 0.4, ease: "none", onUpdate() { list.scrollTop = scroll.v } }, 0.5);`,
  }),
  fixture({
    name: "callbacks",
    checkpoints: frames(21, 24, 36),
    extra: `<div id="label" style="position:absolute;left:10px;top:10px;font:700 24px monospace;color:#fff">A</div>`,
    script: `const label = document.getElementById("label");
      const write = (text) => () => { label.textContent = text };
      tl.call(write("B"), null, 0.5).call(write("A"), null, 0.5333)
        .call(write("first"), null, 1).call(write("second"), null, 1);`,
  }),
  fixture({
    name: "stateful-callback",
    extra: `<div id="count" style="position:absolute;left:10px;top:10px;font:700 24px monospace;color:#fff">0</div>`,
    script: `const count = document.getElementById("count");
      let last = 0, crossings = 0, shown = 0;
      tl.eventCallback("onUpdate", () => {
        const t = tl.time();
        if (t < last) { last = 0; crossings = 0 }
        if (last < 0.6 && t >= 0.6) crossings++;
        last = t;
        if (crossings !== shown) { shown = crossings; count.textContent = String(crossings) }
      });`,
    checkpoints: frames(24, 30, 45),
  }),
  fixture({ name: "css-keyframes", cssMotion: true }),
  fixture({
    name: "webgl-canvas",
    captureTier: false,
    over: true,
    extra: WEBGL_TINT,
    checkpoints: frames(24, 30, 45),
    expectOn: { tier: "filter", reasonCode: "accelerated-canvas" },
  }),
  // The flip tile stays sharp beside the blurred card: no time in the trail matches an average of its poses.
  fixture({
    name: "flip-card-3d",
    moving: [],
    captureTier: false,
    extra: FLIP,
    style: "@keyframes flip { to { transform: rotateY(180deg) } }",
    checkpoints: HOLD_AFTER_FLIP,
    expectOn: { tier: "filter", reasonCode: "backface-visibility" },
  }),
  fixture({
    name: "overflow-wordmark",
    cardLeft: 20,
    cardStyle: "white-space:nowrap;overflow:visible;font:700 40px/40px monospace;color:#f5d76e",
    cardContent: "HYPERFRAME",
  }),
  fixture({
    name: "svg-clip-logo",
    extra: LOGO_CLIP,
    cardStyle: "background:#1f2a44",
    cardContent: `<div style="position:absolute;left:20px;top:0;width:40px;height:40px;background:linear-gradient(135deg,#ff7a59,#ffd166);clip-path:url(#logoClip)"></div>`,
  }),
  // The iframe stays sharp beside the blurred card: no time in the trail matches an average of its poses.
  fixture({
    name: "iframe-in-root",
    moving: [],
    captureTier: false,
    extra: `<iframe id="frame" srcdoc='<body style="margin:0;background:#a33;color:#fff">framed</body>' style="position:absolute;left:10px;top:10px;width:120px;height:60px;border:0"></iframe>`,
    expectOn: { tier: "filter", reasonCode: "iframe-in-root" },
  }),
  // The custom element stays sharp beside the blurred card: no time in the trail matches an average of its poses.
  fixture({
    name: "custom-element-in-root",
    moving: [],
    captureTier: false,
    extra: `<hf-badge style="position:absolute;left:10px;top:10px;display:block;width:120px;height:60px"></hf-badge>
      <script>
        customElements.define("hf-badge", class extends HTMLElement {
          connectedCallback() { this.style.background = "#357"; this.textContent = "badge" }
        });
      </script>`,
    expectOn: { tier: "filter", reasonCode: "iframe-in-root" },
  }),
  fixture({ name: "dpr2-mover", dpr: 2 }),
  fixture({ name: "portrait-mover", width: 180, height: 320 }),
];
