import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { bundleToSingleHtml } from "../../core/src/compiler/htmlBundler";
import { addScenePartsManifest } from "../../core/src/compiler/scenePartsManifest";
// Built Node entry, exactly the import consumed by Desktop.
const entry = "../dist/live.js";
const { prepareLiveInspection, fingerprint }: typeof import("../src/live") = await import(entry);
type PageRunner = import("../src/live").PageRunner;

const vendor = process.argv[2];
if (!vendor) throw new Error("Pass gsap.min.js");
const SCENES = ["one", "two", "three", "four"];
const SCENE_SECONDS = 5;
const dir = mkdtempSync(join(tmpdir(), "hf-live-scenes-"));
mkdirSync(join(dir, "compositions"));
writeFileSync(join(dir, "gsap.min.js"), readFileSync(vendor));
const hosts = SCENES.map(
  (name, n) =>
    `<div id="${name}" data-composition-id="${name}" data-composition-src="compositions/${name}.html" data-start="${n * SCENE_SECONDS}" data-duration="${SCENE_SECONDS}" data-track-index="1" data-width="1920" data-height="1080"></div>`,
).join("\n");
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><html><head><script src="gsap.min.js"></script></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${SCENES.length * SCENE_SECONDS}" data-width="1920" data-height="1080">
${hosts}
</div>
<script>const tl=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script>
</body></html>`,
);
for (const name of SCENES)
  writeFileSync(
    join(dir, "compositions", `${name}.html`),
    `<template>
<div id="root" data-composition-id="${name}" data-width="1920" data-height="1080"><p id="${name}-word">${name}</p></div>
<script>
const tl=gsap.timeline({paused:true});
tl.to('#${name}-word',{x:120,duration:1},1);
window.__timelines=window.__timelines||{};
window.__timelines["${name}"]=tl;
</script>
</template>`,
  );

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
let server: ReturnType<typeof createServer> | undefined;
try {
  const version = fingerprint(dir);
  const provenance: import("../../core/src/compiler/htmlBundler").BundleScriptProvenance[] = [];
  const bundled = await bundleToSingleHtml(dir, {
    runtime: "inline",
    sceneParts: true,
    scriptProvenance: (p) => provenance.push(p),
  });
  // What Studio's preview route serves: the scene manifest is what lets the runtime park far scenes.
  const live = prepareLiveInspection(dir, addScenePartsManifest(bundled), provenance, version);
  live.finalizeDocument(live.html);
  server = createServer((req, res) => {
    const gsap = req.url?.endsWith("/gsap.min.js");
    res.setHeader("Content-Type", gsap ? "text/javascript" : "text/html");
    res.end(gsap ? readFileSync(vendor) : live.html);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  browser = await puppeteer.launch({
    executablePath:
      process.env.HF_INSPECT_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage();
  const port = (server.address() as import("node:net").AddressInfo).port;
  await page.goto(`http://127.0.0.1:${port}/api/projects/test/preview`);
  await page.waitForFunction("!!window.__hfInspection && !!window.__hfHoldScenes", {
    timeout: 5000,
  });
  const runner: PageRunner = {
    run: <A, R>(fn: (arg: A) => R, arg: A) =>
      page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`) as Promise<R>,
  };
  const parked = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-hf-parked-scene]"), (el) =>
        el.getAttribute("data-hf-scene"),
      ).sort(),
    );
  const seek = async (time: number) => {
    await page.evaluate((t) => (window as any).__player.seek(t), time);
    await page.evaluate(() => (window as any).__hfWaitForSeekCompletion?.());
    await new Promise((r) => setTimeout(r, 200));
  };
  const words = SCENES.map((name) => ({ selector: `#${name}-word` }));

  for (const [n, scene] of SCENES.entries()) {
    await seek(n * SCENE_SECONDS + 1);
    const before = await parked();
    assert(before.length > 0, `at scene ${scene} the preview parks some scenes`);
    const found = await live.inspect(runner, { targets: words });
    assert.deepEqual(
      found.results.map((r) => r.status),
      SCENES.map(() => "found"),
      `inspect sees every composition with the playhead in ${scene}`,
    );
    const timeline = await live.timeline(runner, {});
    for (const name of SCENES)
      assert(timeline.text.includes(`#${name}-word`), `timeline lists ${name} from ${scene}`);
    const map = await live.elementMap(runner);
    for (const name of SCENES)
      assert(map.text.includes(`#${name}-word`), `element map lists ${name} from ${scene}`);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await parked(), before, `the query hands the scene window back at ${scene}`);
  }

  await seek(1);
  const beforeConcurrent = await parked();
  let queryReady = () => {};
  const ready = new Promise<void>((resolve) => {
    queryReady = resolve;
  });
  let resumeQuery = () => {};
  const resume = new Promise<void>((resolve) => {
    resumeQuery = resolve;
  });
  const delayedRunner: PageRunner = {
    async run(fn, arg) {
      if (fn.name === "queryPage") {
        queryReady();
        await resume;
      }
      return runner.run(fn, arg);
    },
  };
  const pending = live.inspect(delayedRunner, { targets: words });
  await ready;
  try {
    await live.elementMap(runner);
    await seek(16);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(
      await parked(),
      [],
      "another request cannot release an active inspection's scenes",
    );
  } finally {
    resumeQuery();
    await pending;
  }
  await seek(1);
  assert.deepEqual(await parked(), beforeConcurrent, "concurrent queries release their holds");

  const nestedRunner: PageRunner = {
    async run(fn, arg) {
      if (fn.name === "queryPage") {
        await live.timeline(runner, {});
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(await parked(), [], "a nested query leaves its caller's scenes mounted");
      }
      return runner.run(fn, arg);
    },
  };
  const nested = await live.inspect(nestedRunner, { targets: words });
  assert(nested.results.every((result) => result.status === "found"));

  for (const failurePoint of ["queryPage", "holdEveryScenePage"]) {
    const failedRunner: PageRunner = {
      async run(fn, arg) {
        if (fn.name === failurePoint) {
          if (failurePoint === "holdEveryScenePage") await runner.run(fn, arg);
          throw new DOMException("inspection aborted", "AbortError");
        }
        return runner.run(fn, arg);
      },
    };
    await assert.rejects(live.inspect(failedRunner, { targets: words }), /inspection aborted/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await parked(), beforeConcurrent, `${failurePoint} failure releases its hold`);
  }

  await page.evaluate(() => {
    const missing = document.createElement("div");
    missing.id = "unmountable";
    missing.setAttribute("data-hf-scene", "unmountable");
    missing.setAttribute("data-hf-parked-scene", "");
    document.body.append(missing);
  });
  try {
    await assert.rejects(live.elementMap(runner), /scenes_not_mounted:.*unmountable/);
  } finally {
    await page.evaluate(() => document.getElementById("unmountable")?.remove());
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(
    await parked(),
    beforeConcurrent,
    "a mount failure releases the scenes it acquired",
  );

  // Studio's own hold survives a query: the inspector holds apart from it.
  await seek(1);
  await page.evaluate(() => (window as any).__hfHoldScenes(["four"]));
  await live.inspect(runner, { targets: words });
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 50));
  assert(!(await parked()).includes("four"), "Studio's held scene stays mounted after a query");

  console.log(
    "PASS live preview scenes: inspect, timeline and element map see every composition wherever the playhead is, and hand the scene window back",
  );
} finally {
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
}
