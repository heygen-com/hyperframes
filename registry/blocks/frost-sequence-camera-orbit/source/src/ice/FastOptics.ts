import { tsl } from "../tsl/t";
import { iceEnvironment } from "./EnvironmentSampling";
const { normalize, mat3, vec3, float, dot, select, pow, clamp, reflect, refract, exp, log, max } =
  tsl;
// Artistic glass against dark backgrounds: approximate transmitted studio light.
export function fastOptics({ ray, normal, environment, u, f, roughness, path }: any) {
  const n = select(dot(normal, ray).greaterThan(0), normal.negate(), normal),
    ior = max(u.ior, 1.001);
  const world = (v: any) => normalize(mat3(u.model).mul(v));
  const env = (v: any) => iceEnvironment(environment, u.envStrength, world(v), roughness);
  const f0 = pow(ior.sub(1).div(ior.add(1)), 2),
    F = f0.add(
      float(1)
        .sub(f0)
        .mul(pow(float(1).sub(clamp(dot(n, ray.negate()), 0, 1)), 5)),
    );
  const attenuation = exp(
    log(max(u.attColor, vec3(0.001)))
      .mul(path.mul(u.thicknessScale).div(max(u.attDist, 0.01)))
      .mul(f.absorption),
  );
  return {
    reflected: env(reflect(ray, n)).mul(F).mul(f.reflections),
    transmitted: env(normalize(refract(ray, n, float(1).div(ior))))
      .mul(float(1).sub(F))
      .mul(u.backlight)
      .mul(attenuation),
  };
}
