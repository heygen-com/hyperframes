import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import preset from "../../presets/approved-material.json";
import {
  parseTrack,
  emptyTrack,
  ShotHistory,
  baselineCamera,
  applyCameraAt,
  cameraAt,
  type CameraKey,
  type CameraTrack,
  type V3,
  type Q4,
} from "./track";
import { objectFrameAt, shapeAt } from "./objectFrame";
import { skeletonMeshes } from "./meshes";
import { resolveSchedule, durationOf } from "../core/schedule";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $<HTMLInputElement>(id),
  select = (id: string) => $<HTMLSelectElement>(id);
const status = (s: string) => {
  $("status").textContent = s;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      status("Browser storage unavailable. Export JSON to keep this shot.");
    }
  },
};
let values: any = { ...preset },
  time = 0,
  playing = false,
  draft = false,
  selected = "",
  roll = 0,
  syncing = false,
  dirty = true,
  ready = false;
let fullWindow: Window | null = null;
const history = new ShotHistory();
try {
  const raw = new URLSearchParams(location.hash.slice(1)).get("vars");
  if (raw) values = { ...values, ...JSON.parse(raw) };
  const saved = store.get("frost-motion-draft-v1");
  if (saved) history.track = parseTrack(saved);
  if (values.cameraMode === "authored") history.track = parseTrack(values.cameraTrack);
} catch (e) {
  status(String(e));
}
const schedule = () =>
  resolveSchedule(
    {
      logoBreak: +values.logoBreakAt,
      form1: +values.formHeadline1At,
      break1: +values.headline1BreakAt,
      form2: +values.formHeadline2At,
      break2: +values.headline2BreakAt,
      fadeOut: +values.fadeOutAt,
    },
    +values.breakDuration,
  );
let S = schedule(),
  duration = durationOf(S);
const camera = baselineCamera(),
  overviewCamera = new THREE.PerspectiveCamera(45, 320 / 220, 0.1, 150);
overviewCamera.position.set(19, 14, 22);
overviewCamera.lookAt(0, 0, 4);
const renderer = new THREE.WebGLRenderer({
    canvas: $<HTMLCanvasElement>("preview"),
    antialias: true,
  }),
  overviewRenderer = new THREE.WebGLRenderer({
    canvas: $<HTMLCanvasElement>("overview-canvas"),
    antialias: true,
  });
for (const r of [renderer, overviewRenderer]) {
  r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  r.setClearColor("#161b21");
}
const scene = new THREE.Scene(),
  motion = new THREE.Group(),
  object = new THREE.Group();
scene.add(motion);
motion.add(object);
scene.add(new THREE.HemisphereLight("#d9edff", "#485260", 2));
const light = new THREE.DirectionalLight("#ffffff", 2.5);
light.position.set(3, 7, 9);
scene.add(light);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.target.set(0, 0.05, 0);
controls.minDistance = 0.3;
controls.maxDistance = 100;
controls.update();
const overviewControls = new OrbitControls(overviewCamera, overviewRenderer.domElement);
overviewControls.target.set(0, 0, 3);
overviewControls.enableDamping = false;
overviewControls.update();
overviewCamera.layers.enable(1);
const grid = new THREE.GridHelper(40, 20, 0x425c6e, 0x2b3945);
grid.position.y = -3;
grid.layers.set(1);
scene.add(grid);
const pathGroup = new THREE.Group();
pathGroup.layers.set(1);
scene.add(pathGroup);
const helper = new THREE.CameraHelper(camera);
helper.layers.set(1);
scene.add(helper);
let meshes: THREE.Mesh[] = [],
  markers: THREE.Mesh[] = [];
const track = () => history.track;
const frame = () =>
  objectFrameAt(time, S, values, shapeAt(time, S), track().objectMotion === "stationary");
