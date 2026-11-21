// Real Chrome: a preview Studio cannot script (a sandboxed frame), or a same-origin one, running the real runtime,
// with the MotionPath plugin request held so a re-run has to wait for it.
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Frame, HTTPRequest, Page } from "puppeteer-core";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, emptyNodeBuiltins, launchTestChrome } from "../../tests/chromeTestUtils";
import { writeFixture } from "../../tests/e2e/edit-accuracy/grid.mjs";

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

/** The bench's tween fixture as a Studio preview page, with GSAP and the runtime inline. */
function previewHtml(): { html: string; script: string } {
  const dir = join(mkdtempSync(join(tmpdir(), "soft-wait-")), "case");
  const spec = {
    gesture: "move",
    nesting: "root",
    zoom: 100,
    gsap: "tween",
    placement: "px",
    rotation: 0,
  };
  writeFixture({ ...spec, time: 1 }, dir);
  const file = readFileSync(join(dir, "index.html"), "utf8");
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(file)![1]!;
  const html = file
    .replace("<head>", `<head>${STUDIO_MARK}`)
    .replace(/<script src="[^"]*gsap\.min\.js"><\/script>/, () => `<script>${gsap}</script>`)
    .replace("</body>", () => `<script>${runtime}</script></body>`);
  return { html, script };
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
  const release = async () => {
    holding = false;
    for (const request of held.splice(0))
      await request.respond({ status: 200, contentType: "text/javascript", body: plugin });
  };
  const { html, script } = previewHtml();
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
  return { page, frame, script, held, release, seek, time };
}

type Studio = typeof import("./gsapSoftReload") & {
  previewRequest: typeof import("../player/lib/previewChannel").previewRequest;
};

/** Studio's re-run of `script` at `time`; resolves with how it ended. */
function rerun(page: Page, script: string, time: number) {
  return page.evaluate(
    (text, at) =>
      new Promise<string>((resolve) => {
        const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
        const iframe = document.querySelector("iframe")!;
        const html = `<html><body><script>${text}</script></body></html>`;
        const result = studio.applySoftReload(iframe, text, {
          currentTimeOverride: at,
          authoredHtml: html,
          previousHtml: html,
          onShownInPlace: () => resolve("in place"),
          onAsyncFailure: () => resolve("reload"),
        });
        if (result !== "applied") resolve(result);
        else if (!studio.previewRequest || iframe.contentDocument) resolve("in place");
      }),
    script,
    time,
  );
}

const withMotionPath = (script: string) => `${script}\n// motionPath: held until the plugin loads`;

// fails without the fix: the re-run's finish seeked back to the time it was sent at.
it("ends a sealed re-run that waited for the plugin where the player was scrubbed away and back to", async () => {
  const { page, script, held, release, seek, time } = await openPreview("sealed");
  await seek(4);
  const done = rerun(page, withMotionPath(script), 2);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await seek(3);
  await seek(4);
  await release();
  expect(await done).toBe("in place");
  expect(await time()).toBeCloseTo(4, 2);
  await page.close();
});

// fails without the fix: the older deferred script ran after the newer edit and put its tween back.
it("keeps a newer sealed edit made while an older re-run waited for the plugin", async () => {
  const { page, frame, script, held, release, seek } = await openPreview("sealed");
  const older = rerun(page, withMotionPath(script.replace("x: 120", "x: 60")), 0);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  expect(await rerun(page, script.replace("x: 120", "x: 200"), 0)).toBe("in place");
  await release();
  expect(await older).toBe("in place");
  await seek(4);
  const x = () =>
    frame.evaluate(
      () => new DOMMatrix(getComputedStyle(document.getElementById("target")!).transform).m41,
    );
  await expect.poll(x).toBeCloseTo(200, 0);
  await page.close();
});

// Parity: a same-origin preview gets the plugin on load (NLEContext), and a sealed one when Studio connects.
it.each(MODES)(
  "the first motion-path re-run after load finds the plugin loaded (%s)",
  async (mode) => {
    const { page, frame, script, release } = await openPreview(mode);
    await release();
    await page.evaluate(async () => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      studio.ensureMotionPathPluginLoaded(iframe);
      await studio.previewRequest(iframe, "runtime-snapshot", {});
    });
    await frame.waitForFunction(() => "MotionPathPlugin" in window, { timeout: 5_000 });
    expect(await rerun(page, withMotionPath(script), 1)).toBe("in place");
    await page.close();
  },
);
