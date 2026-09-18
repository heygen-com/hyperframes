import * as THREE from "./three.module.min.js";
import { MOTION } from "./orbit-motion.js";

// Blender X/Y/Z -> Three X/Z/-Y. 100 original CSS pixels = one rig unit.
const V = window.__hyperframes?.getVariables?.() || {};
const number = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const degrees = Math.max(-36000, Math.min(36000, number(V.cardOrbitDegrees, 360)));
const title = String(V.feature1Title || "Always in sync");
const description = String(V.feature1Desc || "Changes reach every screen the moment they happen.");
const accent = /^#[0-9a-f]{6}$/i.test(V.feature1Accent) ? V.feature1Accent : "#4cc9ff";
const stage = document.getElementById("oc-stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080);
renderer.setClearColor("#161718");
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute(
  "aria-label",
  "Orbit Card: approved Blender camera and card animation",
);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
// Saved rig: 30 mm lens, 36 mm sensor, 1920 x 1080.
const camera = new THREE.PerspectiveCamera(
  (2 * Math.atan(36 / (1920 / 1080) / 60) * 180) / Math.PI,
  1920 / 1080,
  0.1,
  200,
);
scene.add(new THREE.HemisphereLight(0xffffff, 0x414753, 2.1));
const keyLight = new THREE.DirectionalLight(0xf0f5ff, 3.0);
keyLight.position.set(-5, 8, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8fbad2, 2.0);
rimLight.position.set(5, 3, -5);
scene.add(rimLight);

const sourceRig = new THREE.Group();
sourceRig.name = "Card_Rig_EDIT_ME";
scene.add(sourceRig);
const orbitPivot = new THREE.Group();
orbitPivot.name = "Card_Orbit_EDIT_ME";
orbitPivot.position.set(0, 0.94, 0);
sourceRig.add(orbitPivot);
const card = new THREE.Group();
card.position.copy(orbitPivot.position).multiplyScalar(-1);
orbitPivot.add(card);

function roundedRect(w, h, r) {
  const s = new THREE.Shape(),
    x = -w / 2,
    y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const shape = roundedRect(4.4, 5.4, 0.24);
const hole = new THREE.Path();
hole.absarc(0, 0.94, 1.08, 0, Math.PI * 2, true);
shape.holes.push(hole);
const plateGeometry = new THREE.ExtrudeGeometry(shape, {
  depth: 0.16,
  bevelEnabled: true,
  bevelSize: 0.025,
  bevelThickness: 0.02,
  bevelSegments: 3,
  steps: 1,
  curveSegments: 64,
});
plateGeometry.translate(0, 0, -0.08);
const plate = new THREE.Mesh(
  plateGeometry,
  new THREE.MeshStandardMaterial({ color: "#16191d", metalness: 0.32, roughness: 0.38 }),
);
plate.name = "Orbit_Card";
card.add(plate);
const outlineMaterial = new THREE.LineBasicMaterial({
  color: "#58616b",
  transparent: true,
  opacity: 0.45,
});
const outline = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(
    shape.getPoints(96).map((p) => new THREE.Vector3(p.x, p.y, 0.103)),
  ),
  outlineMaterial,
);
card.add(outline);
const apertureRim = new THREE.Mesh(
  new THREE.TorusGeometry(1.08, 0.009, 6, 128),
  new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3 }),
);
apertureRim.position.set(0, 0.94, 0.103);
card.add(apertureRim);
// The aperture is open through the plate: no separate circular backplate.

const copyCanvas = document.createElement("canvas");
copyCanvas.width = 1440;
copyCanvas.height = 500;
const copyContext = copyCanvas.getContext("2d");
const copyTexture = new THREE.CanvasTexture(copyCanvas);
copyTexture.colorSpace = THREE.SRGBColorSpace;
copyTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const copy = new THREE.Mesh(
  new THREE.PlaneGeometry(3.6, 1.25),
  new THREE.MeshBasicMaterial({
    map: copyTexture,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  }),
);
copy.position.set(0, -1.525, 0.106);
card.add(copy);
function paintCopy() {
  const g = copyContext,
    k = 4;
  g.clearRect(0, 0, 1440, 500);
  g.fillStyle = accent;
  g.fillRect(0, 10, 30 * k, 3 * k);
  g.fillStyle = "#f0f3f5";
  g.font = "600 108px Archivo";
  g.fillText(title, 0, 165, 1440);
  g.fillStyle = "#a4a8ad";
  g.font = "400 66px Archivo";
  const words = description.split(/\s+/);
  let line = "",
    y = 305;
  for (const word of words) {
    if (g.measureText(line + word).width > 1420 && line) {
      g.fillText(line.trim(), 0, y);
      y += 99;
      line = "";
    }
    line += word + " ";
  }
  g.fillText(line.trim(), 0, y);
  copyTexture.needsUpdate = true;
}
paintCopy();

