import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileStrokes, DETAIL_PRESETS } from "./lib/paint-compiler.mjs";
import { emitComposition } from "./lib/paint-emit.mjs";

const SCRIPT = new URL("./paint.mjs", import.meta.url).pathname;
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function fixturePixels(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 255) / w;
      px[i + 1] = (y * 255) / h;
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  return px;
}

test("compileStrokes is deterministic for a fixed seed", () => {
  const a = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 1337,
    width: 400,
    layers: DETAIL_PRESETS.medium,
  });
  const b = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 1337,
    width: 400,
    layers: DETAIL_PRESETS.medium,
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.strokes.length > 0);
});

test("compileStrokes varies with the seed", () => {
  const a = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 1,
    width: 400,
    layers: DETAIL_PRESETS.medium,
  });
  const b = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 2,
    width: 400,
    layers: DETAIL_PRESETS.medium,
  });
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});

test("stroke geometry stays on the canvas and weights stay positive", () => {
  const r = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 7,
    width: 400,
    layers: DETAIL_PRESETS.high,
  });
  const overhang = Math.max(...DETAIL_PRESETS.high.map((l) => l.radius));
  for (const s of r.strokes) {
    assert.ok(s.x >= -overhang && s.x <= r.width + overhang, "x within one-radius overhang");
    assert.ok(s.y >= -overhang && s.y <= r.height + overhang, "y within one-radius overhang");
    assert.ok(s.weight > 0, "positive weight");
    assert.ok(s.len > 0, "positive length");
    assert.ok(Array.isArray(s.color) && s.color.length === 3, "color triple");
  }
});

test("emitted composition carries the HyperFrames contract", () => {
  const compiled = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 5,
    width: 400,
    layers: DETAIL_PRESETS.low,
  });
  const files = emitComposition({
    id: "paint-test",
    strokes: compiled.strokes,
    width: compiled.width,
    height: compiled.height,
    duration: 10,
    background: compiled.background,
  });
  assert.deepEqual(Object.keys(files).sort(), ["index.html", "strokes.js"]);
  const html = files["index.html"];
  assert.match(html, /data-composition-id="paint-test"/);
  assert.match(html, /data-start="0"/);
  assert.match(html, /data-width="400"/);
  assert.match(html, /data-duration="10"/);
  assert.match(html, /class="clip"/);
  assert.match(html, /window.__timelines/);
  assert.match(html, /gsap/);
  const strokesSource = files["strokes.js"];
  assert.match(strokesSource, /window\.__PAINT_STROKES = \[/);
  const assigned = strokesSource.match(/window\.__PAINT_STROKES = \[([\s\S]*)\];/)?.[1] ?? "";
  const parsed = JSON.parse(`[${assigned}]`);
  assert.equal(parsed.length, compiled.strokes.length);
  assert.match(html, /paintAt/);
  assert.match(html, /drawImage/);
  assert.match(html, /window\.__timelines\["paint-test"\]/);
});

test("emit is deterministic for identical inputs", () => {
  const compiled = compileStrokes(fixturePixels(96, 72), 96, 72, {
    seed: 9,
    width: 400,
    layers: DETAIL_PRESETS.low,
  });
  const opts = {
    id: "paint-test",
    strokes: compiled.strokes,
    width: compiled.width,
    height: compiled.height,
    duration: 10,
    background: compiled.background,
  };
  assert.deepEqual(emitComposition(opts), emitComposition(opts));
});

test("paint.mjs emits a composition from a real image", { skip: !HAS_FFMPEG }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-use-paint-"));
  t.after(cleanup);
  function cleanup() {
    rmSync(dir, { recursive: true, force: true });
  }
  const input = join(dir, "fixture.png");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "gradients=s=160x120:c0=0x224488:c1=0xeecc66",
    "-frames:v",
    "1",
    input,
  ]);
  const out = join(dir, "paint-fixture");
  const run = spawnSync(process.execPath, [SCRIPT, "--input", input, "--out", out, "--json"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const summary = JSON.parse(run.stdout);
  assert.ok(summary.strokes > 0);
  for (const file of ["index.html", "strokes.js"]) {
    assert.ok(existsSync(join(out, file)), file);
  }
  const strokesSource = readFileSync(join(out, "strokes.js"), "utf8");
  assert.match(strokesSource, /window\.__PAINT_STROKES = \[/);
  const run2 = spawnSync(
    process.execPath,
    [SCRIPT, "--input", input, "--out", join(dir, "paint-fixture-2"), "--json"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(run2.status, 0, run2.stderr);
  const strokes2 = readFileSync(join(dir, "paint-fixture-2", "strokes.js"), "utf8");
  assert.equal(strokesSource, strokes2, "same input + seed -> identical stroke data");
});