function objectsAt() {
  const f = frame();
  motion.position.copy(f.position);
  motion.quaternion.copy(f.rotation);
  object.quaternion.copy(f.facing);
  motion.updateMatrixWorld(true);
  const k = shapeAt(time, S),
    breaking = time >= [S.logoBreak, S.break1, S.break2][k];
  meshes.forEach((m, i) => {
    m.visible = i === k;
    (m.material as THREE.MeshLambertMaterial).wireframe = breaking;
  });
  $("phase").textContent =
    ["Logo", "Headline 1", "Headline 2"][k] + (breaking ? " · breakup ghost" : " · solid geometry");
  return f;
}
function cameraReplay() {
  syncing = true;
  const f = objectsAt();
  applyCameraAt(camera, track(), time, f.matrix, controls.target);
  const state = cameraAt(track(), time, f.matrix);
  if (track().orientation === "free")
    controls.target
      .copy(camera.position)
      .add(
        new THREE.Vector3(0, 0, -1)
          .applyQuaternion(camera.quaternion)
          .multiplyScalar(Math.max(1, camera.position.distanceTo(state.target))),
      );
  controls.update();
  applyCameraAt(camera, track(), time, f.matrix, new THREE.Vector3());
  roll = state.roll;
  field("view-fov").value = camera.fov.toFixed(2);
  field("view-zoom").value = camera.zoom.toFixed(3);
  field("view-roll").value = roll.toFixed(2);
  syncing = false;
}
function seek(t: number) {
  time = THREE.MathUtils.clamp(t, 0, duration);
  draft = false;
  cameraReplay();
  field("time").value = String(time);
  $("time-label").textContent = `${time.toFixed(3)} / ${duration.toFixed(3)} s`;
  $("view-state").textContent = "CAMERA · Track replay";
  dirty = true;
}
controls.addEventListener("change", () => {
  if (syncing) return;
  playing = false;
  draft = true;
  if (roll) camera.rotateZ(THREE.MathUtils.degToRad(roll));
  $("view-state").textContent = "CAMERA · Uncaptured view";
  dirty = true;
});
overviewControls.addEventListener("change", () => (dirty = true));
function freshId() {
  let i = 1;
  while (track().keys.some((k) => k.id === "key-" + i)) i++;
  return "key-" + i;
}
function commit(next: CameraTrack, replay = true) {
  if (next.keys.some((k) => k.time > duration))
    throw Error(`Keep camera keys within ${duration} seconds.`);
  history.commit(next);
  store.set("frost-motion-draft-v1", JSON.stringify(track()));
  refresh();
  if (replay) seek(time);
  dirty = true;
}
function capture(update = false) {
  if (!ready) return;
  const next = clone(track()),
    previous = next.keys.find((k) => k.id === selected),
    target = controls.target.clone();
  if (next.anchorSpace === "local") target.applyMatrix4(frame().matrix.clone().invert());
  const q = camera.quaternion
    .clone()
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (-roll * Math.PI) / 180),
    );
  const key: CameraKey = {
    id: update && previous ? previous.id : freshId(),
    time,
    position: camera.position.toArray() as V3,
    target: target.toArray() as V3,
    quaternion: q.toArray() as Q4,
    fov: camera.fov,
    zoom: camera.zoom,
    roll,
    ease: previous?.ease || "flow",
  };
  if (update && !previous) throw Error("Select a key to update.");
  if (update) next.keys[next.keys.findIndex((k) => k.id === selected)] = key;
  else next.keys.push(key);
  selected = key.id;
  commit(next);
  status(`Captured ${key.id} at ${time.toFixed(3)} s. Scrub or play to replay.`);
}
function editKey(change: (k: CameraKey) => void) {
  const next = clone(track()),
    key = next.keys.find((k) => k.id === selected);
  if (!key) return;
  change(key);
  commit(next);
}
function path() {
  for (const child of [...pathGroup.children]) {
    pathGroup.remove(child);
    (child as THREE.Mesh).geometry?.dispose();
    const mat = (child as THREE.Mesh).material;
    if (mat && !Array.isArray(mat)) mat.dispose();
  }
  markers = [];
  if (!track().keys.length) return;
  const points = [];
  for (let i = 0; i <= 200; i++) points.push(cameraAt(track(), (duration * i) / 200).position);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x7ba7c5 }),
  );
  line.layers.set(1);
  pathGroup.add(line);
  for (const key of track().keys) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshBasicMaterial({ color: key.id === selected ? 0xffd27b : 0x9adefc }),
    );
    m.position.fromArray(key.position);
    m.userData.key = key.id;
    m.layers.set(1);
    pathGroup.add(m);
    markers.push(m);
  }
}
function refresh() {
  field("name").value = track().name;
  select("orientation").value = track().orientation;
  select("anchor").value = track().anchorSpace;
  select("objects").value = track().objectMotion;
  const list = select("key-list");
  list.replaceChildren();
  const lane = $("keys");
  lane.replaceChildren();
  for (const k of track().keys) {
    const o = new Option(`${k.time.toFixed(3)} s · ${k.id}`, k.id);
    list.add(o);
    const b = document.createElement("button");
    b.className = "key" + (k.id === selected ? " selected" : "");
    b.style.left = `${(k.time / duration) * 100}%`;
    b.textContent = String(track().keys.indexOf(k) + 1);
    b.setAttribute("aria-label", `${k.id} at ${k.time.toFixed(3)} seconds; drag to retime`);
    b.onpointerdown = (e) => {
      e.stopPropagation();
      selected = k.id;
      b.setPointerCapture(e.pointerId);
      const before = clone(track());
      let moved = false;
      const move = (event: PointerEvent) => {
        moved = true;
        const rect = lane.getBoundingClientRect();
        const t = THREE.MathUtils.clamp(
          ((event.clientX - rect.left) / rect.width) * duration,
          0,
          duration,
        );
        b.style.left = `${(t / duration) * 100}%`;
        field("key-time").value = t.toFixed(3);
      };
      b.onpointermove = move;
      b.onpointerup = () => {
        b.onpointermove = null;
        b.onpointerup = null;
        if (moved) {
          const next = clone(before);
          next.keys.find((x) => x.id === k.id)!.time = +field("key-time").value;
          safe(() => commit(next));
        } else {
          refresh();
          seek(k.time);
        }
      };
    };
    lane.append(b);
  }
  if (!track().keys.length) list.add(new Option("No keys captured", ""));
  if (!track().keys.some((k) => k.id === selected)) selected = track().keys[0]?.id || "";
  list.value = selected;
  const k = track().keys.find((k) => k.id === selected);
  if (k) {
    field("key-time").value = String(k.time);
    select("ease").value = k.ease;
    ["px", "py", "pz"].forEach((id, j) => (field(id).value = k.position[j].toFixed(4)));
    ["tx", "ty", "tz"].forEach((id, j) => (field(id).value = k.target[j].toFixed(4)));
  }
  path();
}
function safe(fn: () => void) {
  try {
    fn();
  } catch (e) {
    status(String(e));
  }
}
function button(id: string, fn: () => void) {
  $(id).onclick = () => safe(fn);
}
button("capture", () => capture());
button("update", () => capture(true));
button("play", () => {
  playing = !playing;
  if (playing) {
    draft = false;
    if (time >= duration) seek(0);
  }
});
button("undo", () => {
  history.undo();
  refresh();
  seek(time);
  store.set("frost-motion-draft-v1", JSON.stringify(track()));
});
button("redo", () => {
  history.redo();
  refresh();
  seek(time);
  store.set("frost-motion-draft-v1", JSON.stringify(track()));
});
field("time").oninput = () => {
  playing = false;
  seek(+field("time").value);
};
$("keys").onclick = (e) => {
  if (e.target !== $("keys")) return;
  const rect = $("keys").getBoundingClientRect();
  seek(((e.clientX - rect.left) / rect.width) * duration);
};
select("key-list").onchange = () => {
  selected = select("key-list").value;
  refresh();
  seek(track().keys.find((k) => k.id === selected)!.time);
};
field("key-time").onchange = () => safe(() => editKey((k) => (k.time = +field("key-time").value)));
select("ease").onchange = () => safe(() => editKey((k) => (k.ease = select("ease").value as any)));
for (const [ids, attr] of [
  [["px", "py", "pz"], "position"],
  [["tx", "ty", "tz"], "target"],
] as const)
  for (let j = 0; j < 3; j++)
    field(ids[j]).onchange = () => safe(() => editKey((k) => (k[attr][j] = +field(ids[j]).value)));
