// Camera parallax + object rotation rig, driven by the cursor with lag, idle Lissajous drift.
import * as THREE from "three/webgpu";
import { damp } from "../core/ease";
import { input, heroFrame } from "../core/state";
import { D } from "../dials/store";

export class Rig {
  yaw = 0;
  pitch = 0; // smoothed object rotation (radians)
  parYaw = 0;
  parPitch = 0; // smoothed camera parallax (radians)
  idleBlend = 0; // 0 = cursor control, 1 = idle drift
  readonly lookAt = new THREE.Vector3();
  private readonly base = new THREE.Vector3();
  private readonly spherical = new THREE.Spherical();

  update(camera: THREE.PerspectiveCamera, object: THREE.Object3D, t: number, dt: number) {
    const framed = heroFrame.enabled && heroFrame.framing;
    const c = D.camera;
    const frame = framed ? heroFrame : c;
    const idle = t - input.lastMoveT > c.idleDelay;
    this.idleBlend = damp(this.idleBlend, idle ? 1 : 0, idle ? 1.5 : 0.6, dt);
    const cx = input.inside ? input.x : 0,
      cy = input.inside ? input.y : 0;
    const w = (2 * Math.PI) / Math.max(1, c.idlePeriod);
    const driftYaw = Math.sin(t * w) * c.idleAmplitude,
      driftPitch = Math.sin(t * w * 1.37 + 1.1) * c.idleAmplitude * 0.5;
    const targetYaw = THREE.MathUtils.degToRad(
      frame.baseYaw + THREE.MathUtils.lerp(cx * frame.rotateYaw, driftYaw, this.idleBlend),
    );
    const targetPitch = THREE.MathUtils.degToRad(
      frame.basePitch + THREE.MathUtils.lerp(-cy * frame.rotatePitch, driftPitch, this.idleBlend),
    );
    this.yaw = damp(this.yaw, targetYaw, c.rotationLag * 0.35, dt);
    this.pitch = damp(this.pitch, targetPitch, c.rotationLag * 0.35, dt);
    object.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    const pr = THREE.MathUtils.degToRad(frame.parallaxRange);
    this.parYaw = damp(this.parYaw, -cx * pr, c.parallaxSmoothing * 0.35, dt);
    this.parPitch = damp(this.parPitch, cy * pr * 0.6, c.parallaxSmoothing * 0.35, dt);
    this.lookAt.set(framed ? heroFrame.lookAtX : 0, frame.lookAtY, 0);
    if (heroFrame.cameraOverride) {
      // Exported camera motion owns the view, while the existing rig above continues to animate the object.
      heroFrame.cameraOverride(camera);
      return;
    }
    const base = this.base.set(0, frame.height, frame.distance).sub(this.lookAt);
    const sph = this.spherical.setFromVector3(base);
    sph.theta += this.parYaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi + this.parPitch, 0.1, Math.PI - 0.1);
    camera.position.setFromSpherical(sph).add(this.lookAt);
    camera.lookAt(this.lookAt);
    if (camera.fov !== frame.fov) {
      camera.fov = frame.fov;
      camera.updateProjectionMatrix();
    }
  }
}
