// MVP: exact raster entry position and smooth mesh normal. The erosion/SDF path remains
// the fallback at every pixel whose original outer surface has been removed.
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
const { pass, mrt, vec4, positionLocal, normalLocal } = tsl;
export function createMeshEntry(geometry: THREE.BufferGeometry, camera: THREE.Camera) {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicNodeMaterial();
  material.side = THREE.FrontSide;
  material.toneMapped = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  const surfacePass = pass(scene, camera, { type: THREE.FloatType, samples: 0 });
  surfacePass.setMRT(mrt({ output: vec4(positionLocal, 1), normal: vec4(normalLocal, 0) }));
  const position = surfacePass.getTextureNode("output"),
    normal = surfacePass.getTextureNode("normal"),
    depth = surfacePass.getTextureNode("depth");
  for (const name of ["output", "normal"]) {
    const t = surfacePass.getTexture(name);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  return {
    surfacePass,
    position,
    normal,
    depth,
    mesh,
    material,
    update(source: THREE.Mesh, scale: number) {
      mesh.geometry = source.geometry;
      mesh.matrix.copy(source.matrixWorld);
      mesh.matrixWorld.copy(source.matrixWorld);
      mesh.visible = source.visible;
      surfacePass.setResolutionScale(scale);
    },
    dispose() {
      surfacePass.dispose();
      material.dispose();
    },
  };
}
