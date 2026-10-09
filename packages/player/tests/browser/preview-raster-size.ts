import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

// A small preview must raster its composition's will-change layers near the size it shows them, not at
// full size (which runs heavy compositions out of tile memory), without moving or repainting anything.
const server = startServer({ noCache: true });
const browser = await launchBrowser({ width: 1920, height: 1080 });

type Layer = {
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
  const until = (what: string, check: () => boolean) =>
    frame
      .waitForFunction(check, { timeout: 10_000 })
      .catch(() => assert.fail(`timed out: ${what}`));
  const swapped = () => getComputedStyle(document.querySelector(".lyric")!).willChange === "auto";
  const hinted = () =>
    getComputedStyle(document.querySelector(".lyric")!).willChange === "transform";
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
  // What the player sends; lets the test turn the swap off and on at one shown size.
  const sendDisplayScale = (scale: number) =>
    frame.evaluate(
      (value) =>
        window.postMessage(
          { source: "hf-parent", type: "control", action: "set-display-scale", scale: value },
          "*",
        ),
      scale,
    );
  const settle = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const seek = async (time: number) => {
    await page.evaluate(
      (t) => (document.getElementById("player") as HTMLElement & { seek(t: number): void }).seek(t),
      time,
    );
    await settle();
  };
  // Every box, what paints at the stacking and 3D probes, every inline style and computed filter.
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
        filters: elements.map((element) => getComputedStyle(element).filter),
      };
    });
  // A screenshot of a composition element's interior, 2px in from its antialiased edges.
  const shot = async (id: string) => {
    const [x, y, width, height] = await frame.evaluate((target) => {
      const box = document.getElementById(target)!.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    }, id);
    const [left, top, scale] = await page.evaluate(() => {
      const box = document.getElementById("player")!.getBoundingClientRect();
      return [box.x, box.y, box.width / 1920];
    });
    const clip = {
      x: left + x * scale + 2,
      y: top + y * scale + 2,
      width: width * scale - 4,
      height: height * scale - 4,
    };
    return page.screenshot({ encoding: "base64", clip });
  };
  const changedShare = (a: string, b: string) =>
    page.evaluate(
      async (first, second) => {
        const pixels = async (png: string) => {
          const image = new Image();
          image.src = `data:image/png;base64,${png}`;
          await image.decode();
          const canvas = new OffscreenCanvas(image.width, image.height);
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height).data;
        };
        const [p, q] = [await pixels(first), await pixels(second)];
        let changed = 0;
        for (let i = 0; i < p.length; i += 4) {
          const delta = [0, 1, 2].map((c) => Math.abs(p[i + c]! - q[i + c]!));
          if (Math.max(...delta) > 32) changed++;
        }
        return changed / (p.length / 4);
      },
      a,
      b,
    );
  // A layer snapshot is only written on a compositor draw, so each trace seeks to force one.
  const maxOversize = async (attempt: number) => {
    await page.tracing.start({ categories: ["disabled-by-default-cc.debug"] });
    await seek(attempt % 6);
    const trace = JSON.parse(new TextDecoder().decode(await page.tracing.stop())) as {
      traceEvents: { args?: { snapshot?: { active_tree?: { layers?: Layer[] } } } }[];
    };
    const ratios = trace.traceEvents
      .flatMap((event) => event.args?.snapshot?.active_tree?.layers ?? [])
      .filter((layer) => layer.raster_scales?.contents_scale && layer.ideal_contents_scale)
      .map((layer) => layer.raster_scales!.contents_scale![0] / layer.ideal_contents_scale!);
    return Math.max(0, ...ratios);
  };

  const full = await snapshot();
  assert.equal(await frame.evaluate(hinted), true, "shown at full size, the hints stay");
  assert.equal(full.stacking, "cover", "the hinted stack keeps its z-index child under a sibling");
  assert.equal(full.flipped, "card", "the flipped card hides its front");

  await resize(528, 297);
  await until("a small preview swaps the hints", swapped);
  const small = await snapshot();
  small.boxes.forEach((box, index) =>
    assert(
      box.every((value, edge) => Math.abs(value - full.boxes[index]![edge]!) < 0.01),
      `element ${index} moved from ${full.boxes[index]} to ${box}`,
    ),
  );
  assert.equal(small.stacking, "cover", "paint order is unchanged");
  assert.equal(small.flipped, "card", "a preserve-3d container is not flattened");
  assert.deepEqual(small.filters, full.filters, "no computed filter changes");
  await frame.evaluate(() => {
    const late = document.createElement("div");
    late.className = "lyric";
    late.id = "late";
    document.getElementById("lyrics")!.append(late);
  });
  await until(
    "a layer added later is swapped",
    () => getComputedStyle(document.getElementById("late")!).willChange === "auto",
  );
  await frame.evaluate(() => document.getElementById("late")!.remove());

  // The same small preview with the swap off and on: pixels match, and only the swap rasters small.
  // A capture can land before re-rastered tiles do, so each shot waits until two in a row agree.
  const steadyShot = async (id: string) => {
    let last = await shot(id);
    for (let attempt = 0; attempt < 20; attempt++) {
      const next = await shot(id);
      if (next === last) return next;
      last = next;
    }
    return assert.fail(`#${id} never stopped changing`);
  };
  const shots = async () => {
    await seek(0);
    return [await steadyShot("glass"), await steadyShot("tilt-wrap")];
  };
  const swappedShots = await shots();
  await sendDisplayScale(1);
  await until("the swap turns off", hinted);
  let unswapped = 0;
  for (let attempt = 0; attempt < 20 && unswapped <= 1.5; attempt++) {
    unswapped = await maxOversize(attempt);
  }
  assert.ok(unswapped > 1.5, `without the swap the trace shows ${unswapped}x, not oversized`);
  const nativeShots = await shots();
  const glass = await changedShare(swappedShots[0]!, nativeShots[0]!);
  assert.ok(glass <= 0.1, `frosted glass changed in ${(glass * 100).toFixed(0)}% of its pixels`);
  const tilt = await changedShare(swappedShots[1]!, nativeShots[1]!);
  assert.ok(tilt <= 0.1, `a 3D child of a swapped layer changed in ${(tilt * 100).toFixed(0)}%`);

  await sendDisplayScale(528 / 1920);
  await until("the swap turns back on", swapped);
  for (let clean = 0, attempt = 0; clean < 3; attempt++) {
    const oversize = await maxOversize(attempt);
    clean = oversize <= 1.5 ? clean + 1 : 0;
    assert.ok(attempt < 20, `a layer is still rastered at ${oversize.toFixed(2)}x the size shown`);
  }

  await resize(1920, 1080);
  await until("full size restores the hints", hinted);
  await seek(0);
  assert.deepEqual((await snapshot()).styles, full.styles, "full size restores every inline style");
  console.log("preview rasters at its shown size with layout and pixels unchanged: PASS");
} finally {
  await browser.close();
  await server.stop();
}