// A sibling branch of the orbit control: the sphere retains its own spin.
const sphereTilt = new THREE.Group();
sphereTilt.name = "Sphere_Tilt_FROM_SOURCE";
sphereTilt.position.set(0, 0.94, 0);
sphereTilt.rotation.x = -0.32;
sourceRig.add(sphereTilt);
const sphere = new THREE.Group();
sphere.name = "Dot_Sphere_Proxy";
sphereTilt.add(sphere);
const dotGeometry = new THREE.IcosahedronGeometry(0.012, 0);
const dotMaterial = new THREE.MeshStandardMaterial({
  color: "#ecf0f4",
  roughness: 0.45,
  emissive: "#c4d5df",
  emissiveIntensity: 0.18,
});
const dots = new THREE.InstancedMesh(dotGeometry, dotMaterial, 640);
const dummy = new THREE.Object3D();
const golden = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < 640; i++) {
  const y = 1 - (i / 639) * 2,
    radius = Math.sqrt(Math.max(0, 1 - y * y)),
    a = golden * i;
  dummy.position.set(Math.cos(a) * radius, -y, Math.sin(a) * radius);
  dummy.updateMatrix();
  dots.setMatrixAt(i, dummy.matrix);
}
sphere.add(dots);

const clamp = (u) => Math.max(0, Math.min(1, u));
const smooth = (u) => u * u * (3 - 2 * u);
// Saved Blender F-curves: linear time handles, exact cubic value handles.
function channelAt(keys, frame) {
  if (frame <= keys[0][0][0]) return keys[0][0][1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (frame <= b[0][0]) {
      const u = (frame - a[0][0]) / (b[0][0] - a[0][0]),
        v = 1 - u;
      return a[3] === "LINEAR"
        ? a[0][1] * v + b[0][1] * u
        : v ** 3 * a[0][1] + 3 * v * v * u * a[2][1] + 3 * v * u * u * b[1][1] + u ** 3 * b[0][1];
    }
  }
  return keys[keys.length - 1][0][1];
}
// Camera positions are the saved rig's evaluated 30 fps export, not a new orbit.
function cameraAt(time) {
  const f = Math.min(300, Math.max(0, time * 30)),
    i = Math.min(299, Math.floor(f)),
    u = f - i;
  const a = MOTION.cameraPositions[i],
    b = MOTION.cameraPositions[i + 1];
  camera.position.set(
    a[0] + (b[0] - a[0]) * u,
    a[2] + (b[2] - a[2]) * u,
    -a[1] - (b[1] - a[1]) * u,
  );
  const frame = 1 + time * 30;
  let aim = MOTION.aimKeys.at(-1)[1];
  for (let j = 1; j < MOTION.aimKeys.length; j++) {
    const a = MOTION.aimKeys[j - 1],
      b = MOTION.aimKeys[j];
    if (frame <= b[0]) {
      aim = THREE.MathUtils.lerp(a[1], b[1], smooth(clamp((frame - a[0]) / (b[0] - a[0]))));
      break;
    }
  }
  camera.lookAt(0, aim, 0);
}
const channels = MOTION.cardChannels;
let currentTime = 0;
export function renderAt(time) {
  currentTime = Math.max(0, Math.min(10, time));
  const frame = 1 + currentTime * 30;
  const values = channels.map((c) => channelAt(c.keys, frame));
  sourceRig.position.set(values[0], values[2], -values[1]);
  sourceRig.rotation.y = values[3];
  orbitPivot.rotation.y = THREE.MathUtils.degToRad(degrees) * smooth(clamp((frame - 150) / 30));
  sphere.rotation.y = currentTime * 0.5;
  sphere.scale.setScalar(channelAt(MOTION.sphereScale, frame));
  cameraAt(currentTime);
  renderer.render(scene, camera);
}

renderAt(0);
document.fonts.ready.then(() => {
  paintCopy();
  renderAt(currentTime);
});

// Read-only inspection aid for the live workbench; no extra animation clock.
window.__orbitCardMotion = {
  fps: 30,
  duration: 10,
  orbitFrames: [150, 180],
  degrees,
  get pose() {
    const center = sphereTilt.getWorldPosition(new THREE.Vector3());
    return {
      frame: 1 + currentTime * 30,
      camera: camera.position.toArray(),
      cardOrbitDegrees: THREE.MathUtils.radToDeg(orbitPivot.rotation.y),
      sphereCenter: center.toArray(),
      sphereSpin: sphere.rotation.y,
    };
  },
};
