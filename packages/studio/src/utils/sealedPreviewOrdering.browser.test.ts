// Real Chrome, sealed preview: Studio's saves (script re-runs, tween patches, retimes, undos) reach the frame or are
// refused, their replies arrive in any order, and the frame may reload. Once every reply has settled, the preview
// must equal a fresh load of the saved file, with a full reload only after a refusal nothing can recover in place.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, type Studio } from "../../tests/sealedPreviewHarness";
import {
  playSequence,
  type SequenceFixture,
  type SaveFate,
  type SequenceStep,
} from "../../tests/sealedPreviewSequence";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const GSAP = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
const RUNTIME = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
const MARK = '<meta name="hyperframes-studio-preview" content="1" />';
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle();
});
afterAll(() => closeTestChrome(browser));

/** The saved file, as the fields a step can change. */
interface Saved {
  gen: number;
  x: number;
  start: number;
  dur: number;
  /** `data-start` of a clip no script animates, so the frame restores it in place. */
  dStart: number;
  label: string;
  title: string;
}
const FIRST: Saved = { gen: 0, x: 10, start: 0, dur: 4, dStart: 0, label: "a", title: "a" };

const script = (s: Saved) => `(function () {
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    tl.set("#target", { x: ${s.x} }, 0);
    tl.to("#target", { y: 100, duration: ${s.dur}, ease: "none" }, 0);
    window.__timelines["main"] = tl;
    window.__ran = { main: "g${s.gen}" };
  })();`;
const root = (s: Saved) =>
  `<div id="root" data-hf-id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">` +
  `<div id="target" data-hf-id="target" class="clip box" data-start="${s.start}" data-duration="4" data-track-index="1" style="left: 100px; top: 100px"></div>` +
  `<div id="c" data-hf-id="c" class="clip box" data-start="0" data-duration="4" data-track-index="2" data-label="${s.label}" title="${s.title}" style="left: 0px; top: 500px"></div>` +
  `<div id="d" data-hf-id="d" class="clip box" data-start="${s.dStart}" data-duration="3" data-track-index="3" style="left: 400px; top: 500px"></div>` +
  `</div>`;
/** A second GSAP script, so the file has no single script to re-run. */
const SIDE = `window.__timelines = window.__timelines || {};
  window.__timelines["side"] = gsap.timeline({ paused: true }).to("#c", { opacity: 0.5, duration: 4 }, 0);`;
const scripts = (s: Saved, two: boolean) =>
  `<script>${script(s)}</script>${two ? `<script>${SIDE}</script>` : ""}`;
