import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

// A small player must raster its composition's will-change layers near the size it shows them,
// not at full size (which runs heavy compositions out of tile memory and drops layers).
const server = startServer();
const browser = await launchBrowser({ width: 528, height: 297 });

type Layer = {
  compositing_reason_ids?: string[];
  ideal_contents_scale?: number;
  raster_scales?: { contents_scale?: [number, number] };
};

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    if (window !== window.top) return;
    const createElement = Document.prototype.createElement;
    const state = {
      frames: 0,
      sourceAssignments: 0,
      probe: null as null | {
        width: number;
        height: number;
        density: number;
        beforeSource: boolean;
      },
    };
    Object.assign(window, { __iframeScalingWitness: state });
    Document.prototype.createElement = function (...args) {
      if (args[0].toLowerCase() === "iframe") state.frames++;
      return createElement.apply(this, args);
    };
    for (const key of ["src", "srcdoc"]) {
      const source = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, key)!;
      Object.defineProperty(HTMLIFrameElement.prototype, key, {
        ...source,
        set(value) {
          state.sourceAssignments++;
          source.set!.call(this, value);
        },
      });
    }
    const contentWindow = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow",
    )!;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      ...contentWindow,
      get() {
        const win = contentWindow.get!.call(this) as Window | null;
        if (win && !this.hasAttribute("src") && !this.hasAttribute("srcdoc")) {
          const width = Object.getOwnPropertyDescriptor(win, "innerWidth")!;
          Object.defineProperty(win, "innerWidth", {
            ...width,
            get: () => {
              const value = width.get!.call(win);
              if (this.style.zoom === "0.3646")
                state.probe = {
                  width: value,
                  height: win.innerHeight,
                  density: win.devicePixelRatio,
                  beforeSource: state.sourceAssignments === 0,
                };
              return value;
            },
          });
        }
        return win;
      },
    });
  });
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.url() === `${server.origin}/host.html?fixture=gsap-heavy`) {
      const html = await (await fetch(request.url())).text();
      await request.respond({
        status: 200,
        contentType: "text/html",
        body: html.replace(
          "<hyperframes-player",
          '<hyperframes-player shader-capture-scale="1" shader-loading="none" runtime-src="/vendor/hyperframe.runtime.iife.js"',
        ),
      });
    } else await request.continue();
  });
  let sourceNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame.url().includes("/fixtures/gsap-heavy/")) sourceNavigations++;
  });
  await page.goto(`${server.origin}/host.html?fixture=gsap-heavy`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady === true);
  const witness = await page.evaluate(
    () =>
      (
        window as Window & {
          __iframeScalingWitness: {
            frames: number;
            sourceAssignments: number;
            probe: { width: number; height: number; density: number; beforeSource: boolean } | null;
          };
        }
      ).__iframeScalingWitness,
  );
  assert.equal(witness.frames, 1, "scaling must reuse the composition iframe");
  assert.equal(witness.sourceAssignments, 1, "initial attributes must navigate only once");
  assert.equal(sourceNavigations, 1, "the composition must commit one source navigation");
  assert.ok(witness.probe, "scaling must measure the initial blank frame at the probe zoom");
  assert.equal(
    witness.probe.beforeSource,
    true,
    "the scaling probe must precede source assignment",
  );
  assert.ok(Math.abs(witness.probe.width - 1920) < 3 && Math.abs(witness.probe.height - 1080) < 3);
  const hostDensity = await page.evaluate(() => window.devicePixelRatio);
  assert.ok(Math.abs(witness.probe.density - hostDensity * 0.3646) < 0.01);
  await page.evaluate(() => {
    document.getElementById("player")!.style.height = "100vh";
  });
  await page.waitForFunction(() => {
    const frame = document.getElementById("player")?.shadowRoot?.querySelector("iframe");
    return frame?.getBoundingClientRect().width === 528;
  });
  await page.evaluate(() =>
    (document.getElementById("player") as HTMLElement & { play(): void }).play(),
  );

  // A snapshot is only written on a compositor draw, so trace frames until one carries the tiles.
  let tiles: Layer[] = [];
  for (let attempt = 0; attempt < 20 && tiles.length === 0; attempt++) {
    await page.tracing.start({ categories: ["disabled-by-default-cc.debug"] });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const trace = JSON.parse(new TextDecoder().decode(await page.tracing.stop())) as {
      traceEvents: { args?: { snapshot?: { active_tree?: { layers?: Layer[] } } } }[];
    };
    tiles = trace.traceEvents
      .flatMap((event) => event.args?.snapshot?.active_tree?.layers ?? [])
      .filter(
        (layer) =>
          layer.compositing_reason_ids?.includes("WillChangeTransform") &&
          layer.raster_scales?.contents_scale &&
          layer.ideal_contents_scale,
      );
  }
  assert.ok(tiles.length > 0, "the trace should show the fixture's will-change tiles");
  for (const layer of tiles) {
    const oversize = layer.raster_scales!.contents_scale![0] / layer.ideal_contents_scale!;
    assert.ok(
      oversize <= 1.5,
      `a will-change layer is rastered at ${oversize.toFixed(2)}x the size shown`,
    );
  }
} finally {
  await browser.close();
  await server.stop();
}
