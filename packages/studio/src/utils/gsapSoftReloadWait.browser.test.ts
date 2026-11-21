// Real Chrome: a preview Studio cannot script (a sandboxed frame), or a same-origin one, running the real runtime,
// with the MotionPath plugin request held so a re-run has to wait for it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Frame, HTTPRequest, Page } from "puppeteer-core";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeTestChrome, emptyNodeBuiltins, launchTestChrome } from "../../tests/chromeTestUtils";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const STUDIO_MARK = '<meta name="hyperframes-studio-preview" content="1" />';
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  const out = await build({
    stdin: {
      contents: `export * from "./gsapSoftReload"; export { previewRequest } from "../player/lib/previewChannel";`,
      resolveDir: dirname(fileURLToPath(import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "hfStudio",
    alias: { canvas: fileURLToPath(new URL("../shims/canvasBrowserStub.js", import.meta.url)) },
    plugins: [emptyNodeBuiltins],
    define: { "import.meta.env": "{}" },
  });
  studioBundle = out.outputFiles[0]!.text;
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

/** A Studio preview page with two timelines, "main" and "other", GSAP and the runtime inline. */
function previewHtml(): string {
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
    <script>${gsap}</script><script>${timeline("main", "file", 120)}</script><script>${timeline("other", "file", 120)}</script>
    <script>${runtime}</script></body></html>`;
}

/** Opens the preview in Studio's page; the plugin request waits until `release` is called. */
async function openPreview(mode: string) {
  const page: Page = await browser.newPage();
  const plugin = readFileSync(require.resolve("gsap/dist/MotionPathPlugin.min.js"), "utf8");
  const held: HTTPRequest[] = [];
  let holding = true;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!/MotionPathPlugin/.test(request.url())) return void request.continue();
    const serve = () =>
      request.respond({ status: 200, contentType: "text/javascript", body: plugin });
    if (holding) held.push(request);
    else void serve();
  });
  const release = async (status: 200 | 404) => {
    holding = false;
    for (const request of held.splice(0))
      await request.respond({
        status,
        contentType: "text/javascript",
        body: status === 200 ? plugin : "",
      });
  };
  const html = previewHtml();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.evaluate(studioBundle);
  await page.evaluate(
    (srcdoc, sealed) => {
      const iframe = document.createElement("iframe");
      if (sealed) iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.cssText = "width: 1920px; height: 1080px; border: 0";
      iframe.srcdoc = srcdoc;
      document.body.append(iframe);
    },
    html,
    mode === "sealed",
  );
  const frame: Frame = await (async () => {
    for (;;) {
      const found = page.frames().find((f) => f !== page.mainFrame());
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();
  await frame.waitForFunction(() => "__player" in window);
  const time = () =>
    frame.evaluate(() =>
      (window as unknown as { __player: { getTime(): number } }).__player.getTime(),
    );
  const seek = async (to: number) => {
    await page.evaluate((t) => {
      document
        .querySelector("iframe")!
        .contentWindow!.postMessage(
          { source: "hf-parent", type: "control", action: "seek", timeSeconds: t },
          "*",
        );
    }, to);
    await expect.poll(time).toBeCloseTo(to, 2);
  };
  return { page, frame, held, release, seek, time };
}

type Studio = typeof import("./gsapSoftReload") & {
  previewRequest: typeof import("../player/lib/previewChannel").previewRequest;
};
type Preview = Awaited<ReturnType<typeof openPreview>>;

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

type Step = "scrub" | "same" | "other" | "attr" | "edit" | "move" | "ok" | "fail";

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

/** Plays `steps` against an older "main" re-run waiting for the plugin, sent at 2 s with the player at 4 s. */
async function play(mode: string, steps: Step[]) {
  const sealed = mode === "sealed";
  const preview = await openPreview(mode);
  const { page, frame, held, seek, time } = preview;
  await seek(4);
  if (!sealed) await restoreLeftOfC(preview, sealed, 1);
  const older = rerun(
    page,
    timeline("main", "older", 60, true),
    2,
    sealed ? restoreC(1) : [],
    true,
  );
  await expect.poll(() => held.length).toBeGreaterThan(0);
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
  const outcome = { answer, ...state, at: Math.round((await time()) * 100) / 100 };
  await page.close();
  return outcome;
}

// fails without the fix (core as at 5822316a): scrub,ok ends at 2; same,ok and same,fail lose the newer edit
// or reload; other,fail reloads with main's timeline killed; attr,ok puts the older left back.
const ROWS: [string, Step[], Record<string, unknown>][] = [
  ["ok", ["ok"], { answer: "kept", ran: { main: "older", other: "file" }, at: 2, x: 30 }],
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
  ["edit,ok", ["edit", "ok"], { answer: "kept", color: "red", x: 30 }],
  ["ok,edit", ["ok", "edit"], { answer: "kept", color: "red", x: 30 }],
  ["move,ok", ["move", "ok"], { answer: "kept", x: 30 }],
  ["ok,move", ["ok", "move"], { answer: "kept", x: 300 }],
];

describe.each(MODES)("a re-run waiting for the MotionPath plugin, %s", (mode) => {
  it.each(ROWS)("%s", async (name, steps, expected) => {
    const outcome = await play(mode, steps);
    console.info(`[soft-wait] ${mode} ${name} ${JSON.stringify(outcome)}`);
    expect(outcome).toMatchObject(expected);
  });
});

// Parity: a same-origin preview gets the plugin on load (NLEContext), and a sealed one when Studio connects.
it.each(MODES)(
  "the first motion-path re-run after load finds the plugin loaded (%s)",
  async (mode) => {
    const { page, frame, release } = await openPreview(mode);
    await release(200);
    await page.evaluate(async () => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      studio.ensureMotionPathPluginLoaded(iframe);
      await studio.previewRequest(iframe, "runtime-snapshot", {});
    });
    await frame.waitForFunction(() => "MotionPathPlugin" in window, { timeout: 5_000 });
    expect(await rerun(page, timeline("main", "older", 60, true), 1)).toBe("applied");
    await page.close();
  },
);
