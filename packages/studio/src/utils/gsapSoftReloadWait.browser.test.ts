// Real Chrome: a preview Studio cannot script (a sandboxed frame), or a same-origin one, running the real runtime,
// with the MotionPath plugin request held so a re-run has to wait for it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NO_PATH_TWEEN_META } from "@hyperframes/core/gsap-cdn";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import {
  buildStudioBundle,
  openPreview as openSharedPreview,
  type Preview,
  type Studio,
} from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
// A srcdoc preview has no origin of its own, so its plugin comes from a configured mirror, as Studio configures one.
const STUDIO_MARK =
  '<meta name="hyperframes-studio-preview" content="1" />' +
  '<meta name="hyperframes-gsap-base-url" content="https://fixture.hyperframes.test/npm" />';
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle();
});

afterAll(() => closeTestChrome(browser));

const C_ATTRIBUTES = (left: number) => [
  ["id", "c"],
  ["data-hf-id", "c"],
  ["class", "clip box"],
  ["data-start", "0"],
  ["data-duration", "4"],
  ["data-track-index", "3"],
  ["style", `left: ${left}px; top: 500px`],
];
const restoreC = (left: number) => [
  { file: null, elements: [{ key: "hf:c", attributes: C_ATTRIBUTES(left) }] },
];

/** A timeline script for `key`: "main" moves #target to `x`, "other" moves #b. */
function timeline(key: "main" | "other", name: string, x: number, motion = false): string {
  const target = key === "main" ? "#target" : "#b";
  return `(function () {
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    tl.to("${target}", { x: ${x}, duration: 4, ease: "none" }, 0);
    window.__timelines["${key}"] = tl;
    window.__ran = Object.assign(window.__ran || {}, { ${key}: "${name}" });
  })();${motion ? "\n// motionPath: held until the plugin loads" : ""}`;
}

/** A Studio preview page with two timelines, "main" (`main`'s script tag) and "other", GSAP and the runtime inline. */
function previewHtml(main = `<script>${timeline("main", "file", 120)}</script>`): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  const box = (id: string, track: number, style: string) =>
    `<div id="${id}" class="clip box" data-start="0" data-duration="4" data-track-index="${track}" style="${style}"></div>`;
  return `<!doctype html><html><head><meta charset="UTF-8" />${STUDIO_MARK}
    <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
      #root { position: relative; width: 100%; height: 100% } .box { position: absolute; width: 200px; height: 200px }</style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      ${box("target", 1, "left: 100px; top: 100px")}${box("b", 2, "left: 600px; top: 100px")}
      <div id="c" data-hf-id="c" class="clip box" data-start="0" data-duration="4" data-track-index="3" style="left: 0px; top: 500px"></div>
    </div>
    <script>${gsap}</script>${main}<script>${timeline("other", "file", 120)}</script>
    <script>${runtime}</script></body></html>`;
}

const openPreview = (mode: string) => openSharedPreview(browser, studioBundle, previewHtml(), mode);

/** Studio's re-run of `script` at `time`: its answer now, or with `late`, "reload" if Studio falls back later. */
function rerun(page: Page, script: string, time: number, restore: unknown[] = [], late = false) {
  return page.evaluate(
    (text, at, scopes, waitLate) =>
      new Promise<string>((resolve) => {
        const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
        const iframe = document.querySelector("iframe")!;
        const html = `<html><body><script>${text}</script></body></html>`;
        const result = studio.applySoftReload(iframe, text, {
          currentTimeOverride: at,
          authoredHtml: html,
          previousHtml: html,
          restore: scopes as never,
          onAsyncFailure: () => resolve("reload"),
        });
        if (result !== "applied" || !waitLate) resolve(result);
      }),
    script,
    time,
    restore,
    late,
  );
}

