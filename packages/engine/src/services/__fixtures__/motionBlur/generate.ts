import { fixture, type BlurFixture } from "./fixtures.js";

export const FEATURES = [
  "transform",
  "leftTop",
  "rotation",
  "overflowParent",
  "scrollContainer",
  "canvas2d",
  "webgl",
  "svgClip",
  "mask",
  "onUpdateMover",
  "tlCall",
  "onceGuard",
  "cssKeyframes",
  "nesting",
  "pseudoElement",
  "panelInFront",
  "blendMode",
  "fixedChild",
  "lastChild",
] as const;

export type Feature = (typeof FEATURES)[number];

export const EXCLUDED_FEATURES = { ownClipPath: "E", visibilityToggle: "O" } as const;

export type GeneratedFixture = BlurFixture & { seed: number; features: readonly Feature[] };

const WIDTH = 320;
const SLOT_WIDTH = 96;
const SLOT_HEIGHT = 52;
const SLOTS = [8, 112, 216].flatMap((x) => [8, 120].map((y) => ({ x, y })));
const CHECKPOINT_FRAMES = [15, 30, 45];
const MOVING_FRAMES = [6, 54];
const ONCE_FRAMES = [20, 23, 26, 35, 38, 41];

interface Slot {
  x: number;
  y: number;
}

interface Part {
  css?: string;
  markup?: string;
  script?: string;
  card?: string;
  content?: string;
  last?: string;
}

interface Draw {
  slot(): Slot;
  pick<T>(items: readonly T[]): T;
  flip(): boolean;
}

const hash = (seed: number): number => Math.imul(seed + 0x9e3779b9, 0x85ebca6b) >>> 0;

function lcg(seed: number): () => number {
  let state = hash(seed);
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let i = 0; i < 4; i++) next();
  return next;
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const props = (values: Record<string, number | string>): string => JSON.stringify(values);

const tween = (sel: string, from: object, to: object, ease: string): string =>
  `tl.fromTo(${JSON.stringify(sel)},${JSON.stringify(from)},${JSON.stringify({ ...to, duration: 0.4, ease })},0);`;

function inOut(
  sel: string,
  from: Record<string, number | string>,
  rest: Record<string, number | string>,
  away: Record<string, number | string>,
): string {
  return `${tween(sel, from, rest, "power2.out")}
    tl.to(${JSON.stringify(sel)},${props({ ...away, duration: 0.4, ease: "power2.in" })},1.6);`;
}

const el = (id: string, style: string, inner = ""): string =>
  `<div id="${id}" style="position:absolute;z-index:1;${style}">${inner}</div>`;

const at = (s: Slot, width = 30, height = 30): string =>
  `left:${s.x}px;top:${s.y}px;width:${width}px;height:${height}px`;

const fromLeft = (s: Slot): number => -(s.x + 120);
const toRight = (s: Slot): number => WIDTH - s.x + 40;

const frame = (k: number): number => k / 30;

const PALETTE = ["#1c2330", "#2b3a55", "#3d2b55", "#2b553d"];

const wrapped = (id: string, s: Slot, wrapperStyle: string): Part => ({
  markup: el(
    `${id}w`,
    `${at(s, SLOT_WIDTH, SLOT_HEIGHT)};background:#1f2a44;${wrapperStyle}`,
    el(id, "left:30px;top:10px;width:30px;height:30px;background:#ffd166"),
  ),
  script: inOut(`#${id}`, { x: -150 }, { x: 0 }, { x: 150 }),
});

