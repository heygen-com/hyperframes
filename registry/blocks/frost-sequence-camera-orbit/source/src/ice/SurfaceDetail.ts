// Shared object-space surface detail for the solid and detached pieces.
// Shards sample their home coordinate, so the texture travels with the ice.
import { tsl } from "../tsl/t";
import { fbm, softThreshold } from "../tsl/noise";
const { Fn, Loop, int, exp, clamp, vec2, vec3, float, texture, abs, pow, max, smoothstep } = tsl;
type N = any;
export function iceDetail(map: any, p: N, n: N, scale: N, depth: N = float(0)) {
  if (!map) return float(0);
  const w = pow(abs(n), vec3(6));
  const weight = w.div(max(w.x.add(w.y).add(w.z), 0.001));
  const uv = (v: N, o: N) =>
    vec2(v.x.mul(0.932).sub(v.y.mul(0.362)), v.x.mul(0.362).add(v.y.mul(0.932)))
      .mul(scale)
      .add(o)
      .add(vec2(depth.mul(0.217), depth.mul(0.371)));
  return texture(map, uv(p.yz, vec2(0.317, 0.173)))
    .r.mul(weight.x)
    .add(texture(map, uv(p.zx, vec2(0.619, 0.431))).r.mul(weight.y))
    .add(texture(map, uv(p.xy, vec2(0))).r.mul(weight.z));
}
export function iceFrost(p: N, seed: N, scale: N, threshold: N, softness: N) {
  const region = softThreshold(
    fbm(p.mul(scale).add(seed.mul(2)), 3)
      .mul(0.5)
      .add(0.5),
    threshold,
    softness,
  );
  const crystals = fbm(p.mul(scale.mul(32)).add(seed.mul(3.1)), 3)
    .mul(0.5)
    .add(0.5);
  // Granular deposits with broken edges, not smooth white fog painted over glass.
  return pow(region, 1.5).mul(smoothstep(0.3, 0.69, crystals));
}

// The same three-depth inclusion density for intact ice and individual fragments.
export function iceInclusions(map: any, p: N, n: N, ray: N, path: N, scale: N, amount: N) {
  return Fn(() => {
    const sum = float(0).toVar();
    Loop({ start: int(0), end: int(3), type: "int", condition: "<" }, ({ i }: any) => {
      const depth = float(i).add(0.5).div(3);
      const q = p.add(ray.mul(path).mul(depth));
      sum.addAssign(pow(iceDetail(map, q, n, scale, depth), 1.6).mul(exp(depth.mul(-0.7))));
    });
    return clamp(sum.div(3).mul(amount), 0, 0.45);
  })();
}