/** Waits until every answer the frame owes Studio has reached it. */
async function settled({ page, frame }: Preview, sealed: boolean) {
  await frame.waitForFunction(
    () => !(window as { __hfMotionPathWaiters?: unknown }).__hfMotionPathWaiters,
  );
  // The swap's seek renders on the frame's next animation frame; a step after it must come after that render.
  await frame.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  if (sealed)
    await page.evaluate(async () => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      await studio.previewRequest(document.querySelector("iframe")!, "runtime-snapshot", {});
    });
}

type Step =
  | "drag"
  | "scrub"
  | "play"
  | "late"
  | "same"
  | "other"
  | "two"
  | "patch"
  | "attr"
  | "edit"
  | "move"
  | "ok"
  | "fail";

/** Restores #c's left as Studio does: through the frame when sealed, by writing the same-origin DOM otherwise. */
function restoreLeftOfC(preview: Preview, sealed: boolean, left: number) {
  if (!sealed)
    return preview.frame.evaluate(
      (l) => document.getElementById("c")!.setAttribute("style", `left: ${l}px; top: 500px`),
      left,
    );
  return preview.page.evaluate(
    (scopes) =>
      (window as unknown as { hfStudio: Studio }).hfStudio.previewRequest(
        document.querySelector("iframe")!,
        "restore-attributes",
        { scopes: scopes as never, scripted: true, time: 4 },
      ),
    restoreC(left),
  );
}

const styleTarget = (preview: Preview, name: string, value: string) =>
  preview.frame.evaluate(
    (n, v) => document.getElementById("target")!.style.setProperty(n, v),
    name,
    value,
  );

const STEPS: Record<Step, (preview: Preview, sealed: boolean) => Promise<unknown>> = {
  // Playback runs past 1 s during the wait, then pauses: the swap leaves the playhead on that frame.
  play: async (p) => {
    const control = (action: string) =>
      p.page.evaluate((a) => {
        const msg = { source: "hf-parent", type: "control", action: a };
        document.querySelector("iframe")!.contentWindow!.postMessage(msg, "*");
      }, action);
    await control("play");
    await expect.poll(p.time).toBeGreaterThan(1);
    await control("pause");
    await p.frame.waitForFunction(
      () => !(window as unknown as { __player: { isPlaying(): boolean } }).__player.isPlaying(),
    );
    // A playback tick already scheduled can still land after the pause; read the frame it leaves.
    await p.frame.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    pausedAt = await p.time();
  },
  // Studio's editing port gives a request 5 s (editingPort.ts); the plugin stays held past that.
  late: () => new Promise((done) => setTimeout(done, 5_500)),
  // A drag's live preview is a gsap.set on the element per frame; each call moves it 10 px further.
  drag: (p) =>
    p.frame.evaluate(() => {
      const w = window as unknown as {
        gsap: { set(t: Element, v: object): void };
        __drag?: number;
      };
      w.__drag = (w.__drag ?? 140) + 10;
      w.gsap.set(document.getElementById("target")!, { x: w.__drag });
    }),
  // A second run that waits too: it counts only once the frame holds both swaps.
  two: async (p) => {
    void rerun(p.page, timeline("other", "newer", 200, true), 3);
    await p.frame.waitForFunction(
      () => ((window as unknown as { __hfSwapsWaiting?: number }).__hfSwapsWaiting ?? 0) >= 2,
    );
  },
  patch: async (p, sealed) => {
    const patched = await p.page.evaluate(async (isSealed) => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      const change = { kind: "set" as const, props: { x: 300 } };
      if (!isSealed) return studio.patchRuntimeTweenInPlace(iframe, "#target", change);
      const reply = await studio.previewRequest(iframe, "patch-tweens", {
        patches: [{ selector: "#target", change }],
        seek: true,
      });
      return reply?.patched === true;
    }, sealed);
    expect(patched).toBe(false);
  },
  scrub: async (p) => {
    for (const t of [3, 4]) await p.seek(t);
  },
  same: (p) => rerun(p.page, timeline("main", "newer", 200), 4),
  other: (p) => rerun(p.page, timeline("other", "newer", 200), 4),
  attr: (p, sealed) => restoreLeftOfC(p, sealed, 2),
  edit: (p) => styleTarget(p, "color", "red"),
  move: (p) => styleTarget(p, "transform", "translateX(300px)"),
  ok: async (p, sealed) => {
    await p.release(200);
    await settled(p, sealed);
  },
  fail: async (p, sealed) => {
    await p.release(404);
    await settled(p, sealed);
  },
};

