// The scene: a few PBR objects on a plinth under a soft spotlight. Edit freely.
// `poseAt(t)` is the only thing that moves anything, and it reads nothing but `t`,
// so any frame can be drawn on its own and in any order.

export const DURATION = 6;

export function createScene(THREE, { aspect }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0e1115");
  scene.environment = studioEnvironment(THREE);
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 200);

  const floorMat = new THREE.MeshStandardMaterial({ color: "#121418", roughness: 0.9 });
  const plinthMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: "#d9a94e", metalness: 1, roughness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({
    color: "#c9ced4",
    metalness: 1,
    roughness: 0.12,
  });
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: "#ece6db",
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  const lacquer = new THREE.MeshStandardMaterial({ color: "#b23a2e", roughness: 0.45 });

  function add(geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  const floor = add(new THREE.PlaneGeometry(120, 120), floorMat);
  floor.rotation.x = -Math.PI / 2;
  add(new THREE.CylinderGeometry(2.1, 2.2, 0.5, 96), plinthMat, 0, 0.25, 0);

  const knot = add(new THREE.TorusKnotGeometry(0.5, 0.17, 220, 32), gold);
  const orbiters = [
    { mesh: add(new THREE.SphereGeometry(0.38, 64, 32), ceramic), phase: 0, radius: 1.45, y: 0.88 },
    {
      mesh: add(new THREE.BoxGeometry(0.52, 0.52, 0.52), lacquer),
      phase: 2.1,
      radius: 1.5,
      y: 0.76,
    },
    { mesh: add(new THREE.SphereGeometry(0.26, 64, 32), chrome), phase: 4.2, radius: 1.4, y: 0.76 },
  ];

  // PhysicalSpotLight is a three SpotLight with a radius, so the tracer draws soft shadows
  // from it and the raster renderer still treats it as an ordinary spotlight.
  const key = new THREE.PhysicalSpotLight("#ffe3bd", 140);
  key.position.set(-4, 6.5, 3.5);
  key.angle = 0.55;
  key.penumbra = 0.45;
  key.radius = 0.5;
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0002;
  key.target.position.set(0, 0.8, 0);
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight("#bcd2ff", 1.1);
  rim.position.set(4, 4, -5);
  scene.add(rim);

  function poseAt(t) {
    const p = Math.min(Math.max(t / DURATION, 0), 1);
    const eased = p * p * (3 - 2 * p);

    knot.position.set(0, 1.5 + 0.08 * Math.sin(t * 1.3), 0);
    knot.rotation.set(0.35, t * 0.9, 0.15 * Math.sin(t * 0.7));
    for (const { mesh, phase, radius, y } of orbiters) {
      const angle = phase + t * 0.55;
      mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      mesh.rotation.set(t * 0.4, angle, 0);
    }

    const orbit = -0.55 + 1.0 * eased;
    const distance = 7.4 - 1.6 * eased;
    camera.position.set(Math.sin(orbit) * distance, 2.7 - 0.6 * eased, Math.cos(orbit) * distance);
    camera.lookAt(0, 1.05, 0);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
  }

  return { scene, camera, poseAt };
}

// A dark studio with two soft light strips, as a float equirect texture both renderers can use.
function studioEnvironment(THREE) {
  const width = 256;
  const height = 128;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const warm = Math.exp(-(((u - 0.2) / 0.06) ** 4) - ((v - 0.32) / 0.12) ** 4) * 4;
      const cool = Math.exp(-(((u - 0.7) / 0.04) ** 4) - ((v - 0.38) / 0.16) ** 4) * 2.2;
      const base = 0.05 + 0.08 * Math.max(0, Math.cos(v * Math.PI));
      const i = (y * width + x) * 4;
      pixels[i] = base + warm + cool * 0.7;
      pixels[i + 1] = base + warm * 0.86 + cool * 0.85;
      pixels[i + 2] = base + warm * 0.66 + cool;
      pixels[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}
