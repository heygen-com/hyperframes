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
  await page.goto(`${server.origin}/host.html?fixture=gsap-heavy`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady === true);
  await page.evaluate(() =>
    (document.getElementById("player") as HTMLElement & { play(): void }).play(),
  );

  await page.tracing.start({ categories: ["disabled-by-default-cc.debug"] });
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const trace = JSON.parse(String(await page.tracing.stop())) as {
    traceEvents: { args?: { snapshot?: { active_tree?: { layers?: Layer[] } } } }[];
  };
  const layers = trace.traceEvents.flatMap(
    (event) => event.args?.snapshot?.active_tree?.layers ?? [],
  );
  const tiles = layers.filter(
    (layer) =>
      layer.compositing_reason_ids?.includes("WillChangeTransform") &&
      layer.raster_scales?.contents_scale &&
      layer.ideal_contents_scale,
  );
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