let pausedAt: number | undefined;

/** Plays `steps` against an older "main" re-run waiting for the plugin, sent at 2 s with the player at 4 s. */
async function play(mode: string, steps: Step[]) {
  const sealed = mode === "sealed";
  pausedAt = undefined;
  const preview = await openPreview(mode);
  const { page, frame, pluginRequested, seek, time } = preview;
  await seek(4);
  if (!sealed) await restoreLeftOfC(preview, sealed, 1);
  const older = rerun(
    page,
    timeline("main", "older", 60, true),
    2,
    sealed ? restoreC(1) : [],
    true,
  );
  await pluginRequested;
  for (const step of steps) await STEPS[step](preview, sealed);
  const answer = await Promise.race([older, Promise.resolve("kept")]);
  const state = await frame.evaluate(() => {
    const target = document.getElementById("target")!;
    return {
      ran: (window as unknown as { __ran: Record<string, string> }).__ran,
      left: document.getElementById("c")!.style.left,
      color: target.style.color,
      x: Math.round(new DOMMatrix(getComputedStyle(target).transform).m41),
    };
  });
  const now = await time();
  const at = Math.round(now * 100) / 100;
  const outcome = {
    answer,
    ...state,
    at,
    // The swap seeks to the frame at or below the paused time; only a whole frame or more is a move.
    ...(pausedAt === undefined
      ? {}
      : { moved: Math.abs(now - pausedAt) >= 1 / 30, pausedAt: Math.round(pausedAt * 100) / 100 }),
  };
  await page.close();
  return outcome;
}

// fails without the fix (core as at 5822316a): scrub,ok ends at 2; same,ok and same,fail lose the newer edit
// or reload; other,fail reloads with main's timeline killed; attr,ok puts the older left back.
const ROWS: [string, Step[], Record<string, unknown>][] = [
  ["ok", ["ok"], { answer: "kept", ran: { main: "older", other: "file" }, at: 4, x: 60 }],
  ["scrub,ok", ["scrub", "ok"], { answer: "kept", ran: { main: "older" }, at: 4, x: 60 }],
  ["ok,scrub", ["ok", "scrub"], { answer: "kept", ran: { main: "older" }, at: 4, x: 60 }],
  ["same,ok", ["same", "ok"], { answer: "kept", ran: { main: "newer" }, x: 200 }],
  ["same,fail", ["same", "fail"], { answer: "kept", ran: { main: "newer" }, x: 200 }],
  ["ok,same", ["ok", "same"], { answer: "kept", ran: { main: "newer" }, x: 200 }],
  ["fail,same", ["fail", "same"], { answer: "reload", ran: { main: "newer" } }],
  ["other,ok", ["other", "ok"], { answer: "kept", ran: { main: "older", other: "newer" } }],
  [
    "other,fail",
    ["other", "fail"],
    { answer: "reload", ran: { main: "file", other: "newer" }, x: 120 },
  ],
  ["ok,other", ["ok", "other"], { answer: "kept", ran: { main: "older", other: "newer" } }],
  ["attr,ok", ["attr", "ok"], { answer: "kept", left: "2px" }],
  ["ok,attr", ["ok", "attr"], { answer: "kept", left: "2px" }],
  ["edit,ok", ["edit", "ok"], { answer: "kept", color: "red", x: 60 }],
  ["ok,edit", ["ok", "edit"], { answer: "kept", color: "red", x: 60 }],
  ["move,ok", ["move", "ok"], { answer: "kept", x: 60 }],
  ["ok,move", ["ok", "move"], { answer: "kept", x: 300 }],
  ["play,ok", ["play", "ok"], { answer: "kept", moved: false }],
  ["same,late,ok", ["same", "late", "ok"], { answer: "kept", ran: { main: "newer" } }],
  ["two,ok", ["two", "ok"], { answer: "kept", ran: { main: "older", other: "newer" }, at: 4 }],
  ["drag,ok,drag", ["drag", "ok", "drag"], { answer: "kept", ran: { main: "older" }, x: 160 }],
  ["patch,ok", ["patch", "ok"], { answer: "kept", ran: { main: "older" }, x: 60 }],
];

