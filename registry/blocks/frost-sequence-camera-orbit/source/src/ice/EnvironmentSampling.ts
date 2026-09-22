import { RW } from "../rewrite";
import { tsl } from "../tsl/t";
const { normalize, cross, select, abs, vec3, texture, equirectUV, pmremTexture } = tsl;
type N = any;
export function iceEnvironment(environment: any, strength: N, direction: N, rough: N) {
  if (RW.environment) return pmremTexture(environment, direction, rough).rgb.mul(strength);
  const d = normalize(direction);
  const tangent = normalize(
    cross(d, select(abs(d.y).lessThan(0.95), vec3(0, 1, 0), vec3(1, 0, 0))),
  );
  const bitangent = cross(d, tangent);
  const spread = rough.mul(rough).mul(0.32);
  const sample = (q: N) => texture(environment, equirectUV(normalize(q))).level(0).rgb;
  return sample(d)
    .mul(0.4)
    .add(sample(d.add(tangent.mul(spread))).mul(0.15))
    .add(sample(d.sub(tangent.mul(spread))).mul(0.15))
    .add(sample(d.add(bitangent.mul(spread))).mul(0.15))
    .add(sample(d.sub(bitangent.mul(spread))).mul(0.15))
    .mul(strength);
}