for (const [id, attr] of [
  ["name", "name"],
  ["orientation", "orientation"],
  ["anchor", "anchorSpace"],
  ["objects", "objectMotion"],
])
  field(id).onchange = () =>
    safe(() => {
      const next = clone(track());
      if (attr === "anchorSpace" && next.anchorSpace !== field(id).value) {
        for (const k of next.keys) {
          const m = objectFrameAt(
            k.time,
            S,
            values,
            shapeAt(k.time, S),
            next.objectMotion === "stationary",
          ).matrix;
          if (field(id).value === "local") m.invert();
          k.target = new THREE.Vector3(...k.target).applyMatrix4(m).toArray() as V3;
        }
      }
      (next as any)[attr] = field(id).value;
      commit(next);
    });
for (const id of ["view-fov", "view-zoom", "view-roll"])
  field(id).onchange = () =>
    safe(() => {
      const f = +field("view-fov").value,
        z = +field("view-zoom").value,
        r = +field("view-roll").value;
      if (f < 5 || f > 120 || z < 0.1 || z > 10 || !Number.isFinite(r) || Math.abs(r) > 720)
        throw Error("FOV 5–120, zoom 0.1–10, roll −720–720.");
      camera.fov = f;
      camera.zoom = z;
      camera.rotateZ(((r - roll) * Math.PI) / 180);
      roll = r;
      camera.updateProjectionMatrix();
      draft = true;
      playing = false;
      dirty = true;
      $("view-state").textContent = "CAMERA · Uncaptured view";
    });
