import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

// A small preview must raster its composition's will-change layers near the size it shows them, not at
// full size (which runs heavy compositions out of tile memory), without moving or restacking anything.
const server = startServer({ noCache: true });
const browser = await launchBrowser({ width: 1920, height: 1080 });

type Layer = {
  compositing_reason_ids?: string[];
  ideal_contents_scale?: number;
  raster_scales?: { contents_scale?: [number, number] };
};

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("hyperframes-player { display: block; width: 1920px; height: 1080px }");
    document.adoptedStyleSheets = [sheet];
  });
  await page.goto(`${server.origin}/host.html?fixture=preview-raster`);
  await page.waitForFunction(() => window.__playerReady === true);
  const frame = page.frames().find((candidate) => candidate.url().includes("/fixtures/"));
  assert(frame, "composition frame loaded");
  const resize = (width: number, height: number) =>
    page.evaluate(
      (w, h) =>
        Object.assign(document.getElementById("player")!.style, {
          width: `${w}px`,
          height: `${h}px`,
        }),
      width,
      height,
    );
  const willChange = (id: string) =>
    frame.evaluate((target) => getComputedStyle(document.querySelector(target)!).willChange, id);
  // Every box, what paints at the stacking and 3D probes, and every inline style.
  const snapshot = () =>
    frame.evaluate(() => {
      const elements = [...document.querySelectorAll("*")];
      return {
        boxes: elements.map((element) => {
          const box = element.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        }),
        stacking: document.elementFromPoint(1000, 800)?.id,
        flipped: document.elementFromPoint(1500, 800)?.id,
        styles: elements.map((element) => (element as HTMLElement).style?.cssText ?? ""),
      };
    });

  const full = await snapshot();
  assert.equal(await willChange(".lyric"), "transform", "shown at full size, the hints stay");
  assert.equal(
    full.stacking,
    "cover",
    "the hinted stack keeps its z-index child under a later sibling",
  );
  assert.equal(full.flipped, "card", "the flipped card hides its front");

  await resize(528, 297);
  await frame.waitForFunction(
    () => getComputedStyle(document.querySelector(".lyric")!).willChange === "auto",
  );
  const small = await snapshot();
  small.boxes.forEach((box, index) =>
    assert(
      box.every((value, edge) => Math.abs(value - full.boxes[index]![edge]!) < 0.01),
      `element ${index} moved from ${full.boxes[index]} to ${box}`,
    ),
  );
  assert.equal(small.stacking, "cover", "paint order is unchanged");
  assert.equal(small.flipped, "card", "a preserve-3d container is not flattened");
  assert.equal(await willChange("#card"), "transform", "a preserve-3d container keeps its hint");
  assert.equal(
    await frame.evaluate(() => getComputedStyle(document.getElementById("blurred")!).filter),
    "blur(2px)",
    "an authored filter is kept",
  );
  await frame.evaluate(() => {
    const late = document.createElement("div");
    late.className = "lyric";
    late.id = "late";
    document.getElementById("lyrics")!.append(late);
  });
  await frame.waitForFunction(
    () => getComputedStyle(document.getElementById("late")!).willChange === "auto",
  );

  await resize(1920, 1080);
  await frame.waitForFunction(
    () => getComputedStyle(document.querySelector(".lyric")!).willChange === "transform",
  );
  await frame.evaluate(() => document.getElementById("late")!.remove());
  assert.deepEqual((await snapshot()).styles, full.styles, "full size restores every inline style");

  // Without the 3D card (which keeps its hint), nothing rasters above the size shown.
  await resize(528, 297);
  await frame.waitForFunction(
    () => getComputedStyle(document.querySelector(".lyric")!).willChange === "auto",
  );
  await frame.evaluate(() => document.getElementById("stage3d")!.remove());
  // A snapshot is only written on a compositor draw, so trace frames until one carries the layers.
  let layers: Layer[] = [];
  for (let attempt = 0; attempt < 20 && layers.length === 0; attempt++) {
    await page.tracing.start({ categories: ["disabled-by-default-cc.debug"] });
    await page.evaluate(
      (time) =>
        (document.getElementById("player") as HTMLElement & { seek(t: number): void }).seek(time),
      attempt % 6,
    );
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const trace = JSON.parse(new TextDecoder().decode(await page.tracing.stop())) as {
      traceEvents: { args?: { snapshot?: { active_tree?: { layers?: Layer[] } } } }[];
    };
    layers = trace.traceEvents
      .flatMap((event) => event.args?.snapshot?.active_tree?.layers ?? [])
      .filter((layer) => layer.raster_scales?.contents_scale && layer.ideal_contents_scale);
  }
  assert.ok(layers.length > 0, "the trace should show the preview's layers");
  for (const layer of layers) {
    const oversize = layer.raster_scales!.contents_scale![0] / layer.ideal_contents_scale!;
    assert.ok(oversize <= 1.5, `a layer is rastered at ${oversize.toFixed(2)}x the size shown`);
  }
  console.log("preview rasters at its shown size with layout, paint order and 3D unchanged: PASS");
} finally {
  await browser.close();
  await server.stop();
}