describe.each(MODES)("a re-run waiting for the MotionPath plugin, %s", (mode) => {
  it.each(ROWS)("%s", async (name, steps, expected) => {
    const outcome = await play(mode, steps);
    console.info(`[soft-wait] ${mode} ${name} ${JSON.stringify(outcome)}`);
    expect(outcome).toMatchObject(expected);
  });
});

const PATH_TWEEN = `(function () {
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
  tl.to("#target", { motionPath: { path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }, duration: 4, ease: "none" }, 0);
  window.__timelines["main"] = tl;
})();`;
const PATH_TWEEN_URL = "https://fixture.hyperframes.test/path-tween.js";

/** Studio meeting a freshly loaded preview: the same-origin preload (NLEContext), then the editing port. */
const connect = (page: Page) =>
  page.evaluate(async () => {
    const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
    const iframe = document.querySelector("iframe")!;
    studio.ensureMotionPathPluginLoaded(iframe);
    await studio.previewRequest(iframe, "runtime-snapshot", {});
  });
const pluginScripts = ({ frame }: Preview) =>
  frame.evaluate(() => document.querySelectorAll('script[src*="MotionPathPlugin"]').length);

// Parity: a same-origin preview gets the plugin on load (NLEContext), and a sealed one when Studio connects.
it.each(MODES)(
  "the first motion-path re-run after load finds the plugin loaded (%s)",
  async (mode) => {
    const { page, frame, release } = await openSharedPreview(
      browser,
      studioBundle,
      previewHtml(`<script>${PATH_TWEEN}</script>`),
      mode,
    );
    await release(200);
    await connect(page);
    await frame.waitForFunction(() => "MotionPathPlugin" in window, { timeout: 5_000 });
    expect(await rerun(page, timeline("main", "older", 60, true), 1)).toBe("applied");
    await page.close();
  },
);

// fails without the fix: the preload read only inline scripts, so this page's plugin was never requested.
it.each(MODES)(
  "a path tween from an external script gets the plugin when Studio connects (%s)",
  async (mode) => {
    const preview = await openSharedPreview(
      browser,
      studioBundle,
      previewHtml(`<script src="${PATH_TWEEN_URL}"></script>`),
      mode,
      { [PATH_TWEEN_URL]: PATH_TWEEN },
    );
    await preview.release(200);
    await connect(preview.page);
    expect(await pluginScripts(preview)).toBe(1);
    await preview.frame.waitForFunction(() => "MotionPathPlugin" in window, { timeout: 5_000 });
    await preview.page.close();
  },
);

const LATE_PATH_TWEEN = `(function () {
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
  window.__timelines["main"] = tl;
  window.buildPathTween = function () {
    tl.to("#target", { motionPath: { path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }, duration: 4, ease: "none" }, 0);
  };
})();`;

const LATE_TWEEN_CASES = MODES.flatMap((mode) =>
  [PATH_TWEEN_URL, "https://fixture.hyperframes.test/authored/gsap.js"].map(
    (url) => [mode, url] as const,
  ),
);

