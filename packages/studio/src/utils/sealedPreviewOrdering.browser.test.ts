// Real Chrome, sealed preview: Studio's saves (script re-runs, tween patches, retimes, undos) reach the frame or are
// refused, their replies arrive in any order, and the frame may reload. Once every reply has settled, the preview
// must equal a fresh load of the saved file, with a full reload only after a refusal nothing can recover in place.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser, Frame, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview, type Studio } from "../../tests/sealedPreviewHarness";

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
}
const FIRST: Saved = { gen: 0, x: 10, start: 0, label: "a" };

const script = (s: Saved) => `(function () {
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    tl.set("#target", { x: ${s.x} }, 0);
    tl.to("#target", { y: 100, duration: 4, ease: "none" }, 0);
    window.__timelines["main"] = tl;
    window.__ran = { main: "g${s.gen}" };
  })();`;
const root = (s: Saved) =>
  `<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">` +
  `<div id="target" data-hf-id="target" class="clip box" data-start="${s.start}" data-duration="4" data-track-index="1" style="left: 100px; top: 100px"></div>` +
  `<div id="c" data-hf-id="c" class="clip box" data-start="0" data-duration="4" data-track-index="2" data-label="${s.label}" style="left: 0px; top: 500px"></div>` +
  `</div>`;
