import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { expect } from "vitest";
import { waitForPendingSeekCompletion } from "../../frameCapture.js";
import { openFixture, type BlurWindow } from "./blurPage.js";

// Blur quiets a timeline's discrete callbacks while it scans and reads poses. Whatever a callback
// writes, a frame painted with blur on must show what blur off shows, and fire it as often.

const repoRoot = resolve(import.meta.dirname, "../../../../../..");
const GSAP = readFileSync(
  createRequire(resolve(repoRoot, "packages/core/package.json")).resolve("gsap/dist/gsap.min.js"),
  "utf8",
);

const WIDTH = 480;
const HEIGHT = 180;
export const ROW_TIMEOUT_MS = 180_000;
const frame = (k: number): number => k / 30;

export interface Row {
  id: string;
  name: string;
  setup: string;
  read?: string;
  extra?: string;
  seq?: number[];
  fresh?: number[];
}

const SCENE = `<div id="scene" data-composition-id="scene" data-start="0" data-duration="2" style="position:absolute;left:0;top:0"></div>`;

// Each setup runs with the root timeline `tl`, the `label`, a `fire` wrapper that counts calls, and
// `updates`, which the root timeline's onUpdate runs.
export const GSAP_ROWS: Row[] = [
  {
    id: "a",
    name: "classList.toggle, DOM only",
    setup: `tl.call(fire(()=>label.classList.toggle("on")),[],0.5)`,
    read: `label.className||"-"`,
  },
  {
    id: "b",
    name: "textContent=, DOM only",
    setup: `tl.call(fire(()=>{label.textContent="B"}),[],0.5)`,
  },
  {
    id: "c",
    name: "JS flag toggle",
    setup: `let on=false;tl.call(fire(()=>{on=!on;label.textContent=on?"B":"A"}),[],0.5)`,
  },
  {
    id: "d",
    name: "once-guard",
    setup: `let done=false;tl.call(fire(()=>{if(done)return;done=true;label.textContent="B"}),[],0.5)`,
  },
  {
    id: "e",
    name: "memo in onUpdate",
    setup: `const st={word:"A"};let shown="A";tl.call(fire(()=>{st.word="B"}),[],0.5);updates.push(()=>{if(st.word!==shown){label.textContent=st.word;shown=st.word}})`,
  },
  {
    id: "f",
    name: "i++; text=words[i]",
    setup: `const words=["A","B","C","D","E","F","G","H","I","J","K","L"];let i=0;tl.call(fire(()=>{i++;label.textContent=words[i]}),[],0.5)`,
  },
  {
    id: "g",
    name: "call starts gsap.to(label)",
    setup: `label.style.opacity="0.2";tl.call(fire(()=>{gsap.to(label,{opacity:1})}),[],0.5)`,
    read: `"tweensOf="+gsap.getTweensOf(label).length`,
  },
  {
    id: "h",
    name: "call writes into a shadow root",
    extra: `<div id="sh"></div>`,
    setup: `const sr=document.getElementById("sh").attachShadow({mode:"open"});sr.innerHTML='<span id="s">A</span>';tl.call(fire(()=>{sr.getElementById("s").textContent="B"}),[],0.5)`,
    read: `document.getElementById("sh").shadowRoot.getElementById("s").textContent`,
  },
  {
    id: "i",
    name: "non-zero tween onComplete",
    setup: `const p={v:0};tl.to(p,{v:1,duration:0.1,onComplete:fire(()=>{label.textContent="B"})},0.4)`,
  },
  {
    id: "j",
    name: "call exactly on a painted frame",
    setup: `let on=false;tl.call(fire(()=>{on=!on;label.textContent=on?"B":"A"}),[],0.5)`,
    seq: [frame(14), frame(15), frame(16)],
    fresh: [frame(15)],
  },
  {
    id: "k",
    name: "stagger's per-target onComplete",
    setup: `const ps=[{v:0},{v:0}];tl.to(ps,{v:1,duration:0.05,stagger:{each:0.05,onComplete:fire(()=>{label.textContent=label.textContent+"+"})}},0.4)`,
  },
  {
    id: "l",
    name: "keyframe-level onComplete",
    setup: `const p={v:0};tl.to(p,{keyframes:[{v:0.5,duration:0.05},{v:1,duration:0.05,onComplete:fire(()=>{label.textContent="B"})}]},0.4)`,
  },
  {
    id: "m",
    name: "sub-timeline call",
    setup: `const sub=gsap.timeline();sub.call(fire(()=>{label.textContent="B"}),[],0.2);tl.add(sub,0.3)`,
  },
  {
    id: "n",
    name: "sub-timeline onComplete",
    setup: `const sub=gsap.timeline({onComplete:fire(()=>{label.textContent="B"})});sub.to({v:0},{v:1,duration:0.1});tl.add(sub,0.4)`,
  },
  {
    id: "o",
    name: "root timeline onComplete",
    setup: `tl.eventCallback("onComplete",fire(()=>{label.textContent="END"}))`,
  },
  {
    id: "p",
    name: "tween onStart",
    setup: `const p={v:0};tl.to(p,{v:1,duration:0.2,onStart:fire(()=>{label.textContent="B"})},0.5)`,
  },
  {
    id: "q",
    name: "tween onRepeat",
    setup: `const p={v:0};let r=0;tl.to(p,{v:1,duration:0.1,repeat:1,onRepeat:fire(()=>{r++;label.textContent="R"+r})},0.4)`,
  },
  {
    id: "r",
    name: "call with params and scope",
    setup: `const o={w:"B"};const fn=fire(function(x){label.textContent=this.w+x});tl.call(fn,["!"],0.5);tl.getChildren(false,true,false).find(c=>c.vars.onComplete===fn).vars.callbackScope=o`,
  },
  {
    id: "s",
    name: "scene timeline call",
    extra: SCENE,
    setup: `const st=gsap.timeline({paused:true});st.call(fire(()=>{label.textContent="B"}),[],0.5);st.to({v:0},{v:1,duration:2},0);window.__timelines.scene=st`,
  },
  {
    id: "t",
    name: "tween onUpdate prints its value",
    setup: `const p={v:0};label.textContent="$0.0T";tl.to(p,{v:1,duration:0.2,ease:"none",onUpdate(){label.textContent="$"+p.v.toFixed(1)+"T"}},0.5)`,
  },
  {
    id: "u",
    name: "onStart sets up what onUpdate uses",
    setup: `const p={v:0};let rig;tl.to(p,{v:1,duration:0.5,onStart:fire(()=>{rig=label}),onUpdate(){rig.dataset.v=p.v.toFixed(1);rig.textContent="v"+rig.dataset.v}},0.2)`,
    seq: [0.1, 0.3, 0.7],
    fresh: [0.7],
  },
  {
    id: "v",
    name: "root onUpdate prints the time, painted at 0",
    setup: `updates.push(()=>{label.textContent="$"+tl.time().toFixed(1)+"T"})`,
    seq: [0, 0.7],
    fresh: [0],
  },
  {
    id: "w",
    name: "tween at 0 onUpdate prints its value, painted at 0",
    setup: `const p={v:0};tl.to(p,{v:1,duration:0.2,ease:"none",onUpdate(){label.textContent="$"+p.v.toFixed(1)+"T"}},0)`,
    seq: [0, 0.1, 0.7],
    fresh: [0],
  },
];