// fails without the fix: an external script that builds its first path tween after connect, named gsap.js, got no
// plugin and stayed at 0.
it.each(LATE_TWEEN_CASES)(
  "a path tween an external script builds after connect plays (%s, %s)",
  async (mode, url) => {
    const preview = await openSharedPreview(
      browser,
      studioBundle,
      previewHtml(`<script src="${url}"></script>`),
      mode,
      { [url]: LATE_PATH_TWEEN },
    );
    await preview.release(200);
    await connect(preview.page);
    await preview.frame.waitForFunction(() => "MotionPathPlugin" in window, { timeout: 5_000 });
    await preview.frame.evaluate(() =>
      (window as unknown as { buildPathTween(): void }).buildPathTween(),
    );
    await preview.seek(4);
    const x = await preview.frame.evaluate(() =>
      Number(
        (
          window as unknown as { gsap: { getProperty(t: string, p: string): unknown } }
        ).gsap.getProperty("#target", "x"),
      ),
    );
    expect(x).toBeCloseTo(50, 0);
    await preview.page.close();
  },
);

// fails without the fix: every preview Studio connected to requested the plugin.
it.each(MODES)(
  "a page the preview builder marked as path-free requests no plugin (%s)",
  async (mode) => {
    const marked = previewHtml().replace(
      STUDIO_MARK,
      `${STUDIO_MARK}<meta name="${NO_PATH_TWEEN_META}">`,
    );
    const preview = await openSharedPreview(browser, studioBundle, marked, mode);
    await connect(preview.page);
    expect(await pluginScripts(preview)).toBe(0);
    await preview.page.close();
  },
);

