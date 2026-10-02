import type { Schedule, Pose } from "../frost";

export const SETTLE = 2.8;
export const ATTACK = 0.65; // anticipation before each break
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** C2 turn envelopes: continuous velocity/acceleration over an ongoing drift. */
export function makePoseAt(S: Schedule, P: Pose) {
  const flowEase = (u: number) => {
    u = clamp01(u);
    return u * u * u * (u * (u * 6 - 15) + 10);
  };
  /** Quintic rise and fall meet with zero velocity and acceleration at the crest. */
  const bump = (u: number, a: number) =>
    u <= a ? flowEase(u / Math.max(a, 1e-6)) : 1 - flowEase((u - a) / Math.max(1 - a, 1e-6));
  type Turn = {
    t0: number;
    tBreakEnd: number;
    t1: number;
    yaw: number;
    pitch: number;
    z: number;
    keep: boolean;
  };
  const turns: Turn[] = [
    {
      t0: S.logoBreak - ATTACK,
      tBreakEnd: S.form1,
      t1: S.form1 + SETTLE,
      yaw: P.turnYaw,
      pitch: P.turnPitch,
      z: P.approach,
      keep: false,
    },
    {
      t0: S.break1 - ATTACK,
      tBreakEnd: S.form2,
      t1: S.form2 + SETTLE,
      yaw: P.turnYaw2,
      pitch: P.turnPitch2,
      z: -P.retreat,
      keep: false,
    },
    {
      t0: S.break2 - ATTACK,
      tBreakEnd: S.fadeOut + 1.5,
      t1: S.fadeOut + 1.5,
      yaw: P.finalYaw,
      pitch: P.finalPitch,
      z: P.approach + P.zoomIn,
      keep: true,
    },
  ];
  /** the keyed part of the path (without drift / idle), in degrees and units */
  function keyPoseAt(t: number) {
    let yaw = 0,
      pitch = 0,
      z = 0;
    for (const k of turns) {
      const u = (t - k.t0) / Math.max(k.t1 - k.t0, 1e-6);
      if (u <= 0) continue;
      yaw += k.yaw * flowEase(u);
      const a = (k.tBreakEnd - k.t0) / Math.max(k.t1 - k.t0, 1e-6);
      const b = k.keep ? flowEase(u) : bump(u, a);
      pitch += k.pitch * b;
      z += k.z * b;
    }
    return { yaw, pitch, z };
  }
  const driftYawAt = (t: number) => P.driftYaw * t;
  const idleYawAt = (t: number) => P.idleYaw * Math.sin((2 * Math.PI * t) / 9);
  return function poseAt(t: number) {
    const k = keyPoseAt(t);
    const sway = P.driftSway * Math.sin((2 * Math.PI * t) / 11);
    return {
      yaw: k.yaw + driftYawAt(t) + idleYawAt(t),
      pitch: k.pitch + sway,
      z: k.z + 0.0875 * P.driftSway * Math.sin((2 * Math.PI * t) / 11),
    };
  };
}