button("duplicate", () => {
  const next = clone(track()),
    k = next.keys.find((k) => k.id === selected);
  if (!k) return;
  const copy = clone(k);
  copy.id = freshId();
  copy.time = Math.min(duration, k.time + 0.5);
  while (next.keys.some((x) => Math.abs(x.time - copy.time) < 1 / 240) && copy.time > 0)
    copy.time -= 1 / 30;
  next.keys.push(copy);
  selected = copy.id;
  commit(next);
  seek(copy.time);
});
button("delete", () => {
  commit({ ...clone(track()), keys: track().keys.filter((k) => k.id !== selected) });
});
function library(): Map<string, CameraTrack> {
  try {
    return new Map(Object.entries(JSON.parse(store.get("frost-motion-shots-v1") || "{}")));
  } catch {
    return new Map();
  }
}
function refreshLibrary() {
  select("saved").replaceChildren(...[...library().keys()].sort().map((n) => new Option(n, n)));
}
button("save", () => {
  const shots = library();
  shots.set(track().name, clone(track()));
  store.set("frost-motion-shots-v1", JSON.stringify(Object.fromEntries(shots)));
  refreshLibrary();
  select("saved").value = track().name;
  status("Saved shot: " + track().name);
});
button("load", () => {
  const shot = library().get(select("saved").value);
  if (shot) commit(parseTrack(shot));
});
const appliedValues = (original = false) => ({
  ...values,
  cameraMode: original ? "original" : "authored",
  cameraTrack: original ? "" : JSON.stringify(parseTrack(track())),
});
function download(name: string, data: any) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
button("export", () => download("frost-shot.json", parseTrack(track())));
button("export-preset", () => download("frost-motion-preset.json", appliedValues()));
button("import", () => field("file").click());
field("file").onchange = async () => {
  try {
    const file = field("file").files?.[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (data.version === 1) {
      commit(parseTrack(data));
    } else {
      const parsed = parseTrack(data.cameraTrack || "");
      values = { ...preset, ...data };
      S = schedule();
      duration = durationOf(S);
      field("time").max = String(duration);
      history.commit(parsed);
      await loadMeshes();
      refresh();
      seek(Math.min(time, duration));
    }
    status("JSON imported.");
  } catch (e) {
    status(String(e));
  } finally {
    field("file").value = "";
  }
};
function apply(original = false) {
  if (!original && !track().keys.length) throw Error("Capture at least one view before applying.");
  const vars = appliedValues(original),
    url = "/workbench?block=frost#vars=" + encodeURIComponent(JSON.stringify(vars));
  store.set("frost-motion-applied-v1", JSON.stringify(vars));
  if (fullWindow && !fullWindow.closed) fullWindow.location.href = url;
  else fullWindow = window.open(url, "frost-motion-full");
  $("applied").textContent = original
    ? "Original camera restored in full Frost."
    : "Applied " + track().name + " to full Frost. Export preset for Studio/capture.";
  status(
    "Full Frost opened with explicit camera variables. Approved repository defaults remain unchanged.",
  );
}
button("apply", () => apply());
button("reset", () => {
  commit(emptyTrack());
  roll = 0;
  seek(time);
  apply(true);
});
// Direct path manipulation in the overview's view plane. One undo step per drag.
const ray = new THREE.Raycaster();
ray.layers.set(1);
let drag: { id: string; before: CameraTrack; plane: THREE.Plane; offset: THREE.Vector3 } | null =
  null;
overviewRenderer.domElement.addEventListener(
  "pointerdown",
  (e) => {
    const rect = overviewRenderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      overviewCamera,
    );
    const hit = ray.intersectObjects(markers)[0];
    if (!hit) return;
    e.stopImmediatePropagation();
    overviewControls.enabled = false;
    selected = hit.object.userData.key;
    const point = hit.object.position.clone(),
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        overviewCamera.getWorldDirection(new THREE.Vector3()),
        point,
      ),
      intersection = new THREE.Vector3();
    ray.ray.intersectPlane(plane, intersection);
    drag = { id: selected, before: clone(track()), plane, offset: point.sub(intersection) };
    overviewRenderer.domElement.setPointerCapture(e.pointerId);
  },
  true,
);
overviewRenderer.domElement.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = overviewRenderer.domElement.getBoundingClientRect();
  ray.setFromCamera(
    new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    ),
    overviewCamera,
  );
  const point = new THREE.Vector3();
  if (ray.ray.intersectPlane(drag.plane, point)) {
    track().keys.find((k) => k.id === drag!.id)!.position = point.add(drag.offset).toArray() as V3;
    path();
    seek(time);
  }
});
overviewRenderer.domElement.addEventListener("pointerup", () => {
  if (!drag) return;
  const next = clone(track());
  history.track = drag.before;
  drag = null;
  overviewControls.enabled = true;
  safe(() => commit(next));
});
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input,select,textarea")) return;
  if (e.code === "Space") {
    e.preventDefault();
    playing = !playing;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $(e.shiftKey ? "redo" : "undo").click();
  }
});
async function loadMeshes() {
  ready = false;
  status("Preparing cached structural meshes…");
  const geos = await skeletonMeshes(values, status);
  for (const m of meshes) {
    object.remove(m);
    (m.material as THREE.Material).dispose();
  }
  meshes = geos.map((g) => {
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xa8c2cd }));
    object.add(mesh);
    return mesh;
  });
  ready = true;
  status("Ready · lightweight meshes only · full Frost loads only when you Apply.");
}
const resize = () => {
  for (const [r, el] of [
    [renderer, $("camera-view")],
    [overviewRenderer, $("overview")],
  ] as const) {
    const rect = el.getBoundingClientRect();
    r.setSize(rect.width, rect.height, false);
  }
  overviewCamera.aspect = $("overview").clientWidth / $("overview").clientHeight;
  overviewCamera.updateProjectionMatrix();
  dirty = true;
};
new ResizeObserver(resize).observe($("camera-view"));
resize();
let last = 0;
function animate(now: number) {
  requestAnimationFrame(animate);
  if (playing && ready) {
    seek(time + Math.min(0.1, (now - last) / 1000));
    if (time >= duration) playing = false;
  }
  last = now;
  $("play").textContent = playing ? "Pause" : "Play";
  if (dirty) {
    objectsAt();
    camera.updateMatrixWorld(true);
    helper.update();
    renderer.render(scene, camera);
    overviewRenderer.render(scene, overviewCamera);
    dirty = false;
  }
}
requestAnimationFrame(animate);
refresh();
refreshLibrary();
loadMeshes()
  .then(() => seek(0))
  .catch((e) => status("Mesh load failed: " + e));
// Small, inspectable automation surface for capture/edit/apply integration checks.
(window as any).__frostMotion = {
  build: "frost-motion-20260905-r13",
  get ready() {
    return ready;
  },
  get track() {
    return clone(track());
  },
  get values() {
    return clone(values);
  },
  get time() {
    return time;
  },
  camera,
  overviewCamera,
  seek,
  capture,
  commit,
  history,
  appliedValues,
  get matrices() {
    return { camera: camera.matrixWorld.toArray(), object: frame().matrix.toArray() };
  },
  get renderer() {
    return "WebGL skeleton; no World/SDF/particles/post";
  },
};
