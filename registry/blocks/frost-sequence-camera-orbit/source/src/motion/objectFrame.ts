import * as THREE from "three/webgpu";
import { makePoseAt, SETTLE } from "../core/motion";
import type { Schedule, Pose } from "../frost";
export const shapeAt = (t: number, s: Schedule) => (t < s.form1 ? 0 : t < s.form2 ? 1 : 2);
/** Same parent YXZ motion and settled inverse-facing child as the full Frost block. */
export function objectFrameAt(
  t: number,
  s: Schedule,
  p: Pose,
  k = shapeAt(t, s),
  stationary = false,
) {
  const pose = makePoseAt(s, p),
    at = pose(t),
    q = (time: number) => {
      const v = pose(time);
      return new THREE.Quaternion().setFromEuler(
        new THREE.Euler((v.pitch * Math.PI) / 180, (v.yaw * Math.PI) / 180, 0, "YXZ"),
      );
    };
  const rotation = stationary ? new THREE.Quaternion() : q(t),
    facing =
      stationary || k === 0
        ? new THREE.Quaternion()
        : q((k === 1 ? s.form1 : s.form2) + SETTLE).invert();
  const position = new THREE.Vector3(0, 0.05, stationary ? 0 : at.z);
  return {
    rotation,
    facing,
    position,
    matrix: new THREE.Matrix4().compose(
      position,
      rotation.clone().multiply(facing),
      new THREE.Vector3(1, 1, 1),
    ),
  };
}
