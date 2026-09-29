/** Versioned, absolute-time camera tracks. No renderer, DOM, clock or simulation state. */
import * as THREE from "three/webgpu";
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export type CameraKey = {
  id: string;
  time: number;
  position: V3;
  target: V3;
  quaternion: Q4;
  fov: number;
  zoom: number;
  roll: number;
  ease: "flow" | "linear" | "ease-in-out";
};
export type CameraTrack = {
  version: 1;
  name: string;
  orientation: "target" | "free";
  anchorSpace: "world" | "local";
  objectMotion: "existing" | "stationary";
  keys: CameraKey[];
};
export const emptyTrack = (): CameraTrack => ({
  version: 1,
  name: "Untitled shot",
  orientation: "target",
  anchorSpace: "local",
  objectMotion: "existing",
  keys: [],
});
export function parseTrack(input: unknown): CameraTrack {
  if (input == null || input === "") return emptyTrack();
  const v: any = typeof input === "string" ? JSON.parse(input) : input;
  if (v?.version !== 1 || !Array.isArray(v.keys) || v.keys.length > 64)
    throw Error("Camera track must be version 1 with at most 64 keys.");
  const pick = (x: any, choices: string[], name: string) => {
    if (!choices.includes(x)) throw Error("Invalid " + name);
    return x;
  };
  const number = (x: any, a: number, b: number, name: string) => {
    if (typeof x !== "number" || !Number.isFinite(x) || x < a || x > b)
      throw Error("Invalid " + name);
    return x;
  };
  const vector = (x: any, n: number, name: string) => {
    if (!Array.isArray(x) || x.length !== n) throw Error("Invalid " + name);
    return x.map((y) => number(y, -10000, 10000, name));
  };
  const track: CameraTrack = {
    version: 1,
    name: String(v.name || "Untitled shot").slice(0, 100),
    orientation: pick(v.orientation, ["target", "free"], "orientation") as any,
    anchorSpace: pick(v.anchorSpace, ["world", "local"], "anchor space") as any,
    objectMotion: pick(v.objectMotion, ["existing", "stationary"], "object motion") as any,
    keys: v.keys
      .map((k: any) => {
        const q = vector(k.quaternion, 4, "quaternion") as Q4;
        if (Math.abs(Math.hypot(...q) - 1) > 0.001)
          throw Error("Camera quaternion must be normalized.");
        return {
          id: String(k.id).slice(0, 100),
          time: number(k.time, 0, 120, "key time"),
          position: vector(k.position, 3, "position") as V3,
          target: vector(k.target, 3, "target") as V3,
          quaternion: q,
          fov: number(k.fov, 5, 120, "FOV"),
          zoom: number(k.zoom, 0.1, 10, "zoom"),
          roll: number(k.roll, -720, 720, "roll"),
          ease: pick(k.ease, ["flow", "linear", "ease-in-out"], "ease") as any,
        };
      })
      .sort((a: CameraKey, b: CameraKey) => a.time - b.time),
  };
  const ids = new Set();
  for (let i = 0; i < track.keys.length; i++) {
    const k = track.keys[i];
    if (!k.id || ids.has(k.id)) throw Error("Camera key IDs must be unique.");
    ids.add(k.id);
    if (i && k.time - track.keys[i - 1].time < 1 / 240)
      throw Error("Camera keys need distinct times (at least 1/240 second apart).");
  }
  return track;
}
export function baselineCamera() {
  const c = new THREE.PerspectiveCamera(29.5, 16 / 9, 0.5, 80);
  c.position.set(0, 1.2, 13.45);
  c.lookAt(0, 0.05, 0);
  c.updateMatrixWorld();
  return c;
}
export function cameraAt(track: CameraTrack, t: number, targetMatrix = new THREE.Matrix4()) {
  const keys = track.keys;
  if (!keys.length) {
    const c = baselineCamera();
    return {
      position: c.position,
      quaternion: c.quaternion,
      target: new THREE.Vector3(0, 0.05, 0),
      fov: 29.5,
      zoom: 1,
      roll: 0,
    };
  }
  t = Math.max(keys[0].time, Math.min(keys.at(-1)!.time, t));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].time < t) i++;
  const a = keys[i],
    b = keys[Math.min(i + 1, keys.length - 1)],
    span = b.time - a.time;
  const raw = span > 0 ? (t - a.time) / span : 0,
    u = a.ease === "ease-in-out" ? raw * raw * (3 - 2 * raw) : raw;
  const interp = (get: (k: CameraKey) => number) => {
    if (!span) return get(a);
    if (a.ease !== "flow") return THREE.MathUtils.lerp(get(a), get(b), u);
    const prev = keys[Math.max(0, i - 1)],
      next = keys[Math.min(keys.length - 1, i + 2)];
    const m0 = (get(b) - get(prev)) / Math.max(b.time - prev.time, 1e-6),
      m1 = (get(next) - get(a)) / Math.max(next.time - a.time, 1e-6);
    return (
      (2 * u ** 3 - 3 * u * u + 1) * get(a) +
      (u ** 3 - 2 * u * u + u) * span * m0 +
      (-2 * u ** 3 + 3 * u * u) * get(b) +
      (u ** 3 - u * u) * span * m1
    );
  };
  const position = new THREE.Vector3(...([0, 1, 2].map((j) => interp((k) => k.position[j])) as V3));
  const target = new THREE.Vector3(...([0, 1, 2].map((j) => interp((k) => k.target[j])) as V3));
  if (track.anchorSpace === "local") target.applyMatrix4(targetMatrix);
  const quaternion =
    track.orientation === "target"
      ? new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)),
        )
      : new THREE.Quaternion(...a.quaternion).slerp(new THREE.Quaternion(...b.quaternion), u);
  quaternion.multiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(interp((k) => k.roll)),
    ),
  );
  return {
    position,
    quaternion,
    target,
    roll: interp((k) => k.roll),
    fov: THREE.MathUtils.clamp(
      interp((k) => k.fov),
      5,
      120,
    ),
    zoom: THREE.MathUtils.clamp(
      interp((k) => k.zoom),
      0.1,
      10,
    ),
  };
}
export function applyCameraAt(
  camera: THREE.PerspectiveCamera,
  track: CameraTrack,
  t: number,
  targetMatrix: THREE.Matrix4,
  focus: THREE.Vector3,
) {
  const state = cameraAt(track, t, targetMatrix);
  camera.position.copy(state.position);
  camera.quaternion.copy(state.quaternion);
  camera.fov = state.fov;
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  focus.copy(state.target);
  return state;
}
export class ShotHistory {
  private past: string[] = [];
  private future: string[] = [];
  constructor(public track: CameraTrack = emptyTrack()) {}
  commit(next: CameraTrack) {
    next = parseTrack(next);
    if (JSON.stringify(next) === JSON.stringify(this.track)) return;
    this.past.push(JSON.stringify(this.track));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.track = next;
  }
  undo() {
    if (this.past.length) {
      this.future.push(JSON.stringify(this.track));
      this.track = parseTrack(this.past.pop()!);
    }
  }
  redo() {
    if (this.future.length) {
      this.past.push(JSON.stringify(this.track));
      this.track = parseTrack(this.future.pop()!);
    }
  }
}