/** The saved file as Studio reads it. */
const file = (s: Saved) => `<html><body>${root(s)}<script>${script(s)}</script></body></html>`;
/** The saved file as the preview loads it. */
const page = (s: Saved) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${MARK}
  <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
    #root { position: relative; width: 100%; height: 100% } .box { position: absolute; width: 200px; height: 200px }</style>
  </head><body>${root(s)}<script>${GSAP}</script><script>${script(s)}</script><script>${RUNTIME}</script></body></html>`;

type Save = "run" | "patch" | "retime" | "undoAttr" | "undoBoth";
type Step =
  | { save: Save; refused: boolean }
  | { answer: "any" | "soft-reload" | "patch-tweens" | "restore-attributes" }
  | { reloadFrame: true };

const next: Record<Save, (s: Saved, n: number) => Saved> = {
  run: (s) => ({ ...s, gen: s.gen + 1 }),
  patch: (s, n) => ({ ...s, x: 20 + n }),
  retime: (s) => ({ ...s, start: 1 - s.start }),
  undoAttr: (s) => ({ ...s, label: s.label === "a" ? "b" : "a" }),
  undoBoth: (s) => ({ ...s, gen: s.gen + 1, label: s.label === "a" ? "b" : "a" }),
};

/** The refusal a frame that never took the request would send, by request kind. */
const REFUSAL: Record<string, unknown> = {
  "soft-reload": { result: "cannot-soft-reload" },
  "patch-tweens": { patched: false },
  "restore-attributes": { applied: false, reran: false },
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
      if (kind === "undoAttr" || kind === "undoBoth") {
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

/** Studio's page: every reply held until answered; a full reload loads the newest saved file and is counted. */
async function openStudio() {
  const preview = await openPreview(browser, studioBundle, page(FIRST), "sealed");
  await preview.release(200);
  await preview.page.evaluate((first) => {
    const w = window as unknown as {
      __hold: boolean;
      __saved: string;
      __reloads: number;
      __reload: () => void;
    };
    w.__hold = true;
    w.__saved = first;
    w.__reloads = 0;
    w.__reload = () => {
      w.__reloads++;
      document.querySelector("iframe")!.srcdoc = w.__saved;
    };
  }, page(FIRST));
  return preview;
}

type Pending = { kind: string; refused: boolean };

const pending = (studioPage: Page) =>
  studioPage.evaluate(() => {
    const w = window as unknown as {
      __held: unknown[];
      __heldKinds?: string[];
      __swallowed: Array<{ kind: string }>;
    };
    return [
      ...w.__held.map(() => ({ kind: "reply", refused: false })),
      ...w.__swallowed.map(({ kind }) => ({ kind, refused: true })),
    ] as Pending[];
  });

/** Answers one pending request: a held reply as the frame sent it, or a refused one with its refusal. */
function answer(studioPage: Page, pick: number, kind: string | null) {
  return studioPage.evaluate(
    (at, wanted, refusals) => {
      const w = window as unknown as {
        __held: Array<() => void>;
        __swallowed: Array<{ kind: string; answer: (result: unknown) => void }>;
      };
      const refuse = (entry: { kind: string; answer: (result: unknown) => void }) => {
        const counts = ((window as unknown as { __refused?: Record<string, number> }).__refused ??=
          {});
        counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
        entry.answer(refusals[entry.kind]);
      };
      const refusedAt = wanted ? w.__swallowed.findIndex((entry) => entry.kind === wanted) : -1;
      if (refusedAt >= 0) return refuse(w.__swallowed.splice(refusedAt, 1)[0]!);
      const all = w.__held.length + w.__swallowed.length;
      if (all === 0) return;
      const i = at % all;
      if (i < w.__held.length) return w.__held.splice(i, 1)[0]!();
      refuse(w.__swallowed.splice(i - w.__held.length, 1)[0]!);
    },
    pick,
    kind,
    REFUSAL,
  );
}

const ready = (frame: Frame) =>
  frame.waitForFunction(() => "__player" in window && "__timelines" in window);

/** Answers everything still pending, new recoveries included, until nothing is left and the frame is loaded. */
async function drain(studioPage: Page, frame: Frame, random: () => number) {
  await studioPage.evaluate(() => {
    (window as unknown as { __swallow: Set<string> }).__swallow = new Set();
  });
  for (let quiet = 0; quiet < 3; ) {
    await ready(frame);
    await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    const left = await pending(studioPage);
    if (left.length === 0) quiet++;
    else {
      quiet = 0;
      await answer(studioPage, Math.floor(random() * 1000), null);
    }
  }
}

/** What a viewer sees at 2 s: the script that ran, the clip timing, the label, and the tween's values. */
async function seen(frame: Frame, studioPage: Page, iframeIndex: number) {
  await studioPage.evaluate((i) => {
    document
      .querySelectorAll("iframe")
      [i]!.contentWindow!.postMessage(
        { source: "hf-parent", type: "control", action: "seek", timeSeconds: 2 },
        "*",
      );
  }, iframeIndex);
  await frame.waitForFunction(
    () =>
      Math.abs((window as unknown as { __player: { getTime(): number } }).__player.getTime() - 2) <
      0.01,
  );
  await frame.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  return frame.evaluate(() => {
    const target = document.getElementById("target")!;
    const m = new DOMMatrix(getComputedStyle(target).transform);
    return {
      ran: (window as unknown as { __ran: { main: string } }).__ran.main,
      start: target.getAttribute("data-start"),
      label: document.getElementById("c")!.getAttribute("data-label"),
      x: Math.round(m.m41),
      y: Math.round(m.m42),
    };
  });
}

/** A fresh load of `saved` in a page of its own. */
async function freshLoad(saved: Saved) {
  const fresh = await openPreview(browser, studioBundle, page(saved), "sealed");
  await ready(fresh.frame);
  const shown = await seen(fresh.frame, fresh.page, 0);
  await fresh.page.close();
  return shown;
}

/** Plays `steps`, settles every reply, and compares the preview with a fresh load of the saved file. */
async function play(steps: Step[], seed = 1) {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const preview = await openStudio();
  const { page: studioPage, frame } = preview;
  let saved = FIRST;
  for (const [n, step] of steps.entries()) {
    if ("save" in step) {
      const after = next[step.save](saved, n);
      await studioPage.evaluate((refused) => {
        const kinds = ["soft-reload", "patch-tweens", "restore-attributes"];
        (window as unknown as { __swallow: Set<string> }).__swallow = new Set(refused ? kinds : []);
      }, step.refused);
      const posted = () =>
        studioPage.evaluate(() => (window as unknown as { __posted: number }).__posted);
      const before = await posted();
      await send(studioPage, step.save, saved, after);
      // Studio posts the request a tick later; its fate holds until it has gone out.
      await studioPage.waitForFunction(
        (n) => (window as unknown as { __posted: number }).__posted > n,
        {},
        before,
      );
      await studioPage.evaluate(() => {
        (window as unknown as { __swallow: Set<string> }).__swallow = new Set();
      });
      saved = after;
    } else if ("reloadFrame" in step) {
      await studioPage.evaluate(() => {
        const w = window as unknown as { __saved: string };
        document.querySelector("iframe")!.srcdoc = w.__saved;
      });
      await ready(frame);
    } else {
      const kind = step.answer === "any" ? null : step.answer;
      await answer(studioPage, Math.floor(random() * 1000), kind);
    }
  }
  await drain(studioPage, frame, random);
  const shown = await seen(frame, studioPage, 0);
  const { reloads, reloadRefusals } = await studioPage.evaluate(() => {
    const w = window as unknown as { __reloads: number; __refused?: Record<string, number> };
    const refused = w.__refused ?? {};
    return {
      reloads: w.__reloads,
      reloadRefusals: (refused["soft-reload"] ?? 0) + (refused["restore-attributes"] ?? 0),
    };
  });
  await studioPage.close();
  const fresh = await freshLoad(saved);
  return { shown, fresh, reloads, reloadRefusals };
}

// The three sequences a reviewer probed by hand, as written in the review; each is red without the fix.
const SEEDS: Array<[string, Step[]]> = [
  [
    "a refused undo of a script and a label, then a newer script-only run",
    [
      { save: "undoBoth", refused: true },
      { save: "run", refused: false },
      { answer: "any" },
      { answer: "soft-reload" },
    ],
  ],
  [
    "a refused patch, then a refused retime, then the patch's refusal",
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
      { save: "undoAttr", refused: false },
      { answer: "any" },
      { answer: "patch-tweens" },
    ],
  ],
];

describe("sealed preview after late answers in any order", () => {
  it.each(SEEDS)("%s", async (_name, steps) => {
    const { shown, fresh, reloads, reloadRefusals } = await play(steps);
    expect(shown).toEqual(fresh);
    if (reloadRefusals === 0) expect(reloads).toBe(0);
  });

  const SAVES: Save[] = ["run", "patch", "retime", "undoAttr", "undoBoth"];
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