// fails without the fix: all but "still recovers an older script refusal after an unrelated successful patch",
// which guards the coverage rule against dropping a refusal no re-run carries.
describe("late answers held in transit, sealed", () => {
  const hold = (page: Page, on: boolean) =>
    page.evaluate((h) => ((window as unknown as { __hold: boolean }).__hold = h), on);
  const heldCount = (page: Page) =>
    page.evaluate(() => (window as unknown as { __held: unknown[] }).__held.length);
  /** Delivers the held replies in order; `results` overrides the result of the one at that index. */
  const deliver = (page: Page, results: Record<number, unknown> = {}) =>
    page.evaluate(
      (overrides) => {
        const w = window as unknown as { __hold: boolean; __held: Array<(r?: unknown) => void> };
        w.__hold = false;
        w.__held.splice(0).forEach((send, i) => send(overrides[i]));
      },
      results as Record<number, unknown>,
    );
  const ran = (p: Preview) =>
    p.frame.evaluate(() => (window as unknown as { __ran: Record<string, string> }).__ran.main);
  /** A sealed commit of `script` whose value edit Studio patches in place; resolves "reload" on a full reload. */
  const commit = (page: Page, script: string, x: number) =>
    page.evaluate(
      (text, value) => {
        const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
        const html = `<html><body><script>${text}</script></body></html>`;
        const result = { ok: true, scriptText: text, before: html, after: html };
        const instantPatch = {
          selector: "#target",
          change: { kind: "set" as const, props: { x: value } },
        };
        const options = { label: "drag", softReload: true, instantPatch };
        studio.applyPreviewSync(document.querySelector("iframe"), result, options, () => {
          (window as unknown as { __reloads?: number }).__reloads = 1;
        });
      },
      script,
      x,
    );
  const undoLeftOfC = (page: Page, left: number) =>
    page.evaluate(
      (l, script) => {
        const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
        const c = (at: number) =>
          `<div id="c" data-hf-id="c" class="clip box" style="left: ${at}px; top: 500px"></div>`;
        const file = (at: number) =>
          `<html><body><div id="root" data-composition-id="main">${c(at)}</div><script>${script}</script></body></html>`;
        const files = { "index.html": { previous: file(0), restored: file(l) } };
        const reload = () => ((window as unknown as { __reloads?: number }).__reloads = 1);
        return studio.applyUndoRestoreToPreview(
          document.querySelector("iframe"),
          null,
          files,
          2,
          reload,
        );
      },
      left,
      timeline("main", "file", 120),
    );
  const reloads = (page: Page) =>
    page.evaluate(() => (window as unknown as { __reloads?: number }).__reloads ?? 0);

  it("drops an older explicit refusal that arrives after a newer run painted", async () => {
    const p = await openPreview("sealed");
    // A page closed under a still-waiting run rejects its evaluate.
    const older = rerun(p.page, timeline("main", "older", 60, true), 2, [], true).catch(
      () => "closed",
    );
    await p.pluginRequested;
    await hold(p.page, true);
    await p.release(404);
    await expect.poll(() => heldCount(p.page)).toBe(1);
    await rerun(p.page, timeline("main", "newer", 200), 2);
    await expect.poll(() => ran(p)).toBe("newer");
    await deliver(p.page);
    await settled(p, true);
    expect(await Promise.race([older, Promise.resolve("kept")])).toBe("kept");
    await p.page.close();
  });

  it("re-runs the newest script when a patch refusal held across the swap arrives late", async () => {
    const p = await openPreview("sealed");
    void rerun(p.page, timeline("main", "older", 60, true), 2, [], true).catch(() => {});
    await p.pluginRequested;
    await hold(p.page, true);
    await commit(p.page, timeline("main", "p1", 10), 10);
    await expect.poll(() => heldCount(p.page)).toBe(1);
    await p.release(200);
    await expect.poll(() => ran(p)).toBe("older");
    await commit(p.page, timeline("main", "p2", 20), 20);
    await expect.poll(() => heldCount(p.page)).toBe(3);
    await deliver(p.page, { 0: { patched: false }, 2: { patched: true } });
    await expect.poll(() => ran(p)).toBe("p2");
    await settled(p, true);
    expect(await ran(p)).toBe("p2");
    await p.page.close();
  });

  it("still recovers an older script refusal after an unrelated successful patch", async () => {
    const p = await openPreview("sealed");
    const older = rerun(p.page, timeline("main", "older", 60, true), 2, [], true);
    await p.pluginRequested;
    await hold(p.page, true);
    await p.release(404);
    await expect.poll(() => heldCount(p.page)).toBe(1);
    await commit(p.page, timeline("main", "file", 120), 30);
    await expect.poll(() => heldCount(p.page)).toBe(2);
    await deliver(p.page, { 1: { patched: true } });
    expect(await older).toBe("reload");
    await p.page.close();
  });

  it("still recovers an older run that times out after an attribute-only undo", async () => {
    const p = await openPreview("sealed");
    const older = rerun(p.page, timeline("main", "older", 60, true), 2, [], true);
    await p.pluginRequested;
    expect(await undoLeftOfC(p.page, 5)).toBe("soft");
    await expect
      .poll(() => p.frame.evaluate(() => document.getElementById("c")!.style.left))
      .toBe("5px");
    await hold(p.page, true);
    await p.release(404);
    // Studio's editing port gives a request 5 s (editingPort.ts); the refusal stays held past that.
    expect(await older).toBe("reload");
    await p.page.close();
  });

  it("does not reload a new preview load for a restore its old load never answered", async () => {
    const p = await openPreview("sealed");
    await hold(p.page, true);
    expect(await undoLeftOfC(p.page, 5)).toBe("soft");
    await p.page.evaluate(
      () =>
        new Promise<void>((loaded) => {
          const iframe = document.querySelector("iframe")!;
          iframe.addEventListener("load", () => setTimeout(loaded, 0), { once: true });
          iframe.srcdoc = iframe.srcdoc + " ";
        }),
    );
    await deliver(p.page);
    expect(await reloads(p.page)).toBe(0);
    await p.page.close();
  });
});
