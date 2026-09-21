// One soft key from above-front (VSM shadows), a weak hemisphere fill, a wide rim spot from above-behind.
import * as THREE from "three/webgpu";
import { D } from "../dials/store";

export class Lights {
  key = new THREE.DirectionalLight(0xffffff, 3);
  fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0.2);
  rim = new THREE.SpotLight(0xffffff, 1, 0, Math.PI / 3, 1, 0);
  accentCool = new THREE.DirectionalLight(0xc7ddff, 0.35);
  accentWarm = new THREE.DirectionalLight(0xffdfc4, 0.22);
  group = new THREE.Group();
  private mapSize = 0;
  private settingsVersion = -1;

  constructor() {
    this.key.castShadow = true;
    this.key.shadow.camera.left = -5.5;
    this.key.shadow.camera.right = 5.5;
    this.key.shadow.camera.top = 5.5;
    this.key.shadow.camera.bottom = -5.5;
    this.key.shadow.camera.near = 2;
    this.key.shadow.camera.far = 30;
    this.key.target.position.set(0, 0, 0);
    this.rim.target.position.set(0, 0, 0);
    this.group.add(
      this.key,
      this.key.target,
      this.fill,
      this.rim,
      this.rim.target,
      this.accentCool,
      this.accentCool.target,
      this.accentWarm,
      this.accentWarm.target,
    );
  }

  update(t: number, hoverAmount: number) {
    const L = D.lighting;
    const swayA = Math.sin((t * 2 * Math.PI) / Math.max(1, L.sway.period)) * L.sway.amplitude;
    const swayB =
      Math.sin(((t * 2 * Math.PI) / Math.max(1, L.sway.period)) * 0.61 + 0.8) * L.sway.amplitude;
    const el = THREE.MathUtils.degToRad(L.key.elevation + swayB * 40);
    const az = THREE.MathUtils.degToRad(L.key.azimuth + swayA * 60);
    const dist = 12;
    this.key.position.set(
      Math.cos(el) * Math.sin(az) * dist,
      Math.sin(el) * dist,
      Math.cos(el) * Math.cos(az) * dist,
    );
    this.key.intensity = L.key.intensity * (1 + L.key.hoverBoost * hoverAmount);
    const rel = THREE.MathUtils.degToRad(L.rimElevation);
    const raz = THREE.MathUtils.degToRad(L.rimAzimuth ?? 180);
    this.rim.position.set(
      Math.cos(rel) * Math.sin(raz) * 10,
      Math.sin(rel) * 10,
      Math.cos(rel) * Math.cos(raz) * 10,
    );
    for (const [light, cfg] of [
      [this.accentCool, L.accentCool],
      [this.accentWarm, L.accentWarm],
    ] as const) {
      if (!cfg) continue;
      const e = THREE.MathUtils.degToRad(cfg.elevation),
        a = THREE.MathUtils.degToRad(cfg.azimuth);
      light.position.set(
        Math.cos(e) * Math.sin(a) * 12,
        Math.sin(e) * 12,
        Math.cos(e) * Math.cos(a) * 12,
      );
      light.color.set(cfg.color);
      light.intensity = cfg.intensity;
    }
    if (D.version !== this.settingsVersion) {
      this.settingsVersion = D.version;
      this.key.color.set(L.key.color);
      this.fill.intensity = L.fill;
      this.fill.color.set(L.fillColor);
      this.fill.groundColor.set(L.fillGroundColor);
      this.rim.color.set(L.rimColor);
      this.rim.intensity = L.rim * 40;
      this.rim.angle = THREE.MathUtils.degToRad(L.rimAngle ?? 65);
      this.rim.penumbra = 1;
      this.rim.decay = 1.2;
      this.rim.distance = 60;
      const sh = this.key.shadow;
      sh.radius = L.shadow.softness;
      sh.blurSamples = Math.round(L.shadow.samples);
      sh.bias = L.shadow.bias;
      sh.intensity = L.shadow.intensity;
      const ms = parseInt(L.shadow.mapSize, 10);
      if (ms !== this.mapSize) {
        this.mapSize = ms;
        sh.mapSize.set(ms, ms);
        if (sh.map) {
          sh.map.dispose();
          (sh as any).map = null;
        }
        sh.needsUpdate = true;
      }
    }
  }
}
