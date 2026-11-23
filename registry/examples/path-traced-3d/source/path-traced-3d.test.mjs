import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const example = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(example, path), "utf8");

test("the manifest installs exactly the page and its assets", () => {
  const item = JSON.parse(read("registry-item.json"));
  const onDisk = readdirSync(join(example, "assets"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(example, join(entry.parentPath, entry.name)))
    .concat("index.html")
    .sort();
  assert.deepEqual(item.files.map((file) => file.path).sort(), onDisk);
  for (const file of item.files) assert.equal(file.target, file.path);
});

test("the page loads nothing from the network and defaults to the raster preview", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  const variables = JSON.parse(html.match(/data-composition-variables='([^']+)'/)[1]);
  assert.equal(variables.find((v) => v.id === "renderer").default, "raster");
  for (const file of ["assets/render.js", "assets/scene.js"]) {
    for (const match of read(file).matchAll(/from\s+"([^"]+)"/g)) {
      assert.match(match[1], /^\.\//, `${file} imports ${match[1]}`);
    }
  }
});

test("the vendored bundle matches the hash its note records", () => {
  const bundle = readFileSync(join(example, "assets/vendor/three-path-tracer.min.js"));
  const hash = createHash("sha256").update(bundle).digest("hex");
  assert.ok(read("assets/vendor/README.md").includes(hash));
  const pins = JSON.parse(read("source/package.json")).devDependencies;
  assert.equal(pins.three, "0.180.0");
  assert.equal(pins["three-gpu-pathtracer"], "0.0.24");
  assert.equal(pins["three-mesh-bvh"], "0.9.5");
});

test("rendering never waits on frames or the clock", () => {
  const source = read("assets/render.js").replace(/^\s*\/\/.*$/gm, "");
  for (const banned of [
    "requestAnimationFrame",
    "setAnimationLoop",
    "performance.now",
    "Date.now",
    "scheduler.yield",
    "compileAsync =",
    "setTimeout",
    "setInterval",
  ]) {
    assert.ok(!source.includes(banned), `render.js uses ${banned}`);
  }
  assert.match(source, /tracer\.renderDelay = 0;/);
  assert.match(source, /tracer\.stableNoise = true;/);
  assert.match(source, /window\.__hf\.buildReady\[READY_KEY\] = ready;/);
  assert.match(source, /event\.detail\.waitUntil\(queue\);/);
});

test("a pose depends only on its time, whatever was posed before", async () => {
  const THREE = await import(new URL("../assets/vendor/three-path-tracer.min.js", import.meta.url));
  const { createScene } = await import(new URL("../assets/scene.js", import.meta.url));
  const { scene, camera, poseAt } = createScene(THREE, { aspect: 16 / 9 });
  const snapshot = () => [
    ...camera.matrixWorld.elements,
    ...scene.children.flatMap((object) => object.matrixWorld.elements),
  ];

  poseAt(4);
  const atFour = snapshot();
  poseAt(0);
  const atZero = snapshot();
  poseAt(2.5);
  poseAt(4);
  assert.deepEqual(snapshot(), atFour);
  assert.notDeepEqual(atZero, atFour);
});
