// fallow-ignore-file unused-file code-duplication complexity
/**
 * Browser acceptance test: SDK moveElement edits survive GSAP animation
 * per-axis (the AI Studio embedded-editor per-axis loss bug).
 *
 * Launches headless Chrome with real GSAP + the real runtime IIFE, loads a
 * fixture whose elements carry committed moveElement state (data-x/data-y +
 * data-hf-edit-base-x/y), seeks the timeline across its range, and asserts
 * the rendered position reflects the edit on BOTH axes at every sample:
 *  - an X-animated element keeps its edited offset while X animates
 *  - a Y-animated element keeps its edited offset while Y animates
 *  - a static element keeps both
 *
 * Runs in the plain embedded runtime — no Studio shell, no manual-edits
 * render script — matching what third-party SDK consumers load.
 *
 * Requires: puppeteer + gsap (monorepo deps, dynamically resolved; skips
 * with a notice when unavailable).
 * Run: cd packages/engine && npx tsx scripts/test-runtime-position-edits-browser.ts
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHyperframesRuntimeScript } from "../../core/src/inline-scripts/hyperframesRuntime.engine";

const thisDir = dirname(fileURLToPath(import.meta.url));

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function loadGsapSource(): string | null {
  const req = createRequire(import.meta.url);
  // gsap is a dep of studio / player / sdk-playground, hoisted in the
  // workspace store — resolve through whichever package has it.
  for (const pkg of ["studio", "player", "sdk-playground"]) {
    try {
      const path = req.resolve("gsap/dist/gsap.min.js", {
        paths: [resolvePath(thisDir, `../../${pkg}`)],
      });
      return readFileSync(path, "utf8");
    } catch {
      // try the next package
    }
  }
  return null;
}

interface Sample {
  t: number;
  ax: { x: number; y: number };
  ay: { x: number; y: number };
  axy: { x: number; y: number };
  ts: { x: number; y: number };
  st: { x: number; y: number };
}

async function main(): Promise<void> {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    console.log(
      JSON.stringify({
        event: "runtime_position_edits_browser_test_skipped",
        reason: "puppeteer not available",
      }),
    );
    return;
  }

  const gsapSource = loadGsapSource();
  if (gsapSource === null) {
    console.log(
      JSON.stringify({
        event: "runtime_position_edits_browser_test_skipped",
        reason: "gsap not available",
      }),
    );
    return;
  }

  const runtimeSource = buildHyperframesRuntimeScript({ minify: false });
  assert(
    runtimeSource !== null,
    "buildHyperframesRuntimeScript returned null — entry.ts not found",
  );

  // Committed moveElement state: every element moved by (50, -70). data-x/y
  // hold the post-edit values; data-hf-edit-base-x/y hold the pre-edit ones
  // (absent → "0"), exactly as handleMoveElement serializes them.
  const html = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; }
  .el { position: absolute; left: 0; top: 0; width: 40px; height: 40px; }
</style></head><body>
<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="4">
  <div id="ax" class="clip el" data-hf-id="hf-ax" data-start="0" data-duration="4"
       data-x="50" data-y="-70" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>
  <div id="ay" class="clip el" data-hf-id="hf-ay" data-start="0" data-duration="4"
       data-x="50" data-y="-70" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>
  <div id="axy" class="clip el" data-hf-id="hf-axy" data-start="0" data-duration="4"
       data-x="50" data-y="-70" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>
  <div id="ts" class="clip el" data-hf-id="hf-ts" data-start="0" data-duration="4"
       data-x="50" data-y="-70" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>
  <div id="st" class="clip el" data-hf-id="hf-st" data-start="0" data-duration="4"
       data-x="50" data-y="-70" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>
</div>
<script>${gsapSource}</script>
<script>
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
  tl.fromTo("#ax", { x: 0 }, { x: 400, duration: 4, ease: "none" }, 0);
  tl.fromTo("#ay", { y: 0 }, { y: 300, duration: 4, ease: "none" }, 0);
  tl.fromTo("#axy", { x: 0, y: 0 }, { x: 400, y: 300, duration: 4, ease: "none" }, 0);
  tl.set("#ts", { x: 200, y: 100 }, 1.0);
  // #st is never targeted by GSAP.
  window.__timelines.main = tl;
</script>
<script>${runtimeSource}</script>
</body></html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 10000 });

    // The runtime applies position edits after it binds the timeline — wait
    // for the translate to land on a marked element. String form: tsx/esbuild
    // injects a __name helper into serialized closures that the page lacks.
    await page.waitForFunction(
      `(function () {
        var el = document.getElementById("ax");
        return el !== null && getComputedStyle(el).translate !== "none";
      })()`,
      { timeout: 10000 },
    );

    const sampleScript = `(function (time) {
      if (window.__player && typeof window.__player.renderSeek === "function") {
        window.__player.renderSeek(time);
      } else if (window.__hf && typeof window.__hf.seek === "function") {
        window.__hf.seek(time);
      } else {
        throw new Error("no runtime seek surface (__player.renderSeek / __hf.seek)");
      }
      function read(id) {
        var el = document.getElementById(id);
        if (!el) throw new Error("missing #" + id);
        var cs = getComputedStyle(el);
        var m = new DOMMatrix(cs.transform === "none" ? "" : cs.transform);
        var parts = cs.translate === "none" ? [] : cs.translate.split(" ");
        var tx = parts.length > 0 ? parseFloat(parts[0]) : 0;
        var ty = parts.length > 1 ? parseFloat(parts[1]) : 0;
        return { x: m.m41 + tx, y: m.m42 + ty };
      }
      return {
        t: time,
        ax: read("ax"),
        ay: read("ay"),
        axy: read("axy"),
        ts: read("ts"),
        st: read("st"),
      };
    })`;

    const samples: Sample[] = [];
    for (const t of [0, 1, 2.5, 4]) {
      const sample = (await page.evaluate(`(${sampleScript})(${t})`)) as Sample;
      samples.push(sample);
    }

    const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 0.5;

    for (const s of samples) {
      // X-animated: x = animation (100·t) + edit (50); y = edit (−70).
      assert(
        close(s.ax.x, 100 * s.t + 50),
        `t=${s.t}: X-animated element x should be ${100 * s.t + 50}, got ${s.ax.x}`,
      );
      assert(close(s.ax.y, -70), `t=${s.t}: X-animated element y should keep -70, got ${s.ax.y}`);
      // Y-animated: y = animation (75·t) + edit (−70); x = edit (50).
      assert(close(s.ay.x, 50), `t=${s.t}: Y-animated element x should keep 50, got ${s.ay.x}`);
      assert(
        close(s.ay.y, 75 * s.t - 70),
        `t=${s.t}: Y-animated element y should be ${75 * s.t - 70}, got ${s.ay.y}`,
      );
      // Both-axis-animated: both axes = animation + edit (the shape that
      // originated the per-axis loss bug).
      assert(
        close(s.axy.x, 100 * s.t + 50),
        `t=${s.t}: XY-animated element x should be ${100 * s.t + 50}, got ${s.axy.x}`,
      );
      assert(
        close(s.axy.y, 75 * s.t - 70),
        `t=${s.t}: XY-animated element y should be ${75 * s.t - 70}, got ${s.axy.y}`,
      );
      // tl.set at t=1.0: before it fires, position = edit only; after, set + edit.
      const setX = s.t >= 1.0 ? 200 : 0;
      const setY = s.t >= 1.0 ? 100 : 0;
      assert(
        close(s.ts.x, setX + 50),
        `t=${s.t}: tl.set element x should be ${setX + 50}, got ${s.ts.x}`,
      );
      assert(
        close(s.ts.y, setY - 70),
        `t=${s.t}: tl.set element y should be ${setY - 70}, got ${s.ts.y}`,
      );
      // Static: both axes hold the edit.
      assert(close(s.st.x, 50), `t=${s.t}: static element x should be 50, got ${s.st.x}`);
      assert(close(s.st.y, -70), `t=${s.t}: static element y should be -70, got ${s.st.y}`);
    }

    // GSAP-free composition: no window.gsap, no timelines — the edit must
    // still render (applied at runtime init, not only at timeline bind).
    const gsapFreeHtml = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; }
  .el { position: absolute; left: 0; top: 0; width: 40px; height: 40px; }
</style></head><body>
<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="2">
  <div id="st" class="clip el" data-hf-id="hf-st" data-start="0" data-duration="2"
       data-x="50" data-y="-70" data-hf-edit-base-x="0" data-hf-edit-base-y="0"></div>
</div>
<script>${runtimeSource}</script>
</body></html>`;

    const page2 = await browser.newPage();
    await page2.setContent(gsapFreeHtml, { waitUntil: "networkidle0", timeout: 10000 });
    await page2.waitForFunction(
      `(function () {
        var el = document.getElementById("st");
        return el !== null && getComputedStyle(el).translate !== "none";
      })()`,
      { timeout: 10000 },
    );
    const gsapFree = (await page2.evaluate(
      `(function () {
        var cs = getComputedStyle(document.getElementById("st"));
        return { translate: cs.translate };
      })()`,
    )) as { translate: string };
    assert(
      gsapFree.translate === "50px -70px",
      `GSAP-free composition should render the edit as translate 50px -70px, got ${gsapFree.translate}`,
    );

    console.log(
      JSON.stringify({
        event: "runtime_position_edits_browser_test_passed",
        samples,
        gsapFree,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