/** The saved file as Studio reads it; every element carries the `data-hf-id` Studio's server gives it. */
const file = (s: Saved, two = false) => `<html><body>${root(s)}${scripts(s, two)}</body></html>`;
/** The saved file as the preview loads it. */
const page = (s: Saved, two = false) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${MARK}
  <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
    #root { position: relative; width: 100%; height: 100% } .box { position: absolute; width: 200px; height: 200px }</style>
  </head><body>${root(s)}<script>${GSAP}</script>${scripts(s, two)}<script>${RUNTIME}</script></body></html>`;

// A label is restore-safe and applies in place; a title is not (restoreAttributes.ts), so the frame refuses it.
type Save =
  | "run"
  | "patch"
  | "retime"
  | "liveRetime"
  | "undoLabel"
  | "undoTitle"
  | "undoBoth"
  | "undoStart";
type Step = SequenceStep<Save>;

const next: Record<Save, (s: Saved, n: number) => Saved> = {
  run: (s) => ({ ...s, gen: s.gen + 1 }),
  patch: (s, n) => ({ ...s, x: 20 + n }),
  retime: (s) => ({ ...s, start: 1 - s.start }),
  liveRetime: (s) => ({ ...s, start: 1 - s.start, dur: s.dur === 4 ? 3 : 4 }),
  undoLabel: (s) => ({ ...s, label: s.label === "a" ? "b" : "a" }),
  undoTitle: (s) => ({ ...s, title: s.title === "a" ? "b" : "a" }),
  undoBoth: (s) => ({ ...s, gen: s.gen + 1, title: s.title === "a" ? "b" : "a" }),
  undoStart: (s) => ({ ...s, dStart: 1 - s.dStart }),
};

/** Sends `save` the way Studio does after writing the file from `before` to `after`. */
function send(studioPage: Page, save: Save, before: Saved, after: Saved, two: boolean) {
  return studioPage.evaluate(
    (kind, prev, saved, savedPage, x, text) => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const w = window as unknown as { __saved: string; __reload: () => void; __refusals: number };
      w.__saved = savedPage;
      // Studio's own write of the file, as the save does before the preview sync.
      studio.markStudioWriteToken(`save-${savedPage.length}-${Date.now()}`);
      // A reload Studio asks for because nothing can apply in place counts as a refusal that allows one.
      const reloadNow = () => {
        w.__refusals++;
        w.__reload();
      };
      let sending = true;
      const reloadPreview = () => (sending ? reloadNow() : w.__reload());
      const iframe = document.querySelector("iframe")!;
      const time = studio.usePlayerStore.getState().currentTime;
      const rerun = { currentTimeOverride: time, authoredHtml: saved, previousHtml: prev };
      // As Studio's timing sync (timelineTimingSync.ts): move the live tweens, or re-run the script with its timing
      // at the playhead then.
      if (kind === "liveRetime")
        void Promise.resolve(
          studio.moveLiveTweens(iframe, text, time, w.__reload, { before: prev, after: saved }),
        ).then((moved) => {
          if (moved) return;
          const now = studio.usePlayerStore.getState().currentTime;
          const options = {
            ...rerun,
            currentTimeOverride: now,
            timingEdit: true,
            onAsyncFailure: w.__reload,
          };
          if (studio.applySoftReload(iframe, text, options) === "cannot-soft-reload") reloadNow();
        });
      // As Studio's preview sync: a run nothing can apply in place reloads.
      const rerunOrReload = (timingEdit: boolean) => {
        const options = { ...rerun, timingEdit, onAsyncFailure: w.__reload };
        if (studio.applySoftReload(iframe, text, options) === "cannot-soft-reload") reloadNow();
      };
      if (kind === "run") rerunOrReload(false);
      if (kind === "retime") rerunOrReload(true);
      if (kind === "patch") {
        const instantPatch = {
          selector: "#target",
          change: { kind: "set" as const, props: { x } },
        };
        const result = { ok: true, scriptText: text, before: prev, after: saved };
        studio.applyPreviewSync(
          iframe,
          result,
          { label: "drag", softReload: true, instantPatch },
          reloadPreview,
        );
      }
      if (kind.startsWith("undo")) {
        const files = { "index.html": { previous: prev, restored: saved } };
        studio.applyUndoRestoreToPreview(iframe, null, files, time, reloadPreview);
      }
      sending = false;
    },
    save,
    file(before, two),
    file(after, two),
    page(after, two),
    after.x,
    script(after),
  );
}

const fixture = (two: boolean): SequenceFixture<Saved, Save> => ({
  first: FIRST,
  page: (s) => page(s, two),
  next,
  send: (studioPage, save, before, after) => send(studioPage, save, before, after, two),
  at: 2,
  /** What a viewer sees: the script that ran, the clip timing, the label and title, and the tween's values. */
  read: (frame) =>
    frame.evaluate(() => {
      const target = document.getElementById("target")!;
      const m = new DOMMatrix(getComputedStyle(target).transform);
      return {
        ran: (window as unknown as { __ran: { main: string } }).__ran.main,
        start: target.getAttribute("data-start"),
        dStart: document.getElementById("d")!.getAttribute("data-start"),
        label: document.getElementById("c")!.getAttribute("data-label"),
        title: document.getElementById("c")!.getAttribute("title"),
        x: Math.round(m.m41),
        y: Math.round(m.m42),
      };
    }),
});
const ONE_SCRIPT = fixture(false);
const TWO_SCRIPTS = fixture(true);
const play = (steps: Step[], seed = 1, two = false) =>
  playSequence(browser, studioBundle, two ? TWO_SCRIPTS : ONE_SCRIPT, steps, seed);

// The reviewer's sequences: the first and third are red without the fix; the second guards its class.
type Fixed = [string, Step[], { seed?: number; two?: boolean }?];
const SEEDS: Fixed[] = [
  [
    "an undo of a script and a title the frame refuses, held past a newer script-only run",
    [
      { save: "undoBoth", fate: "frame" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { answer: "oldest" },
    ],
  ],
  [
    // A guard, not the reviewer's sequence: his retime went through live-retime, which this harness does not
    // send (sealedPreviewLedger.test.ts reproduces it); seed 28 reproduces the lost data-start here.
    "a refused patch, then a refused retime re-run, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "retime", fate: "refused" },
      { answer: "patch-tweens" },
    ],
  ],
  [
    "a refused patch, then a static undo, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "undoLabel", fate: "frame" },
      { answer: "any" },
      { answer: "patch-tweens" },
    ],
  ],
  // The reviewer's round-8 probes, as written.
  [
    "a refused patch, a live retime whose refusal is pending and a static undo, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "liveRetime", fate: "refused" },
      { save: "undoLabel", fate: "frame" },
      { answer: "patch-tweens" },
    ],
  ],
  [
    "a refused live retime, then a script-only run, then the retime's refusal",
    [
      { save: "liveRetime", fate: "refused" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { answer: "live-retime" },
    ],
  ],
  [
    "a refused live retime at 2 s, a newer run, a scrub to 4 s, then the retime's refusal",
    [
      { save: "liveRetime", fate: "refused" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { scrub: 4 },
      { answer: "live-retime" },
    ],
  ],
  [
    "a retime the port rejects before applying, answered after a newer script-only run painted",
    [
      { save: "retime", fate: "rejected" },
      { save: "run", fate: "frame" },
      { answer: "newest" },
      { answer: "soft-reload" },
    ],
  ],
  // The reviewer's round-9 probes, as written.
  [
    "two scripts: a refused patch, then an undo of data-start applied, then the patch's refusal",
    [
      { save: "patch", fate: "refused" },
      { save: "undoStart", fate: "frame" },
      { answer: "oldest" },
      { answer: "patch-tweens" },
    ],
    { two: true },
  ],
  [
    "an undo of a script and a title the frame refuses, and a newer run, both answered after the undo's deadline",
    [
      { save: "undoBoth", fate: "frame" },
      { save: "run", fate: "frame" },
      { pastDeadline: true },
      { answer: "oldest" },
      { answer: "oldest" },
    ],
  ],
  // A guard: Studio's reload loads the newer file again when a save lands during it (useShadowPreviewReload.ts).
  [
    "a run saved while the reload from a refused title undo is in flight",
    [{ save: "undoTitle", fate: "frame" }, { answer: "oldest" }, { save: "run", fate: "frame" }],
  ],
  // The round-8 generator's seeds that found a class without the fix, kept as it generated them: 50 a recovery
  // dropping saved timing; 80 and 261 a recovery rewinding a newer scrub; 312, 147 and 377 a port rejection taken
  // for a missing reply.
  ...(
    [
      [
        50,
        [
          { save: "undoLabel", fate: "frame" },
          { answer: "any" },
          { answer: "any" },
          { scrub: 4 },
          { save: "undoBoth", fate: "refused" },
          { reloadFrame: true },
          { save: "liveRetime", fate: "refused" },
          { save: "patch", fate: "frame" },
        ],
      ],
      [
        80,
        [
          { scrub: 1 },
          { save: "undoBoth", fate: "frame" },
          { answer: "any" },
          { save: "liveRetime", fate: "refused" },
          { save: "run", fate: "frame" },
          { save: "retime", fate: "frame" },
          { scrub: 4 },
          { save: "run", fate: "refused" },
        ],
      ],
      [
        261,
        [
          { scrub: 3 },
          { scrub: 1 },
          { save: "liveRetime", fate: "refused" },
          { save: "retime", fate: "frame" },
          { reloadFrame: true },
          { save: "liveRetime", fate: "refused" },
          { scrub: 3 },
          { answer: "any" },
        ],
      ],
      [
        312,
        [
          { answer: "any" },
          { scrub: 4 },
          { reloadFrame: true },
          { answer: "any" },
          { reloadFrame: true },
          { save: "liveRetime", fate: "rejected" },
          { scrub: 4 },
          { save: "run", fate: "frame" },
        ],
      ],
      [
        147,
        [
          { save: "patch", fate: "frame" },
          { answer: "any" },
          { scrub: 3 },
          { save: "patch", fate: "frame" },
          { answer: "any" },
          { save: "undoBoth", fate: "rejected" },
          { save: "liveRetime", fate: "frame" },
          { save: "patch", fate: "rejected" },
        ],
      ],
      [
        377,
        [
          { save: "undoBoth", fate: "rejected" },
          { answer: "any" },
          { reloadFrame: true },
          { save: "patch", fate: "frame" },
          { answer: "any" },
          { scrub: 4 },
          { save: "undoBoth", fate: "rejected" },
          { save: "liveRetime", fate: "refused" },
        ],
      ],
    ] as Array<[number, Step[]]>
  ).map(([seed, steps]): Fixed => [`round-8 seed ${seed}`, steps, { seed }]),
];

describe("sealed preview after late answers in any order", () => {
  it.each(SEEDS)("%s", async (name, steps, { seed, two } = {}) => {
    const { shown, fresh, reloads, reloadRefusals, playhead } = await play(steps, seed, two);
    expect(shown).toEqual(fresh);
    expect(playhead.shown).toBeCloseTo(playhead.studio, 1);
    // A two-script file has no single script to snapshot, so a recovery there may only reload.
    if (reloadRefusals === 0 && !two) expect(reloads).toBe(0);
    // The frame cannot set a title in place, so the refused undo recovers only by reloading.
    if (name.includes("title")) expect(reloads).toBeGreaterThan(0);
  });

  const SAVES = Object.keys(next) as Save[];
  const FATES: SaveFate[] = ["frame", "frame", "refused", "rejected", "never"];
  const SCRUBS = [1, 3, 4];
  const generated = (seed: number): Step[] => {
    let state = seed;
    const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
    return Array.from({ length: 8 }, (): Step => {
      const roll = random();
      if (roll < 0.06) return { reloadFrame: true };
      if (roll < 0.14) return { scrub: pick(SCRUBS) };
      if (roll < 0.2) return { pastDeadline: true };
      if (roll < 0.47) return { answer: "any" };
      return { save: pick(SAVES), fate: pick(FATES) };
    });
  };
  const base = Number(process.env.HF_ORDERING_SEED_BASE ?? 0);
  // Seeds that found a round-9 class without the fix, run every time: 312 and 320 a write of saved state never
  // answered, then covered by a script-only run; 2101, 3037 and 3657 a two-script file's newer timing undo overwritten.
  const PINNED = [312, 320, 2101, 3037, 3657];
  const listed = process.env.HF_ORDERING_SEED_LIST?.split(",").map(Number);
  const range = Array.from(
    { length: Number(process.env.HF_ORDERING_SEEDS ?? 40) },
    (_, i) => base + i + 1,
  );
  const seeds = listed ?? [...new Set([...PINNED, ...range])];
  // Odd seeds play a file with two GSAP scripts, so no save has a single script to re-run.
  it.each(seeds)("generated sequence %i", async (seed) => {
    const steps = generated(seed);
    const two = seed % 2 === 1;
    const { shown, fresh, reloads, reloadRefusals, playhead } = await play(steps, seed, two);
    expect({ steps, state: shown }).toEqual({ steps, state: fresh });
    // The preview's playhead stays where Studio last put it, within a frame.
    expect({
      steps,
      off: Math.abs(playhead.shown - playhead.studio) > 1 / 30,
      playhead,
    }).toMatchObject({
      steps,
      off: false,
    });
    // Only a refused re-run or restore, or a two-script file, leaves nothing to recover in place.
    if (reloadRefusals === 0 && !two) expect({ steps, reloads }).toEqual({ steps, reloads: 0 });
  });
});
