// HDR studio: rectangular softboxes and narrow edge strips, with dark flags
// between them. Float radiance is retained for reflections and PMREM filtering.
import * as THREE from "three/webgpu";
export function createEnvironment(width = 1024, height = 512) {
  const data = new Float32Array(width * height * 4);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const directions = Array.from({ length: width * height }, (_, i) => {
    const u = ((i % width) + 0.5) / width,
      v = (Math.floor(i / width) + 0.5) / height;
    const az = (u - 0.5) * Math.PI * 2,
      el = (v - 0.5) * Math.PI;
    return new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    );
  });
  function update(L: any) {
    const card = (color: string, power: number, el: number, az: number, w: number, h: number) => {
      const e = THREE.MathUtils.degToRad(el),
        a = THREE.MathUtils.degToRad(az);
      const normal = new THREE.Vector3(
        Math.cos(e) * Math.sin(a),
        Math.sin(e),
        Math.cos(e) * Math.cos(a),
      );
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), normal)
        .normalize();
      const up = new THREE.Vector3().crossVectors(normal, right);
      return { color: new THREE.Color(color), power, normal, right, up, w, h };
    };
    const cards = [
      card(
        L.key.color,
        L.envSoftbox * 5,
        L.key.elevation,
        L.key.azimuth,
        0.42 * L.key.size,
        0.65 * L.key.size,
      ),
      card(
        L.rimColor,
        L.envRim * 6,
        L.rimElevation,
        L.rimAzimuth,
        0.1 * L.rimSize,
        0.9 * L.rimSize,
      ),
      card(
        L.accentCool.color,
        L.accentCool.reflection * 4,
        L.accentCool.elevation,
        L.accentCool.azimuth,
        0.13 * L.accentCool.size,
        0.75 * L.accentCool.size,
      ),
      card(
        L.accentWarm.color,
        L.accentWarm.reflection * 4,
        L.accentWarm.elevation,
        L.accentWarm.azimuth,
        0.2 * L.accentWarm.size,
        0.7 * L.accentWarm.size,
      ),
    ];
    const sky = new THREE.Color(L.fillColor),
      ground = new THREE.Color(L.fillGroundColor);
    directions.forEach((d, i) => {
      const hemisphere = smooth(-0.3, 0.8, d.y);
      const fill = L.envFill * 0.055;
      let r = (ground.r * (1 - hemisphere) + sky.r * hemisphere) * fill;
      let g = (ground.g * (1 - hemisphere) + sky.g * hemisphere) * fill;
      let b = (ground.b * (1 - hemisphere) + sky.b * hemisphere) * fill;
      for (const c of cards) {
        const facing = d.dot(c.normal);
        if (facing <= 0) continue;
        const x = Math.abs(d.dot(c.right) / facing),
          y = Math.abs(d.dot(c.up) / facing);
        const coverage = (1 - smooth(c.w * 0.45, c.w, x)) * (1 - smooth(c.h * 0.45, c.h, y));
        const glow = c.power * coverage;
        r += c.color.r * glow;
        g += c.color.g * glow;
        b += c.color.b * glow;
      }
      data.set([r, g, b, 1], i * 4);
    });
    tex.needsUpdate = true;
    (tex as any).needsPMREMUpdate = true;
  }
  return { texture: tex, update };
}
