// Shape-independent studio-glass lookup: lighting is camera-locked.
import * as THREE from "three/webgpu";
import { D } from "../dials/store";
export function createGlassMatcap(environment: THREE.DataTexture, n = 1024) {
  const out = new Float32Array(n * n * 4),
    src = environment.image.data as Float32Array,
    w = environment.image.width,
    h = environment.image.height;
  const I = D.ice,
    ior = I.ior,
    f0 = ((ior - 1) / (ior + 1)) ** 2,
    color = new THREE.Color(I.attenuationColor),
    colors = [color.r, color.g, color.b];
  const sample = (x: number, y: number, z: number, c: number) => {
    const u = (((Math.atan2(z, x) / (2 * Math.PI) + 0.5) % 1) + 1) % 1,
      v = Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5;
    const px = u * w - 0.5,
      py = v * h - 0.5,
      ix = Math.floor(px),
      iy = Math.floor(py),
      tx = px - ix,
      ty = py - iy;
    const a = (xx: number, yy: number) =>
      src[(Math.max(0, Math.min(h - 1, yy)) * w + ((xx + w) % w)) * 4 + c];
    return (
      (a(ix, iy) * (1 - tx) + a(ix + 1, iy) * tx) * (1 - ty) +
      (a(ix, iy + 1) * (1 - tx) + a(ix + 1, iy + 1) * tx) * ty
    );
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let nx = ((x + 0.5) / n) * 2 - 1,
        ny = ((y + 0.5) / n) * 2 - 1;
      const rr = nx * nx + ny * ny;
      if (rr >= 1) {
        const m = 0.99999 / Math.sqrt(rr);
        nx *= m;
        ny *= m;
      }
      const nz = Math.sqrt(Math.max(1e-8, 1 - nx * nx - ny * ny));
      const eta = 1 / ior,
        k = eta * nz - Math.sqrt(1 - eta * eta * (1 - nz * nz));
      const dx = k * nx,
        dy = k * ny,
        dz = -eta + k * nz,
        chord = -2 * (nx * dx + ny * dy + nz * dz);
      const ex = nx + dx * chord,
        ey = ny + dy * chord,
        ez = nz + dz * chord;
      const dn = dx * ex + dy * ey + dz * ez,
        k2 = 1 - ior * ior * (1 - dn * dn),
        f = f0 + (1 - f0) * (1 - nz) ** 5;
      const b = ior * dn - Math.sqrt(Math.max(0, k2)),
        ox = ior * dx - b * ex,
        oy = ior * dy - b * ey,
        oz = ior * dz - b * ez;
      for (let c = 0; c < 3; c++) {
        const att = Math.pow(
          colors[c],
          (chord * I.thicknessScale) / Math.max(I.attenuationDistance, 0.01),
        );
        out[(x + y * n) * 4 + c] =
          sample(2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1, c) * f +
          sample(ox, oy, oz, c) * (1 - f) * (I.backlight ?? 0.4) * att;
      }
      out[(x + y * n) * 4 + 3] = 1;
    }
  const tex = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.FloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
