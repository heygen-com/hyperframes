// The ordering tables' saved file, the saves Studio sends and the sequence generator, shared by both tables.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser, Page } from "puppeteer-core";
import { expect } from "vitest";
import type { Studio } from "./sealedPreviewHarness";
import {
  playSequence,
  type SequenceFixture,
  type SaveFate,
  type SequenceStep,
} from "./sealedPreviewSequence";

const require = createRequire(import.meta.url);
const GSAP = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
const RUNTIME = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
const MARK = '<meta name="hyperframes-studio-preview" content="1" />';

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
export type Save =
  | "run"
  | "patch"
  | "retime"
  | "liveRetime"
  | "undoLabel"
  | "undoTitle"
  | "undoBoth"
  | "undoStart";
export type Step = SequenceStep<Save>;

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
/** Marks a write request as Studio does when it goes out, and reads the file revision it took. */
function mark(studioPage: Page) {
  return studioPage.evaluate(() => {
    const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
    studio.markStudioWriteToken(`save-${Math.random()}`);
    return studio.studioFileRevision();
  });
}

/** Sends `save` the way Studio does after writing the file from `before` to `after`. */
function send(
  studioPage: Page,
  save: Save,
  [before, after]: [Saved, Saved],
  revision: number,
  two: boolean,
) {
  return studioPage.evaluate(
    (kind, prev, saved, savedPage, x, text, version) => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const w = window as unknown as {
        __saved: string;
        __savedVersion?: number;
        __reload: () => void;
        __refusals: number;
      };
      // The file on disk is the newest save's, whichever preview sync goes out last.
      if (version > (w.__savedVersion ?? -1)) {
        w.__saved = savedPage;
        w.__savedVersion = version;
      }
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
          studio.moveLiveTweens(iframe, text, time, w.__reload, {
            before: prev,
            after: saved,
            revision: version,
          }),
        ).then((moved) => {
          if (moved) return;
          const now = studio.usePlayerStore.getState().currentTime;
          const options = {
            ...rerun,
            currentTimeOverride: now,
            timingEdit: true,
            version,
            onAsyncFailure: w.__reload,
          };
          if (studio.applySoftReload(iframe, text, options) === "cannot-soft-reload") reloadNow();
        });
      // As Studio's preview sync: a run nothing can apply in place reloads.
      const rerunOrReload = (timingEdit: boolean) => {
        const options = { ...rerun, timingEdit, version, onAsyncFailure: w.__reload };
        if (studio.applySoftReload(iframe, text, options) === "cannot-soft-reload") reloadNow();
      };
      if (kind === "run") rerunOrReload(false);
      if (kind === "retime") rerunOrReload(true);
      if (kind === "patch") {
        const instantPatch = {
          selector: "#target",
          change: { kind: "set" as const, props: { x } },
        };
        const result = {
          ok: true,
          scriptText: text,
          before: prev,
          after: saved,
          revision: version,
        };
        studio.applyPreviewSync(
          iframe,
          result,
          { label: "drag", softReload: true, instantPatch },
          reloadPreview,
        );
      }
      if (kind.startsWith("undo")) {
        const files = { "index.html": { previous: prev, restored: saved } };
        studio.applyUndoRestoreToPreview(iframe, null, files, time, reloadPreview, null, version);
      }
      sending = false;
    },
    save,
    file(before, two),
    file(after, two),
    page(after, two),
    after.x,
    script(after),
    revision,
  );
}

const fixture = (two: boolean): SequenceFixture<Saved, Save> => ({
  first: FIRST,
  page: (s) => page(s, two),
  next,
  mark,
  send: (studioPage, save, before, after, revision) =>
    send(studioPage, save, [before, after], revision, two),
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
export const playOrdering = (
  browser: Browser,
  bundle: string,
  steps: Step[],
  seed = 1,
  two = false,
) => playSequence(browser, bundle, two ? TWO_SCRIPTS : ONE_SCRIPT, steps, seed);

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
    // A timing sync's preview sync runs after the file lock, so a newer save's can go out first.
    if (roll < 0.25)
      return {
        reversed: [
          pick<Save>(["liveRetime", "retime"]),
          pick<Save>(["run", "patch", "undoLabel", "undoStart"]),
        ],
        ...(random() < 0.3 ? { reload: true as const } : {}),
      };
    if (roll < 0.5) return { answer: "any" };
    return { save: pick(SAVES), fate: pick(FATES) };
  });
};

/** Plays generated sequence `seed` (odd seeds in a two-script file) and checks it against a fresh load. */
export async function expectGenerated(browser: Browser, bundle: string, seed: number) {
  const steps = generated(seed);
  const two = seed % 2 === 1;
  const { shown, fresh, reloads, reloadRefusals, playhead } = await playOrdering(
    browser,
    bundle,
    steps,
    seed,
    two,
  );
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
}