// A stand-in shaped like adapters/animejs.ts: seek(ms) runs whatever the page wrote, whether or not
// the caller asked to suppress events. Anime.js itself is not installed in this repo.
export const ONCE_ONLY_ADAPTER: Row = {
  id: "x",
  name: "non-GSAP adapter's once-only completion writes DOM",
  setup: `let d=false;window.__hfAnime=[{seek(ms){if(!d&&ms>=500){d=true;window.__fires++;label.textContent="B"}},pause(){},play(){}}]`,
};
export const STATELESS_ADAPTER: Row = {
  id: "y",
  name: "non-GSAP adapter's stateless write",
  setup: `window.__hfAnime=[{seek(ms){label.textContent=ms>=500?"B":"A"},pause(){},play(){}}]`,
};
export const MATRIX_ROWS: Row[] = [...GSAP_ROWS, STATELESS_ADAPTER];

const page = (
  row: Row,
  attrs: string,
  withUpdateMover: boolean,
): string => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}#card{position:absolute;left:0;top:60px;width:40px;height:20px;background:#e8a33d}
#rod{position:absolute;left:0;top:100px;width:40px;height:20px;background:#3de8a3}
#label{position:absolute;left:10px;top:10px;font:700 16px monospace;color:#fff}</style></head><body>
<div id="root" data-composition-id="root" data-start="0" data-duration="2" data-width="${WIDTH}" data-height="${HEIGHT}" ${attrs} style="position:relative;width:${WIDTH}px;height:${HEIGHT}px;background:#10131a;overflow:hidden">
<div id="label">A</div><div id="card"></div>${withUpdateMover ? '<div id="rod"></div>' : ""}${row.extra ?? ""}</div>
<script>${GSAP}</script><script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.to("#card",{x:300,duration:1,ease:"none"},0);tl.to({v:0},{v:1,duration:1},1);
const label=document.getElementById("label");window.__fires=0;
const fire=(fn)=>function(...a){window.__fires++;return fn.apply(this,a)};
const updates=[];tl.eventCallback("onUpdate",()=>{for(const u of updates)u()});
${withUpdateMover ? 'const rod=document.getElementById("rod");updates.push(()=>{rod.style.transform="translateX("+tl.time()*300+"px)"});' : ""}
${row.setup};
window.__read=()=>${row.read ?? "label.textContent"};
window.__timelines.root=tl;
</script></body></html>`;

interface Arm {
  name: string;
  attrs: string;
  tier: "capture" | "filter" | null;
  /** An onUpdate that moves an element makes pose reads run callbacks, so the per-frame mute runs too. */
  withUpdateMover: boolean;
}

const BLUR = 'data-motion-blur="on" data-motion-blur-events="on"';
const OFF: Arm = {
  name: "off",
  attrs: 'data-motion-blur="off"',
  tier: null,
  withUpdateMover: false,
};
// Every GSAP row paints the same in all four arms (the spike measured it). The two arms with a mover
// run both mutes, the scan's and the per-frame one, so they stand in for the two without.
export const BLUR_ARMS: Arm[] = [
  {
    name: "capture with an onUpdate mover",
    attrs: `${BLUR} data-motion-blur-tier="capture"`,
    tier: "capture",
    withUpdateMover: true,
  },
  {
    name: "filter with an onUpdate mover",
    attrs: `${BLUR} data-motion-blur-tier="filter"`,
    tier: "filter",
    withUpdateMover: true,
  },
];

interface Painted {
  read: string;
  fires: number;
  state: string;
  tier: string | null;
}

type Win = BlurWindow & { __read: () => unknown; __fires: number };

async function paintFrame(p: Page, t: number): Promise<void> {
  const pending = await p.evaluate((time) => {
    const w = window as BlurWindow;
    w.__player?.renderSeek?.(time);
    return w.__hf_page_composite_pending === true;
  }, t);
  await waitForPendingSeekCompletion(p);
  if (!pending) return;
  await p.evaluate(async () => {
    await (window as BlurWindow).__hf_page_composite_prepare?.();
  });
  const cdp = await p.createCDPSession();
  await cdp.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 1,
    clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
  });
  await cdp.detach();
  await p.evaluate(() => (window as BlurWindow).__hf_page_composite_resolve?.());
}

async function paint(
  browser: Browser,
  row: Row,
  arm: Arm,
  times: readonly number[],
): Promise<Painted[]> {
  const p = await openFixture(browser, page(row, arm.attrs, arm.withUpdateMover), 1, {
    width: WIDTH,
    height: HEIGHT,
  });
  const out: Painted[] = [];
  try {
    for (const t of times) {
      await paintFrame(p, t);
      out.push(
        await p.evaluate(() => {
          const w = window as unknown as Win;
          const report = w.__hfMotionBlur?.report();
          return {
            read: String(w.__read()),
            fires: w.__fires,
            state: report?.state ?? "none",
            tier: report?.tier ?? null,
          };
        }),
      );
    }
  } finally {
    await p.close();
  }
  return out;
}

const shown = (paints: Painted[]): Array<Pick<Painted, "read" | "fires">> =>
  paints.map(({ read, fires }) => ({ read, fires }));

/** The matrix is split over three test files so each fits the flake gate's per-run timeout. */
export const ROW_GROUPS = [
  ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  ["j", "k", "l", "m", "n", "o", "p", "q"],
  ["r", "s", "t", "u", "v", "w", "y"],
] as const;

export const rowsOfGroup = (group: number): Row[] =>
  MATRIX_ROWS.filter((row) => ROW_GROUPS[group]?.some((id) => id === row.id));

export async function expectRowMatchesBlurOff(browser: Browser, row: Row): Promise<void> {
  const seq = row.seq ?? [0.3, 0.7];
  const back = [...seq, seq[0] ?? 0];
  const fresh = row.fresh ?? [0.7];
  // One page paints `seq` and then goes back to its first time, so its first paints are the
  // in-order sequence and all of them are the one that goes back. Blur off is the same for every arm.
  const [offBack = [], offFresh = [], ...armed] = await Promise.all([
    paint(browser, row, OFF, back),
    paint(browser, row, OFF, fresh),
    ...BLUR_ARMS.flatMap((arm) => [
      paint(browser, row, arm, back),
      paint(browser, row, arm, fresh),
    ]),
  ]);
  BLUR_ARMS.forEach((arm, k) => {
    const onBack = armed[2 * k] ?? [];
    const onFresh = armed[2 * k + 1] ?? [];
    const sequences: Array<[string, Painted[], Painted[]]> = [
      ["painted in order", onBack.slice(0, seq.length), offBack.slice(0, seq.length)],
      ["a fresh worker", onFresh, offFresh],
      ["painted in order, then back to the first time", onBack, offBack],
    ];
    for (const [label, on, off] of sequences) {
      expect(
        on.map(({ state, tier }) => ({ state, tier })),
        `${arm.name}, ${label}: blur engaged`,
      ).toEqual(on.map(() => ({ state: "on", tier: arm.tier })));
      expect(shown(on), `${arm.name}, ${label}`).toEqual(shown(off));
    }
  });
}

export async function expectOnceOnlyCompletionShowsEarly(browser: Browser): Promise<void> {
  const painted = await Promise.all(
    BLUR_ARMS.map((arm) => paint(browser, ONCE_ONLY_ADAPTER, arm, [0.3, 0.7])),
  );
  BLUR_ARMS.forEach((arm, k) => {
    expect(
      (painted[k] ?? []).map(({ read }) => read),
      arm.name,
    ).toEqual(["B", "B"]);
  });
}