const BUILDERS: Record<Feature, (draw: Draw) => Part> = {
  transform: () => ({
    script: `${tween("#card", { y: 30, scale: 0.6 }, { y: 0, scale: 1 }, "power2.out")}
      tl.to("#card",${props({ y: -30, scale: 0.6, duration: 0.4, ease: "power2.in" })},1.6);`,
  }),
  leftTop: ({ slot }) => {
    const s = slot();
    return {
      markup: el("lt", `${at(s)};background:#e63946`),
      script: inOut(
        "#lt",
        { left: fromLeft(s), top: 130 },
        { left: s.x, top: s.y },
        { left: 340, top: 130 },
      ),
    };
  },
  rotation: () => ({
    script: `${tween("#card", { rotation: -90 }, { rotation: 0 }, "power2.out")}
      tl.to("#card",${props({ rotation: 90, duration: 0.4, ease: "power2.in" })},1.6);`,
  }),
  overflowParent: ({ slot }) => {
    const s = slot();
    return {
      markup: el(
        "ovw",
        `${at(s, SLOT_WIDTH, SLOT_HEIGHT)};overflow:hidden;border-radius:12px;background:#223`,
        el("ov", "left:8px;top:10px;width:30px;height:30px;background:#e63946"),
      ),
      script: inOut("#ov", { x: -60 }, { x: 20 }, { x: 140 }),
    };
  },
  scrollContainer: ({ slot }) => {
    const s = slot();
    const rows = Array.from(
      { length: 12 },
      (_, i) => `<div style="height:20px;background:${PALETTE[i % PALETTE.length]}"></div>`,
    ).join("");
    return {
      markup: el(
        "sc",
        `${at(s, SLOT_WIDTH, SLOT_HEIGHT)};overflow:auto;scrollbar-width:none`,
        rows,
      ),
      script: `const scrolled = { v: 0 };
        tl.to(scrolled,{ v: 100, duration: 0.4, ease: "power2.out", onUpdate() { document.getElementById("sc").scrollTop = scrolled.v } },0);`,
    };
  },
  canvas2d: ({ slot, flip }) => {
    const s = slot();
    const canvas = `<canvas id="cv" width="${SLOT_WIDTH}" height="${SLOT_HEIGHT}" style="position:absolute;z-index:1;left:${s.x}px;top:${s.y}px"></canvas>`;
    return {
      markup: flip()
        ? `<section style="position:absolute;inset:0;overflow:hidden;will-change:transform,filter,opacity;z-index:1">${canvas}</section>`
        : canvas,
      script: `const cvx = document.getElementById("cv").getContext("2d");
        const draw = () => {
          const p = Math.min(1, tl.time() / 0.4);
          cvx.fillStyle = "#2a9d8f";
          cvx.fillRect(0, 0, ${SLOT_WIDTH}, ${SLOT_HEIGHT});
          cvx.fillStyle = "#ffd166";
          cvx.fillRect(4, 4, 88 * p, 20);
          cvx.strokeStyle = "#fff";
          cvx.strokeRect(2, 28, 92, 22);
        };
        tl.to({}, { duration: 2, onUpdate: draw }, 0);`,
    };
  },
  webgl: ({ slot }) => {
    const s = slot();
    return {
      markup: `<canvas id="gl" width="${SLOT_WIDTH}" height="${SLOT_HEIGHT}" style="position:absolute;z-index:1;left:${s.x}px;top:${s.y}px"></canvas>
        <script>(() => {
          const g = document.getElementById("gl").getContext("webgl");
          g.clearColor(0.05, 0.2, 0.5, 0.6);
          g.clear(g.COLOR_BUFFER_BIT);
        })();</script>`,
    };
  },
  svgClip: ({ slot, flip }) => {
    const s = slot();
    const defs = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><clipPath id="genClip" clipPathUnits="objectBoundingBox"><polygon points="0.5,0 1,0.5 0.5,1 0,0.5"/></clipPath></defs></svg>`;
    const clip = "clip-path:url(#genClip)";
    if (flip()) {
      const part = wrapped("sv", s, clip);
      return { ...part, markup: defs + part.markup };
    }
    return {
      markup:
        defs +
        el(
          "sibling",
          `${at(s, 60, 44)};background:linear-gradient(135deg,#ff7a59,#ffd166);${clip}`,
        ),
    };
  },
  mask: ({ slot, flip }) => {
    const s = slot();
    const mask =
      "-webkit-mask-image:radial-gradient(circle,#000 40%,transparent 75%);mask-image:radial-gradient(circle,#000 40%,transparent 75%)";
    return flip()
      ? wrapped("mk", s, mask)
      : {
          markup: el(
            "masked",
            `${at(s, SLOT_WIDTH, SLOT_HEIGHT)};background:linear-gradient(90deg,#ff7a59,#06d6a0);${mask}`,
          ),
        };
  },
  onUpdateMover: ({ slot }) => {
    const s = slot();
    return {
      markup: el("ou", `${at(s)};background:#9b5de5;transform:translate(${fromLeft(s)}px,0)`),
      script: `const driven = { v: 0 };
        const place = () => {
          const v = driven.v;
          document.getElementById("ou").style.transform = "translate(" + (v <= 1 ? ${fromLeft(s)} * (1 - v) : ${toRight(s)} * (v - 1)) + "px,0)";
        };
        tl.to(driven,{ v: 1, duration: 0.4, ease: "power2.out", onUpdate: place },0)
          .to(driven,{ v: 2, duration: 0.4, ease: "power2.in", onUpdate: place },1.6);`,
    };
  },
  tlCall: ({ slot, flip }) => {
    const s = slot();
    const byClass = flip();
    return {
      css: byClass ? "#fl.on { background: #06d6a0 }" : "",
      markup: el("fl", `${at(s)};background:#3a86ff`),
      script: byClass
        ? `const fl = document.getElementById("fl");
          tl.call(() => fl.classList.add("on"), null, 0.7).call(() => fl.classList.remove("on"), null, 1.3);`
        : `const fl = document.getElementById("fl");
          tl.call(() => { fl.style.background = "#06d6a0" }, null, 0.7).call(() => { fl.style.background = "#3a86ff" }, null, 1.3);`,
    };
  },
  onceGuard: ({ slot, pick }) => {
    const s = slot();
    return {
      markup: el("og", `${at(s)};background:#ef476f`),
      script: `let fired = false;
        tl.call(() => { if (fired) return; fired = true; document.getElementById("og").style.background = "#ffd166" }, null, ${frame(pick(ONCE_FRAMES))});`,
    };
  },
  cssKeyframes: ({ slot }) => {
    const s = slot();
    return {
      css: `@keyframes genSlide {
        0% { transform: translateX(${fromLeft(s)}px); animation-timing-function: ease-out }
        20% { transform: translateX(0) }
        80% { transform: translateX(0); animation-timing-function: ease-in }
        100% { transform: translateX(${toRight(s)}px) }
      }`,
      markup: el("ck", `${at(s)};background:#118ab2;animation:genSlide 2s linear both`),
    };
  },
  nesting: ({ slot }) => {
    const s = slot();
    return {
      markup: el(
        "no",
        `${at(s, SLOT_WIDTH, SLOT_HEIGHT)};background:#264653`,
        `<div id="ni" style="position:absolute;left:6px;top:10px;width:30px;height:30px;background:#e9c46a"></div>`,
      ),
      script: `${inOut("#no", { x: fromLeft(s) }, { x: 0 }, { x: toRight(s) })}
        tl.to("#ni",{ x: 50, duration: 0.4, ease: "power2.inOut" },0);`,
    };
  },
  pseudoElement: ({ pick }) => {
    const before = `#card::before { content: ""; position: absolute; left: -34px; top: 8px; width: 24px; height: 24px; border-radius: 50%; background: #ffd166 }`;
    const after = `#card::after { content: ""; position: absolute; left: 90px; top: 8px; width: 24px; height: 24px; border-radius: 50%; background: #06d6a0 }`;
    return { css: pick([before, after, `${before} ${after}`]) };
  },
  panelInFront: () => ({
    markup: `<div style="position:absolute;left:150px;top:60px;width:34px;height:54px;background:#ffd166;border:3px solid #000;z-index:5"></div>`,
  }),
  blendMode: () => ({
    markup: `<div style="position:absolute;left:215px;top:60px;width:50px;height:60px;background:#fff;mix-blend-mode:difference;z-index:5"></div>`,
  }),
  fixedChild: () => ({
    content: `<div style="position:fixed;left:6px;top:6px;width:24px;height:12px;background:#ffd166"></div>`,
  }),
  lastChild: () => ({
    css: "#root > :last-child { outline: 3px solid #ffd166 }",
    last: `<div id="last" style="position:absolute;left:290px;top:150px;width:20px;height:20px;background:#000"></div>`,
  }),
};

