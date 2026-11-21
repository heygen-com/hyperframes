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
  label: string;
  title: string;
}
const FIRST: Saved = { gen: 0, x: 10, start: 0, label: "a", title: "a" };

const script = (s: Saved) => `(function () {
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    tl.set("#target", { x: ${s.x} }, 0);
    tl.to("#target", { y: 100, duration: 4, ease: "none" }, 0);
    window.__timelines["main"] = tl;
    window.__ran = { main: "g${s.gen}" };
  })();`;
const root = (s: Saved) =>
  `<div id="root" data-hf-id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">` +
  `<div id="target" data-hf-id="target" class="clip box" data-start="${s.start}" data-duration="4" data-track-index="1" style="left: 100px; top: 100px"></div>` +
  `<div id="c" data-hf-id="c" class="clip box" data-start="0" data-duration="4" data-track-index="2" data-label="${s.label}" title="${s.title}" style="left: 0px; top: 500px"></div>` +
  `</div>`;
/** The saved file as Studio reads it; every element carries the `data-hf-id` Studio's server gives it. */
const file = (s: Saved) => `<html><body>${root(s)}<script>${script(s)}</script></body></html>`;
/** The saved file as the preview loads it. */
const page = (s: Saved) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${MARK}
  <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
    #root { position: relative; width: 100%; height: 100% } .box { position: absolute; width: 200px; height: 200px }</style>
  </head><body>${root(s)}<script>${GSAP}</script><script>${script(s)}</script><script>${RUNTIME}</script></body></html>`;

// A label is restore-safe and applies in place; a title is not (restoreAttributes.ts), so the frame refuses it.
type Save = "run" | "patch" | "retime" | "undoLabel" | "undoTitle" | "undoBoth";
type Step = SequenceStep<Save>;

const next: Record<Save, (s: Saved, n: number) => Saved> = {
  run: (s) => ({ ...s, gen: s.gen + 1 }),
  patch: (s, n) => ({ ...s, x: 20 + n }),
  retime: (s) => ({ ...s, start: 1 - s.start }),
  undoLabel: (s) => ({ ...s, label: s.label === "a" ? "b" : "a" }),
  undoTitle: (s) => ({ ...s, title: s.title === "a" ? "b" : "a" }),
  undoBoth: (s) => ({ ...s, gen: s.gen + 1, title: s.title === "a" ? "b" : "a" }),
};

/** Sends `save` the way Studio does after writing the file from `before` to `after`. */
function send(studioPage: Page, save: Save, before: Saved, after: Saved) {
  return studioPage.evaluate(
    (kind, prev, saved, savedPage, x) => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const w = window as unknown as { __saved: string; __reload: () => void };
      w.__saved = savedPage;
      const iframe = document.querySelector("iframe")!;
      const text = saved.match(/<script>([\s\S]*)<\/script>/)![1]!;
      const rerun = { currentTimeOverride: 2, authoredHtml: saved, previousHtml: prev };
      if (kind === "run")
        studio.applySoftReload(iframe, text, { ...rerun, onAsyncFailure: w.__reload });
      if (kind === "retime")
        studio.applySoftReload(iframe, text, {
          ...rerun,
          timingEdit: true,
          onAsyncFailure: w.__reload,
        });
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
          w.__reload,
        );
      }
      if (kind === "undoLabel" || kind === "undoTitle" || kind === "undoBoth") {
        const files = { "index.html": { previous: prev, restored: saved } };
        studio.applyUndoRestoreToPreview(iframe, null, files, 2, w.__reload);
      }
    },
    save,
    file(before),
    file(after),
    page(after),
    after.x,
  );
}

const FIXTURE: SequenceFixture<Saved, Save> = {
  first: FIRST,
  page,
  next,
  send,
  at: 2,
  /** What a viewer sees: the script that ran, the clip timing, the label and title, and the tween's values. */
  read: (frame) =>
    frame.evaluate(() => {
      const target = document.getElementById("target")!;
      const m = new DOMMatrix(getComputedStyle(target).transform);
      return {
        ran: (window as unknown as { __ran: { main: string } }).__ran.main,
        start: target.getAttribute("data-start"),
        label: document.getElementById("c")!.getAttribute("data-label"),
        title: document.getElementById("c")!.getAttribute("title"),
        x: Math.round(m.m41),
        y: Math.round(m.m42),
      };
    }),
};
const play = (steps: Step[], seed = 1) => playSequence(browser, studioBundle, FIXTURE, steps, seed);

// The three sequences a reviewer probed by hand, as written in the review; each is red without the fix.
const SEEDS: Array<[string, Step[]]> = [
  [
    "an undo of a script and a title the frame refuses, held past a newer script-only run",
    [
      { save: "undoBoth", refused: false },
      { save: "run", refused: false },
      { answer: "newest" },
      { answer: "oldest" },
    ],
  ],
  [
    "a patch refusal held while a retime to data-start 1 saves, then the patch recovers",
    [
      { save: "patch", refused: true },
      { save: "retime", refused: true },
      { answer: "patch-tweens" },
    ],
  ],
  [
    "a refused patch, then a static undo, then the patch's refusal",
    [
      { save: "patch", refused: true },
      { save: "undoLabel", refused: false },
      { answer: "any" },
      { answer: "patch-tweens" },
    ],
  ],
];

describe("sealed preview after late answers in any order", () => {
  it.each(SEEDS)("%s", async (name, steps) => {
    const { shown, fresh, reloads, reloadRefusals } = await play(steps);
    expect(shown).toEqual(fresh);
    if (reloadRefusals === 0) expect(reloads).toBe(0);
    // The frame cannot set a title in place, so the refused undo recovers only by reloading.
    if (name.includes("title")) expect(reloads).toBeGreaterThan(0);
  });

  const SAVES: Save[] = ["run", "patch", "retime", "undoLabel", "undoTitle", "undoBoth"];
  const generated = (seed: number): Step[] => {
    let state = seed;
    const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    return Array.from({ length: 7 }, (): Step => {
      const roll = random();
      if (roll < 0.08) return { reloadFrame: true };
      if (roll < 0.45) return { answer: "any" };
      return { save: SAVES[Math.floor(random() * SAVES.length)]!, refused: random() < 0.5 };
    });
  };
  const base = Number(process.env.HF_ORDERING_SEED_BASE ?? 0);
  it.each(
    Array.from({ length: Number(process.env.HF_ORDERING_SEEDS ?? 40) }, (_, i) => base + i + 1),
  )("generated sequence %i", async (seed) => {
    const steps = generated(seed);
    const { shown, fresh, reloads, reloadRefusals } = await play(steps, seed);
    expect({ steps, state: shown }).toEqual({ steps, state: fresh });
    // Only a refused re-run or restore leaves nothing to recover in place.
    if (reloadRefusals === 0) expect({ steps, reloads }).toEqual({ steps, reloads: 0 });
  });
});
