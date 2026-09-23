// CPU-only TSL -> WGSL probe. No renderer initialization, browser or GPU calls.
import * as THREE from "three/webgpu";
import { uniform, vec3, instancedArray, lights, mrt, output, velocity } from "three/tsl";
import WGSLNodeBuilder from "three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js";
import { Powder } from "../src/powder/Powder";
import { ErosionField } from "../src/erosion/ErosionField";
import { makeShape } from "../src/shape/sdf";
import { createIceMaterial } from "../src/ice/IceMaterial";
import { D } from "../src/dials/store";
import assert from "node:assert/strict";
THREE.TextureLoader.prototype.load = function () {
  return new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
} as any;
const renderer: any = new THREE.WebGPURenderer({
  canvas: { width: 1, height: 1, style: {}, addEventListener() {}, setAttribute() {} } as any,
});
renderer.hasFeature = () => true;
renderer.hasCompatibility = () => false;
renderer.backend.capabilities.getUniformBufferLimit = () => 65536;
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera();
const shape = makeShape("sphere", 1, 0.3),
  atomics = instancedArray(140000, "uint").toAtomic();
const erosion = new ErosionField(renderer, shape, 8, 7, atomics, 528, 1040, 66576);
const backdrop: any = {
  uTop: uniform(new THREE.Color()),
  uMid: uniform(new THREE.Color()),
  uBottom: uniform(new THREE.Color()),
  uCenter: uniform(new THREE.Vector2()),
  uRadius: uniform(1),
  uFalloff: uniform(1),
  uNoise: uniform(0),
  uTime: uniform(0),
  uAspect: uniform(1),
};
const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
const ice = createIceMaterial({
  shape,
  erosion,
  seed: 7,
  blueNoise: tex,
  environment: tex,
  fractureDetail: tex,
  backdrop,
});
D.powder.sprites.enabled = true;
D.powder.sprites.seeThrough = 0.78;
const powder = new Powder({
  renderer,
  scene,
  shape,
  erosion,
  seed: 7,
  rand: Math.random,
  count: 32,
  strays: 0,
  variants: 3,
  densityRes: 8,
  clumpCount: 4,
  objectGroup: new THREE.Group(),
  enabled: false,
  atomics,
  countersOffset: 512,
  healOffset: 528,
  cellOffset: 1040,
  flightOffset: 66576,
  fieldRes: 8,
  backdrop,
  fractureDetail: tex,
  iceUniforms: ice.uniforms,
  iceFeatures: ice.features,
  environment: tex,
});
(powder as any).buildMeshes();
const ids: number[] = [];
for (let v = 0; v < powder.meshes.length; v++) {
  const g: any = powder.meshes[v].geometry;
  assert.equal(g.indirect, null, "Shard visibility must not depend on indirect draw arguments");
  for (let i = 0; i < g.instanceCount; i++) ids.push(i * powder.meshes.length + v);
}
assert.deepEqual(
  ids.sort((a, b) => a - b),
  Array.from({ length: powder.total }, (_, i) => i),
  "Each particle is drawn exactly once",
);
const mesh = powder.meshes[0];
// Include the production motion-vector MRT and physical lighting. A bare
// unlit shader omitted the additional varyings used by the workbench pipeline.
const target = new THREE.RenderTarget(1, 1, { count: 2 });
target.textures[0].name = "output";
target.textures[1].name = "velocity";
renderer.getRenderTarget = () => target;
renderer.getMRT = () => mrt({ output, velocity });
const key = new THREE.DirectionalLight();
const rim = new THREE.SpotLight();
const builder: any = new WGSLNodeBuilder(mesh, renderer);
builder.scene = scene;
builder.camera = camera;
builder.lightsNode = lights([key, rim, new THREE.HemisphereLight()]);
builder.build();
const varyings = builder.vertexShader.match(/struct VaryingsStruct \{([\s\S]*?)\}/)?.[1];
assert.ok(varyings, "WGSL vertex output structure exists");
const locations = [...varyings.matchAll(/@location\(\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
assert.ok(
  locations.length <= 14 && Math.max(...locations) < 14,
  `Vertex output budget exceeded: ${locations.length} locations; reserve two of the hardware 16 for environment/shadow variants`,
);
const builtins = Number(/@builtin\(\s*front_facing\s*\)/.test(builder.fragmentShader));
assert.ok(
  locations.length + builtins <= 15,
  "Inter-stage outputs plus front_facing must fit the compatibility-mode budget",
);
console.log(
  "Physical shard shader with motion vectors:",
  locations.length,
  "vertex output locations (hardware limit 16).",
);
assert.match(builder.vertexShader, /instanceIndex \* 3u/);
assert.match(builder.vertexShader, /vec4<f32>\( (?:varyings\.)?positionLocal, 1.0 \)/);
console.log(
  "Shard WGSL generated without a GPU. Vertex bytes:",
  builder.vertexShader.length,
  "fragment bytes:",
  builder.fragmentShader.length,
);
// Compile simulation and retarget too: material-only checks cannot catch errors
// in assembly motion. This generates WGSL without submitting any GPU commands.
(powder as any).buildCompute();
for (const name of ["update", "retargetCount"]) {
  const compute: any = new WGSLNodeBuilder((powder as any).nodes[name], renderer);
  compute.scene = scene;
  compute.camera = camera;
  compute.build();
  assert.ok(compute.computeShader.includes("@compute"));
  console.log("Assembly " + name + " WGSL generated:", compute.computeShader.length, "bytes.");
}