function chooseFeatures(next: () => number): Feature[] {
  const count = 1 + Math.floor(next() * 4);
  const chosen = new Set(shuffled(FEATURES, next).slice(0, count));
  return FEATURES.filter((feature) => chosen.has(feature));
}

export function generateComposition(seed: number): GeneratedFixture {
  const next = lcg(seed);
  const features = chooseFeatures(next);
  const free = shuffled(SLOTS, next);
  const draw: Draw = {
    slot: () => {
      const taken = free.pop();
      if (!taken) throw new Error("out of slots");
      return taken;
    },
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    flip: () => next() < 0.5,
  };
  const parts = features.map((feature) => BUILDERS[feature](draw));
  const join = (key: "css" | "markup" | "script" | "content" | "last"): string =>
    parts.map((part) => part[key] ?? "").join("\n");
  const checkpoints = shuffled(CHECKPOINT_FRAMES, next)
    .slice(0, 2)
    .sort((a, b) => a - b)
    .map(frame);
  const moving = [frame(draw.pick(MOVING_FRAMES))];
  const base = fixture({
    name: `seed ${seed} [${features.join(", ")}]`,
    captureTier: false,
    over: true,
    cardStyle: `z-index:2;${parts.map((part) => part.card ?? "").join("")}`,
    cardContent: join("content"),
    extra: join("markup") + join("last"),
    style: join("css"),
    script: join("script"),
    checkpoints,
    moving,
    expectOn: { tier: "filter", reasonCode: "tier-auto" },
  });
  return { ...base, seed, features };
}

export function parseSeeds(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map((n) => Number.parseInt(n, 10));
    if (from === undefined || to === undefined || Number.isNaN(from) || Number.isNaN(to)) {
      throw new Error(`bad seed list: ${spec}`);
    }
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
}
